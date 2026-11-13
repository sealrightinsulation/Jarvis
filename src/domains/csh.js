// A-06 Cash management: cash today, cash coming, cash going, thirteen weeks ahead.

import { live, partial, blind, fixRegister, fixSettings, fixSheet, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, plural, round2, toNum, shortDate, daysBetween, isoDate, addDays, endOfMonth, weekStart, dueText } from '../app/format.js';
import { inScope, COMPANIES } from '../registers/schemas.js';
import { receivables, payables, cashPosition, companiesIn, jtIn, anyBank, scopeName } from '../model/derive.js';
import { cashForecast } from '../calc/forecast.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const ar = receivables(model, scope);
  const ap = payables(model, scope);
  const cash = cashPosition(model, settings, scope);
  const forecast = cashForecast(ctx);
  const bank = anyBank(model);
  const bankInScope = bank && (scope === 'all' || scope === bank.company) ? bank : null;
  const jt = jtIn(model, scope);
  const cos = companiesIn(model, scope);
  const today = isoDate(now);
  const weekEnd = isoDate(addDays(weekStart(now), 6));
  const monthEnd = isoDate(endOfMonth(now));
  const alertDays = toNum(s.overdueAlertDays) || 30;
  const it = {};
  let jobRows = [];

  // ---- cash today ----
  if (cash.known) {
    it['csh.today'] = (cash.complete ? live : partial)(
      money(cash.amount),
      cash.parts.map((p) => (p.amount !== null ? `${COMPANIES[p.company].name}: ${money(p.amount)}, ${p.source}${p.asOf ? `, as of ${shortDate(p.asOf, now)}` : ''}` : `${COMPANIES[p.company].name}: not known`)).join('. ') + '.',
      'Bank feed and your settings',
      'none',
      cash.complete ? undefined : fixSettings('main', cash.parts.find((p) => p.amount === null).company === 'ab' ? 'cashAb' : 'cashSr', 'Enter the missing balance'),
    );
  } else {
    it['csh.today'] = blind(`No bank feed is connected for ${scopeName(scope)} and no balance has been entered.`, fixSettings('main', scope === 'sr' ? 'cashSr' : 'cashAb', 'Enter a bank balance'));
  }

  // ---- cash expected this week / month ----
  if (ar.loaded) {
    const notLate = ar.invoices.filter((i) => i.daysOverdue === 0 && i.dueDate);
    const dueWeek = round2(notLate.filter((i) => i.dueDate <= weekEnd).reduce((t, i) => t + i.balance, 0));
    const dueMonth = round2(notLate.filter((i) => i.dueDate <= monthEnd).reduce((t, i) => t + i.balance, 0));
    const late = ar.overdueTotal;
    it['csh.week'] = live(`${money(dueWeek)} due this week`, `${late > 0 ? `Plus ${money(late)} already overdue that could arrive any day. ` : ''}Only invoices are counted; deposits for work not yet invoiced are not predictable.`, 'QuickBooks invoices', 'none');
    it['csh.month'] = live(`${money(dueMonth)} due by ${shortDate(monthEnd, now)}`, `${late > 0 ? `Plus ${money(late)} overdue. ` : ''}${plural(ar.invoices.length, 'unpaid invoice')} in total, ${money(ar.total)}.`, 'QuickBooks invoices', 'none');
    it['csh.overdue'] = live(
      ar.overdueTotal > 0 ? `${money(ar.overdueTotal)} overdue` : 'Nothing overdue',
      ar.overdue.length ? ar.overdue.slice(0, 3).map((i) => `${i.customer} ${money(i.balance)}, ${i.daysOverdue} days`).join('; ') + (ar.overdue.length > 3 ? `; and ${ar.overdue.length - 3} more` : '') + '.' : 'Every unpaid invoice is still within its terms.',
      'QuickBooks invoices',
      ar.overdue.some((i) => i.daysOverdue > alertDays) ? 'alert' : ar.overdue.length ? 'watch' : 'good',
    );
  } else {
    const b = blind('Invoices could not be read from QuickBooks.', fixSheet('command', 'See connection status'));
    it['csh.week'] = b;
    it['csh.month'] = b;
    it['csh.overdue'] = b;
  }

  // ---- upcoming payroll ----
  const payroll = (scope === 'sr' ? 0 : toNum(s.payrollAb) || 0) + (scope === 'ab' ? 0 : toNum(s.payrollSr) || 0);
  if (payroll > 0 && s.payrollNextDate) {
    const d = daysBetween(now, s.payrollNextDate);
    it['csh.payroll'] = live(`${money(payroll)} on ${shortDate(s.payrollNextDate, now)}`, d !== null && d < 0 ? 'That date has passed. Update the next pay date.' : `In ${d} day${d === 1 ? '' : 's'}. From your payroll settings.`, 'Your settings', d !== null && d < 0 ? 'watch' : cash.known && cash.amount < payroll ? 'alert' : 'none', fixSettings('main', 'payrollNextDate', 'Update'));
  } else {
    it['csh.payroll'] = blind('Pay frequency, next pay date and the usual amount have not been entered.', fixSettings('main', 'payrollFrequency', 'Enter payroll'));
  }

  // ---- supplier payments ----
  const in30 = isoDate(addDays(now, 30));
  if (ap.loaded) {
    const soon = round2(ap.bills.filter((b) => b.daysOverdue === 0 && b.dueDate && b.dueDate <= in30).reduce((t, b) => t + b.balance, 0));
    it['csh.supplier_payments'] = partial(
      `${money(ap.overdueTotal + soon)} due within 30 days`,
      `${money(ap.overdueTotal)} is already past due and ${money(soon)} falls due in the next 30 days, across ${plural(ap.bills.length, 'unpaid JobTread bill')}. Seal Right supplier bills are not tracked.`,
      'JobTread bills',
      ap.overdueTotal > 0 ? 'alert' : 'none',
      fixSheet('pur', 'See suppliers'),
    );
  } else {
    it['csh.supplier_payments'] = blind('No supplier bills are recorded anywhere Jarvis can read.', fixRegister('obligations', 'List what you owe'));
  }

  // ---- customer payment terms ----
  const paid = cos.flatMap((c) => c.paidInvoices);
  if (paid.length) {
    const terms = Math.round(paid.reduce((t, i) => t + Math.max(0, daysBetween(i.date, i.dueDate) || 0), 0) / paid.length);
    const actual = Math.round(paid.reduce((t, i) => t + (i.daysToPay || 0), 0) / paid.length);
    const lateShare = paid.filter((i) => i.daysLate > 0).length / paid.length;
    it['csh.terms'] = live(`Due in ${terms} days, paid in ${actual}`, `Across ${plural(paid.length, 'invoice')} paid in the last 12 months, ${Math.round(lateShare * 100)}% were paid after the due date.`, 'QuickBooks invoices', actual > terms + 10 ? 'watch' : 'good');
  } else {
    it['csh.terms'] = blind('No paid invoices could be read to measure terms against.', fixSheet('command', 'See connection status'));
  }

  // ---- lines of credit and cards ----
  const facilities = (registers.loans || []).filter((r) => inScope(r, scope));
  const lines = facilities.filter((f) => f.kind === 'line_of_credit' && toNum(f.limit) !== null);
  const cardPayments = bankInScope ? round2(Object.values(bankInScope.flows.byMonth).reduce((t, m) => t + m.transfersOut, 0)) : null;
  if (lines.length) {
    const avail = round2(lines.reduce((t, f) => t + Math.max(0, toNum(f.limit) - (toNum(f.balance) || 0)), 0));
    it['csh.credit_lines'] = live(`${money(avail)} available`, lines.map((f) => `${f.name}: ${money(toNum(f.balance) || 0)} drawn of ${money(f.limit)}`).join('. ') + '.', 'Your loans list', 'none', fixRegister('loans', 'Update'));
  } else {
    it['csh.credit_lines'] = blind(`No line of credit is on file${cardPayments ? `, though the bank feed shows ${money(cardPayments)} moved to cards, lines of credit and other accounts this year` : ''}. Add each facility with its limit and balance.`, fixRegister('loans', 'Add a line of credit'));
  }
  const cardsOnFile = facilities.filter((f) => f.kind === 'credit_card');
  const feedCard = bankInScope ? bankInScope.cardOwing : null;
  if (feedCard !== null || cardsOnFile.length) {
    const typed = round2(cardsOnFile.reduce((t, f) => t + (toNum(f.balance) || 0), 0));
    it['csh.cards'] = partial(
      `${money((feedCard || 0) + typed)} owing`,
      `${feedCard !== null ? `${bankInScope.accounts.filter((a) => a.type === 'card').map((a) => `${a.name}: ${money(a.bankBalance)}`).join('; ')} from the bank feed. ` : ''}${cardsOnFile.length ? `${plural(cardsOnFile.length, 'card')} from your list. ` : 'Other cards are not connected or listed, so this is not the whole picture.'}`,
      'Bank feed and your loans list',
      'none',
      fixRegister('loans', 'Add other cards'),
    );
  } else {
    it['csh.cards'] = blind('No credit card is connected or listed.', fixRegister('loans', 'Add your cards'));
  }

  // ---- cash to finish signed work ----
  const active = jt ? jt.jobs.filter((j) => j.stage === 'active') : [];
  const withBudget = active.filter((j) => j.projectedCost !== null);
  if (jt && active.length) {
    const rows = active.map((j) => {
      const remainingCost = j.projectedCost !== null ? Math.max(0, j.projectedCost - (j.actualCost || 0)) : null;
      const toPay = round2((remainingCost || 0) + j.billsUnpaid);
      const toCollect = round2(Math.max(0, j.contract - j.invoiced) * 1.13 + j.arBalance);
      return { id: j.id, name: j.name, remainingCost, billsUnpaid: j.billsUnpaid, toPay, toCollect, gap: round2(toPay - toCollect), hasBudget: j.projectedCost !== null };
    });
    const need = round2(rows.reduce((t, r) => t + r.toPay, 0));
    const gap = round2(rows.filter((r) => r.gap > 0).reduce((t, r) => t + r.gap, 0));
    it['csh.cash_to_complete'] = partial(`${money(need)} still to pay out`, `Remaining budgeted cost plus unpaid bills on ${plural(active.length, 'signed job')}${withBudget.length < active.length ? ` (${active.length - withBudget.length} without a budget count unpaid bills only)` : ''}.`, 'JobTread budgets and bills', 'none', fixSheet('job', 'Open job costing'));
    it['csh.project_financing'] = partial(
      gap > 0 ? `${money(gap)} to find` : 'Covered by billings',
      gap > 0 ? `${rows.filter((r) => r.gap > 0).map((r) => `${r.name}: ${money(r.gap)}`).join('; ')}. That is how much more each job still has to pay out than it has left to bill and collect.` : 'On every signed job, what is left to bill and collect covers what is left to pay.',
      'JobTread budgets, bills and invoices',
      gap > 0 ? 'alert' : 'good',
      fixSheet('job', 'Open job costing'),
    );
    jobRows = rows;
  } else {
    const b = blind(scope === 'sr' ? 'Seal Right jobs have no budgets or bills recorded.' : 'There are no signed JobTread jobs to measure.', fixSheet('job', 'Open job costing'));
    it['csh.cash_to_complete'] = b;
    it['csh.project_financing'] = b;
  }

  // ---- thirteen-week forecast ----
  const lowWeek = forecast.low.from ? shortDate(forecast.low.from, now) : '';
  it['csh.forecast13'] = forecast.startKnown
    ? partial(
        `Lowest point ${money(forecast.low.balance)}, week of ${lowWeek}`,
        `Starts at ${money(forecast.start)}; ${money(forecast.totalIn)} of invoices expected in and ${money(forecast.totalOut)} known to go out over 13 weeks. ${forecast.notes[0] || ''}`,
        'Bank feed, invoices, JobTread bills and your inputs',
        forecast.low.balance < 0 ? 'alert' : toNum(s.reserveTarget) !== null && forecast.low.balance < toNum(s.reserveTarget) ? 'watch' : 'good',
      )
    : blind('A forecast needs a starting bank balance, and none is connected or entered.', fixSettings('main', scope === 'sr' ? 'cashSr' : 'cashAb', 'Enter a bank balance'));

  const items = finalizeItems('csh', it);

  // ---- minions ----
  const minions = [...itemMinions('csh', items)];
  for (const i of ar.invoices) {
    const status = i.daysOverdue > alertDays ? 'alert' : i.daysOverdue > 0 ? 'watch' : 'clear';
    minions.push(minion(`csh.inv:${i.company}:${i.id}`, 'csh', 'Collections chaser', `Invoice ${i.number || i.id} · ${i.customer}`, status, `${money(i.balance)} ${i.daysOverdue > 0 ? `${i.daysOverdue} days overdue` : dueText(-i.daysUntilDue)}${i.balance < i.total ? ` (part paid of ${money(i.total)})` : ''}.`, { weight: Math.min(95, 50 + i.daysOverdue / 3), amount: i.balance, action: i.daysOverdue > 0 ? { label: 'Draft a reminder', go: { ask: `Draft a short, firm, friendly payment reminder to ${i.customer} for invoice ${i.number}, ${money(i.balance)}, now ${i.daysOverdue} days overdue.` } } : undefined }));
  }
  for (const b of ap.bills) {
    minions.push(minion(`csh.bill:${b.id}`, 'csh', 'Supplier bill watcher', `${b.account} · ${b.job || 'no job'}`, b.daysOverdue > 30 ? 'alert' : b.daysOverdue > 0 ? 'watch' : 'clear', `${money(b.balance)} ${b.daysOverdue > 0 ? `${b.daysOverdue} days past due` : b.dueDate ? `due ${shortDate(b.dueDate, now)}` : 'with no due date'} in JobTread.`, { weight: Math.min(85, 40 + b.daysOverdue / 3), amount: b.balance }));
  }
  if (bankInScope) {
    const recent = isoDate(addDays(now, -60));
    for (const e of bankInScope.nsf) {
      minions.push(minion(`csh.nsf:${e.id}`, 'csh', 'Bounced payment spotter', `Returned item ${shortDate(e.date, now)}`, e.date >= recent ? 'alert' : 'watch', `${money(e.amount)} came back NSF on ${shortDate(e.date, now)}: a payment out of the account did not clear.`, { weight: e.date >= recent ? 75 : 20, amount: e.amount }));
    }
  }
  const reserveT = toNum(s.reserveTarget);
  for (const w of forecast.weeks) {
    if (!forecast.startKnown) break;
    minions.push(minion(`csh.week:${w.index}`, 'csh', 'Week-ahead lookout', `Week of ${shortDate(w.from, now)}`, w.balance < 0 ? 'alert' : reserveT !== null && w.balance < reserveT ? 'watch' : 'clear', `${money(w.inflow)} in, ${money(w.outflow)} out, ending near ${money(w.balance)} on known items.`, { weight: w.balance < 0 ? 90 - w.index : 30 - w.index, amount: w.balance }));
  }
  for (const o of (registers.obligations || []).filter((r) => inScope(r, scope) && r.nextDue)) {
    const d = daysBetween(now, o.nextDue);
    if (d === null || d > 21) continue;
    minions.push(minion(`csh.due:${o.id}`, 'csh', 'Due-date keeper', o.name, d < 0 ? 'watch' : 'clear', d < 0 ? `Next due date ${shortDate(o.nextDue, now)} has passed. Update it after paying.` : `${money(o.amount)} due ${shortDate(o.nextDue, now)}.`, { weight: 25, amount: toNum(o.amount) }));
  }

  const data = { ar, ap, cash, forecast, bank: bankInScope, jobs: jobRows, weekEnd, monthEnd, paidCount: paid.length };
  const headline = [
    { label: 'Cash in the bank', value: cash.known ? moneyShort(cash.amount) : null, blind: !cash.known, hint: cash.known ? (cash.complete ? 'all accounts' : 'visible account only') : 'no bank connected', go: { sheet: 'csh' } },
    { label: '13-week low point', value: forecast.startKnown ? moneyShort(forecast.low.balance) : null, blind: !forecast.startKnown, hint: forecast.startKnown ? `week of ${lowWeek}` : '', health: forecast.startKnown && forecast.low.balance < 0 ? 'alert' : 'none', go: { sheet: 'csh' } },
  ];
  return { items, headline, minions, data };
}

export default { key: 'csh', compute };
