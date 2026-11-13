// A-01 Financial health.
//
// The hard truth this sheet has to handle: both QuickBooks files hold invoices but no costs,
// so their "profit", "cash" and "tax owing" are not real. Revenue and receivables are solid.
// Everything else is built from the bank feed, JobTread and what the owner enters, and says so.

import { live, partial, blind, fixRegister, fixSettings, fixSheet, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, pct, plural, round2, toNum, shortDate, daysBetween, monthKey } from '../app/format.js';
import { inScope, COMPANIES } from '../registers/schemas.js';
import { revenueSeries, receivables, payables, cashPosition, monthlyCommitments, companiesIn, jtIn, anyBank, scopeKeys, scopeName, sumMonths, quarterMonths } from '../model/derive.js';
import { cashForecast, committedWithin } from '../calc/forecast.js';

const QBO = 'QuickBooks';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const rev = revenueSeries(model, scope);
  const ar = receivables(model, scope);
  const ap = payables(model, scope);
  const cash = cashPosition(model, settings, scope);
  const commit = monthlyCommitments(registers, settings, scope);
  const bank = anyBank(model);
  const bankInScope = bank && (scope === 'all' || scope === bank.company) ? bank : null;
  const jt = jtIn(model, scope);
  const cos = companiesIn(model, scope);
  const forecast = cashForecast(ctx);
  const it = {};
  const minions = [];

  // ---- revenue ----
  const qNow = quarterMonths(now);
  if (rev.loaded) {
    const qtr = sumMonths(rev.total, qNow);
    const change = rev.prevYtd ? (rev.ytd - rev.prevYtd) / rev.prevYtd : null;
    it['fin.revenue'] = (rev.partial ? partial : live)(
      `${money(rev.ytd)} this year`,
      `${money(rev.thisMonth)} so far this month, ${money(qtr)} this quarter, ${money(rev.ttm)} over the last 12 full months.${change !== null ? ` ${change >= 0 ? 'Up' : 'Down'} ${pct(Math.abs(change))} on the same period last year.` : ''} Invoiced, before HST.`,
      `${QBO} invoices`,
      change !== null && change < -0.15 ? 'watch' : 'good',
    );
  } else {
    it['fin.revenue'] = blind('QuickBooks could not be read, so revenue is unknown right now.', fixSheet('command', 'See connection status'));
  }

  // ---- gross profit per job ----
  const activeJobs = jt ? jt.jobs.filter((j) => j.stage === 'active') : [];
  const costed = activeJobs.filter((j) => j.projectedCost !== null && j.projectedPrice !== null && j.projectedPrice > 0);
  if (jt && activeJobs.length) {
    const price = costed.reduce((t, j) => t + j.projectedPrice, 0);
    const cost = costed.reduce((t, j) => t + j.projectedCost, 0);
    const losing = costed.filter((j) => j.projectedCost > j.projectedPrice);
    it['fin.gross_profit_jobs'] = partial(
      costed.length ? `${money(price - cost)} projected on ${plural(costed.length, 'signed job')}` : 'No signed job has a budget',
      `${costed.length} of ${activeJobs.length} signed JobTread jobs have both a budget and a price${losing.length ? `; ${losing.length} ${losing.length === 1 ? 'is' : 'are'} budgeted to cost more than the contract` : ''}. Seal Right jobs are not costed anywhere.`,
      'JobTread budgets',
      losing.length ? 'alert' : costed.length < activeJobs.length ? 'watch' : 'good',
      fixSheet('job', 'Open job costing'),
    );
  } else if (scope === 'sr') {
    it['fin.gross_profit_jobs'] = blind('Seal Right jobs are invoiced in QuickBooks but not costed anywhere: no material, labour or fuel is recorded against a job.', fixSheet('job', 'See what is needed'));
  } else {
    it['fin.gross_profit_jobs'] = blind('JobTread has no signed jobs with budgets to measure.', fixSheet('job', 'Open job costing'));
  }

  // ---- net profit ----
  const year = String(now.getFullYear());
  const bankYtd = bankInScope ? bankInScope.flows.months.filter((m) => m.startsWith(year)) : [];
  const bankIn = bankInScope ? round2(bankYtd.reduce((t, m) => t + bankInScope.flows.byMonth[m].in, 0)) : null;
  const bankOut = bankInScope ? round2(bankYtd.reduce((t, m) => t + bankInScope.flows.byMonth[m].out, 0)) : null;
  if (rev.loaded && rev.hasCosts) {
    const net = round2(rev.ytd - rev.costsYtd);
    it['fin.net_profit'] = live(`${money(net)} this year`, `Revenue ${money(rev.ytd)} less ${money(rev.costsYtd)} of recorded costs.`, `${QBO} profit and loss`, net < 0 ? 'alert' : 'good');
  } else if (rev.loaded && bankInScope) {
    it['fin.net_profit'] = partial(
      'Cannot be calculated',
      `QuickBooks has ${money(rev.costsYtd || 0)} of expenses recorded this year, so its "profit" is just revenue. The bank feed shows ${money(bankIn)} in and ${money(bankOut)} out this year after removing transfers, but that account also carries money that is not ${scope === 'all' ? 'operating income' : 'this company’s'}.`,
      'QuickBooks + bank feed',
      'alert',
      { label: 'How to fix the books', go: { sheet: 'fin', anchor: 'books' } },
    );
  } else if (rev.loaded) {
    it['fin.net_profit'] = blind(`QuickBooks has no expenses recorded for ${scopeName(scope)}, and no bank account is connected to estimate them from.`, { label: 'How to fix the books', go: { sheet: 'fin', anchor: 'books' } });
  } else {
    it['fin.net_profit'] = blind('QuickBooks could not be read.', fixSheet('command', 'See connection status'));
  }

  // ---- cash and reserves ----
  const reserve = toNum(s.reserveTarget);
  if (cash.known) {
    const monthsCover = commit.total > 0 ? cash.amount / commit.total : null;
    const health = reserve !== null ? (cash.amount < reserve ? 'alert' : cash.amount < reserve * 1.25 ? 'watch' : 'good') : monthsCover !== null ? (monthsCover < 1 ? 'alert' : monthsCover < 2 ? 'watch' : 'good') : 'none';
    it['fin.cash_reserves'] = (cash.complete ? live : partial)(
      `${money(cash.amount)} in the bank`,
      `${cash.parts.filter((p) => p.amount !== null).map((p) => `${COMPANIES[p.company].name}: ${money(p.amount)}, ${p.source}${p.asOf ? `, as of ${shortDate(p.asOf, now)}` : ''}`).join('. ')}.${cash.complete ? '' : ' No balance is known for ' + cash.parts.filter((p) => p.amount === null).map((p) => COMPANIES[p.company].name).join(' or ') + '.'}${reserve !== null ? ` Your minimum is ${money(reserve)}.` : monthsCover !== null ? ` That covers ${monthsCover.toFixed(1)} months of listed commitments.` : ''}`,
      'Bank feed and your settings',
      health,
      !cash.complete ? fixSettings('main', scope === 'sr' ? 'cashSr' : 'cashAb', 'Enter a bank balance') : reserve === null ? fixSettings('main', 'reserveTarget', 'Set a minimum') : undefined,
    );
  } else {
    it['fin.cash_reserves'] = blind(`No bank is connected for ${scopeName(scope)} and no balance has been typed in. QuickBooks’ own cash figure only ever counts money coming in, so Jarvis ignores it.`, fixSettings('main', scope === 'sr' ? 'cashSr' : 'cashAb', 'Enter a bank balance'));
  }

  // ---- receivables / payables ----
  if (ar.loaded) {
    const worst = ar.overdue[0];
    it['fin.receivables'] = (ar.partial ? partial : live)(
      `${money(ar.total)} owed to you`,
      ar.invoices.length ? `${plural(ar.invoices.length, 'unpaid invoice')} from ${plural(ar.byCustomer.length, 'customer')}. ${ar.overdueTotal > 0 ? `${money(ar.overdueTotal)} is overdue; the oldest is ${worst.customer}, ${worst.daysOverdue} days.` : 'Nothing is overdue.'}` : 'No unpaid invoices.',
      `${QBO} invoices`,
      worst && worst.daysOverdue > (toNum(s.overdueAlertDays) || 30) ? 'alert' : ar.overdueTotal > 0 ? 'watch' : 'good',
      fixSheet('csh', 'See who owes'),
    );
  } else {
    it['fin.receivables'] = blind('Unpaid invoices could not be read from QuickBooks.', fixSheet('command', 'See connection status'));
  }
  if (ap.loaded) {
    it['fin.payables'] = partial(
      `${money(ap.total)} unpaid supplier bills`,
      `${plural(ap.bills.length, 'bill')} in JobTread${ap.overdueTotal > 0 ? `, ${money(ap.overdueTotal)} past due` : ''}. Covers Advanced Builds jobs only: QuickBooks holds no supplier bills for either company.`,
      'JobTread bills',
      ap.overdueTotal > 0 ? 'alert' : 'good',
      fixSheet('pur', 'See suppliers'),
    );
  } else {
    it['fin.payables'] = blind(scope === 'sr' ? 'Seal Right’s supplier bills are not recorded in QuickBooks or anywhere else Jarvis can read.' : 'Supplier bills could not be read from JobTread, and QuickBooks holds none.', fixSheet('pur', 'Open purchasing'));
  }

  // ---- payroll ----
  const payrollLine = commit.lines.find((l) => l.kind === 'payroll');
  if (payrollLine) {
    it['fin.payroll'] = live(`About ${money(payrollLine.monthly)} a month`, `From your payroll settings${s.payrollNextDate ? `; next pay date ${shortDate(s.payrollNextDate, now)}` : ''}. QuickBooks Payroll is not available to read for Canadian companies.`, 'Your settings', 'none', fixSettings('main', 'payrollNextDate', 'Update payroll'));
  } else {
    it['fin.payroll'] = blind('Payroll is not in QuickBooks (its payroll tools do not work for Canadian companies) and nothing has been entered here.', fixSettings('main', 'payrollFrequency', 'Enter payroll'));
  }

  // ---- tax ----
  const taxCos = cos.filter((c) => c.tax && c.tax.ytd);
  const taxPaid = bankInScope ? round2(bankYtd.reduce((t, m) => t + (bankInScope.flows.byMonth[m].byKind.tax || 0), 0)) : null;
  if (taxCos.length) {
    const collected = round2(taxCos.reduce((t, c) => t + c.tax.ytd.collected, 0));
    const itc = round2(taxCos.reduce((t, c) => t + c.tax.ytd.itc, 0));
    const dueIn = s.hstNextDue ? daysBetween(now, s.hstNextDue) : null;
    it['fin.tax'] = partial(
      `${money(collected)} HST charged this year`,
      `QuickBooks shows ${money(itc)} of input tax credits and no remittances, so the ${money(cos.reduce((t, c) => t + ((c.bs && c.bs.hstPayable) || 0), 0))} it lists as HST payable is a running total, not what you owe.${taxPaid !== null ? ` The bank feed shows ${money(taxPaid)} paid to the government this year.` : ''}${dueIn !== null ? ` Next HST payment you entered: ${shortDate(s.hstNextDue, now)}.` : ''} Payroll deductions and corporate tax are not tracked.`,
      'QuickBooks sales tax + bank feed',
      dueIn !== null && dueIn >= 0 && dueIn <= 14 ? 'watch' : 'none',
      fixSettings('main', 'hstNextDue', 'Enter tax dates'),
    );
  } else {
    it['fin.tax'] = blind('HST figures could not be read from QuickBooks, and no tax dates are entered.', fixSettings('main', 'hstNextDue', 'Enter tax dates'));
  }

  // ---- loans and equipment financing ----
  const loans = (registers.loans || []).filter((r) => inScope(r, scope));
  const detected = bankInScope ? bankInScope.recurring : [];
  const detLoans = detected.filter((r) => r.kind === 'loan');
  const detEquip = detected.filter((r) => r.kind === 'equipment_finance');
  const sumMonthly = (list) => round2(list.reduce((t, r) => t + r.monthly, 0));
  if (loans.length) {
    const owing = round2(loans.reduce((t, l) => t + (toNum(l.balance) || 0), 0));
    const pay = round2(loans.reduce((t, l) => t + (toNum(l.monthlyPayment) || 0), 0));
    it['fin.loans'] = live(`${money(owing)} owing on ${plural(loans.length, 'facility', 'facilities')}`, `${money(pay)} a month in payments. From your loans list.`, 'Your loans list', 'none', fixRegister('loans', 'Update'));
  } else if (detLoans.length) {
    it['fin.loans'] = partial(`${money(sumMonthly(detLoans))} a month in loan payments`, `Not on file. The bank feed shows ${plural(detLoans.length, 'repeating loan payment')} (${detLoans.map((r) => `${r.payee} ${money(r.amount)} ${r.cadence}`).join('; ')}). Balances, rates and renewal dates are unknown.`, 'Bank feed', 'watch', fixRegister('loans', 'Add your loans'));
  } else {
    it['fin.loans'] = blind('Neither QuickBooks file has a loan, line of credit or credit card liability recorded, and none are listed here.', fixRegister('loans', 'Add your loans'));
  }
  const assets = (registers.equipment || []).filter((r) => inScope(r, scope) && toNum(r.monthlyPayment) && r.status !== 'retired');
  if (assets.length || commit.lines.length) {
    const eq = round2(assets.reduce((t, a) => t + toNum(a.monthlyPayment), 0));
    it['fin.equipment_financing'] = (assets.length ? live : partial)(`${money(commit.total)} a month committed`, `${assets.length ? `${money(eq)} of that is equipment payments on ${plural(assets.length, 'asset')}. ` : 'No equipment payments are listed. '}Includes payroll, fixed commitments and loan payments you have entered.`, 'Your lists and settings', 'none', fixRegister('equipment', assets.length ? 'Update equipment' : 'Add equipment'));
  } else if (detEquip.length) {
    it['fin.equipment_financing'] = partial(`${money(sumMonthly(detEquip))} a month in equipment finance`, `Not on file. The bank feed shows ${plural(detEquip.length, 'repeating equipment-finance payment')} to ${[...new Set(detEquip.map((r) => r.payee))].join(', ')}. Which asset each one pays for is unknown.`, 'Bank feed', 'watch', fixRegister('equipment', 'Add equipment'));
  } else {
    it['fin.equipment_financing'] = blind('No equipment payments or monthly commitments are listed.', fixRegister('equipment', 'Add equipment'));
  }

  // ---- break-even ----
  const detectedMonthly = sumMonthly(detected);
  const fixed = toNum(s.overheadMonthly) ?? (commit.total > 0 ? commit.total : detectedMonthly > 0 ? detectedMonthly : null);
  const fixedSource = toNum(s.overheadMonthly) !== null ? 'the monthly overhead you entered' : commit.total > 0 ? 'payroll, commitments and loan payments you entered' : 'repeating payments seen in the bank feed only';
  const margin = toNum(s.grossMarginTarget);
  const avgMonthly = rev.loaded && rev.ttm !== null ? rev.ttm / 12 : null;
  if (fixed !== null && margin) {
    const be = round2(fixed / margin);
    const thin = toNum(s.overheadMonthly) === null && commit.total === 0;
    it['fin.breakeven'] = partial(
      `${money(be)} of revenue a month`,
      `${money(fixed)} a month of fixed costs (${fixedSource}) divided by your ${pct(margin)} gross margin.${avgMonthly !== null ? ` You have averaged ${money(avgMonthly)} a month over the last 12 months.` : ''}${thin ? ' Fixed costs are almost certainly understated until payroll and commitments are entered.' : ''}`,
      'Estimate from your inputs',
      avgMonthly !== null ? (avgMonthly < be ? 'alert' : avgMonthly < be * 1.15 ? 'watch' : 'good') : 'none',
      thin ? fixRegister('obligations', 'List fixed costs') : undefined,
    );
  } else {
    it['fin.breakeven'] = blind(`Break-even is fixed monthly costs divided by gross margin. Still missing: ${fixed === null ? 'your fixed monthly costs' : ''}${fixed === null && !margin ? ' and ' : ''}${!margin ? 'the gross margin you price jobs to earn' : ''}.`, !margin ? fixSettings('main', 'grossMarginTarget', 'Enter your margin') : fixRegister('obligations', 'List fixed costs'));
  }

  // ---- safe to spend / reinvest ----
  const next30 = committedWithin(forecast, now, 30);
  if (cash.known) {
    const safe = round2(cash.amount - (reserve || 0) - next30 - (cash.cardOwing || 0));
    it['fin.safe_to_spend'] = partial(
      safe > 0 ? money(safe) : 'Nothing right now',
      `${money(cash.amount)} in the bank, less ${reserve !== null ? `your ${money(reserve)} minimum, ` : ''}${money(next30)} known to be going out in the next 30 days${cash.cardOwing ? ` and ${money(cash.cardOwing)} owing on the connected card` : ''}. Money owed to you is not counted until it arrives.${forecast.inputs.hasPayroll ? '' : ' Payroll is not included because it has not been entered.'}`,
      'Bank feed, JobTread bills and your inputs',
      safe <= 0 ? 'alert' : 'good',
      forecast.inputs.hasPayroll ? fixSheet('csh', 'See the forecast') : fixSettings('main', 'payrollFrequency', 'Enter payroll'),
    );
  } else {
    it['fin.safe_to_spend'] = blind('This starts from cash in the bank, which is not known.', fixSettings('main', scope === 'sr' ? 'cashSr' : 'cashAb', 'Enter a bank balance'));
  }
  if (rev.loaded && rev.hasCosts) {
    const profit = round2(rev.ytd - rev.costsYtd);
    it['fin.reinvest'] = partial(profit > 0 ? `Up to ${money(profit * 0.5)}` : 'Nothing yet', 'Half of this year’s recorded profit, leaving the rest for tax and reserves. A rule of thumb, not advice.', `${QBO} profit and loss`, profit > 0 ? 'good' : 'watch');
  } else if (bankInScope && bankInScope.flows.months.length >= 4) {
    const full = bankInScope.flows.months.filter((m) => m < monthKey(now)).slice(-3);
    const avgNet = round2(full.reduce((t, m) => t + bankInScope.flows.byMonth[m].net, 0) / Math.max(1, full.length));
    it['fin.reinvest'] = partial(
      'Not knowable yet',
      `Reinvestment should come out of profit, and profit is not in the books. For reference, the bank account has netted ${money(avgNet)} a month over the last ${full.length} full months after removing transfers, before any card or line-of-credit spending.`,
      'Bank feed',
      'none',
      { label: 'How to fix the books', go: { sheet: 'fin', anchor: 'books' } },
    );
  } else {
    it['fin.reinvest'] = blind('Reinvestment should come out of profit, and profit cannot be calculated until expenses are recorded.', { label: 'How to fix the books', go: { sheet: 'fin', anchor: 'books' } });
  }

  const items = finalizeItems('fin', it);

  // ---- minions: books integrity, one watch per account and per detected commitment ----
  minions.push(...itemMinions('fin', items));
  for (const c of cos) {
    if (c.loaded.pnl) {
      minions.push(minion(`fin.books:${c.key}`, 'fin', 'Books auditor', `${c.name} expenses`, c.hasCosts ? 'clear' : 'alert', c.hasCosts ? 'Costs are being recorded.' : `No expenses recorded in ${12 - c.costMonthsInTtm} of the last 12 months. Profit cannot be read from these books.`, { weight: 80, action: { label: 'How to fix', go: { sheet: 'fin', anchor: 'books' } } }));
    }
    if (c.bs) {
      if (c.bs.undeposited > 1000) minions.push(minion(`fin.undeposited:${c.key}`, 'fin', 'Deposit matcher', `${c.name} undeposited funds`, 'watch', `${money(c.bs.undeposited)} of customer payments sit in Undeposited Funds, never matched to a bank deposit.`, { weight: 35, amount: c.bs.undeposited }));
      const feedCash = model.banks[c.key] && model.banks[c.key].cashBalance;
      if (feedCash !== null && feedCash !== undefined && Math.abs(c.bs.bookCash - feedCash) > 1000) minions.push(minion(`fin.bookcash:${c.key}`, 'fin', 'Cash truth checker', `${c.name} book cash`, 'alert', `QuickBooks says ${money(c.bs.bookCash)} in the bank; the bank says ${money(feedCash)}.`, { weight: 70, amount: c.bs.bookCash - feedCash }));
      else if (!c.feeds.length && c.bs.bookCash > 0) minions.push(minion(`fin.nobank:${c.key}`, 'fin', 'Cash truth checker', `${c.name} bank connection`, 'blind', `No bank account is connected to this QuickBooks file, so its ${money(c.bs.bookCash)} book balance cannot be checked.`, { weight: 50, action: fixSettings('main', c.key === 'ab' ? 'cashAb' : 'cashSr', 'Enter a balance') }));
      if (c.bs.hstPayable > 0 && c.tax && c.tax.ytd && c.tax.ytd.itc === 0) minions.push(minion(`fin.hst:${c.key}`, 'fin', 'HST reconciler', `${c.name} HST payable`, 'watch', `Books show ${money(c.bs.hstPayable)} HST payable with no credits or remittances recorded. The real figure is lower.`, { weight: 30 }));
    }
    for (const f of c.feeds) {
      const rec = c.recon.find((r) => r.accountId === f.accountId);
      minions.push(minion(`fin.recon:${c.key}:${f.accountId}`, 'fin', 'Reconciliation watcher', f.name, rec && rec.lastDate ? (daysBetween(rec.lastDate, now) > 45 ? 'watch' : 'clear') : 'alert', rec && rec.lastDate ? `Last reconciled to ${shortDate(rec.lastDate, now)}.` : 'Never reconciled against a bank statement.', { weight: 40 }));
      minions.push(minion(`fin.backlog:${c.key}:${f.accountId}`, 'fin', 'Bookkeeping backlog counter', f.name, f.pendingCount > 50 ? 'alert' : f.pendingCount > 0 ? 'watch' : 'clear', f.pendingCount ? `${plural(f.pendingCount, 'bank transaction')} waiting to be categorized in QuickBooks.` : 'Every downloaded transaction has been reviewed.', { weight: 60, amount: f.pendingCount }));
      const age = f.lastUpdated ? daysBetween(String(f.lastUpdated).slice(0, 10), now) : null;
      minions.push(minion(`fin.feed:${c.key}:${f.accountId}`, 'fin', 'Bank feed monitor', f.name, f.needsAttention ? 'alert' : age !== null && age > 3 ? 'watch' : 'clear', f.needsAttention ? 'QuickBooks says this bank connection needs to be reconnected.' : age !== null ? `Bank balance last refreshed ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.` : 'Refresh time unknown.', { weight: 45 }));
    }
  }
  for (const r of detected) {
    const financing = r.kind === 'loan' || r.kind === 'equipment_finance';
    const listed = financing ? loans.length + assets.length > 0 : (registers.obligations || []).length > 0;
    minions.push(minion(`fin.commit:${r.id}`, 'fin', 'Commitment spotter', `${r.payee} ${money(r.amount)} ${r.cadence}`, listed ? 'clear' : 'watch', listed ? `Seen ${r.seen} times in the bank feed; you have ${financing ? 'loans or equipment' : 'commitments'} on file.` : `Seen ${r.seen} times in the bank feed, next expected ${shortDate(r.nextDate, now)}. Not in your ${financing ? 'loans or equipment list' : 'fixed commitments'}.`, { weight: 25, amount: r.monthly, action: fixRegister(financing ? (r.kind === 'loan' ? 'loans' : 'equipment') : 'obligations', 'Add it') }));
  }
  if (bankInScope && bankInScope.truncated) minions.push(minion('fin.feed.truncated', 'fin', 'Bank feed monitor', 'Transaction history', 'watch', 'Only part of this year’s bank transactions could be loaded, so bank totals are understated.', { weight: 40 }));

  // ---- data for the sheet ----
  const months12 = rev.months.slice(-13);
  const data = {
    rev,
    months12,
    quarterTotal: rev.loaded ? sumMonths(rev.total, qNow) : null,
    ar,
    ap,
    cash,
    commit,
    detected,
    detectedMonthly,
    bank: bankInScope,
    bankYtd: bankInScope ? { months: bankYtd, in: bankIn, out: bankOut, byKind: mergeKinds(bankInScope, bankYtd), byPurpose: mergePurpose(bankInScope, bankYtd), unknownOut: unknownOut(bankInScope, bankYtd) } : null,
    companies: cos.map((c) => ({ key: c.key, name: c.name, hasCosts: c.hasCosts, bs: c.bs, feeds: c.feeds, recon: c.recon, tax: c.tax, loaded: c.loaded, revenueYtd: c.revenueYtd })),
    taxPaid,
    safe: cash.known ? round2(cash.amount - (reserve || 0) - next30 - (cash.cardOwing || 0)) : null,
    next30,
    loans,
  };

  const headline = [
    { label: 'Revenue this year', value: rev.loaded ? moneyShort(rev.ytd) : null, blind: !rev.loaded, hint: rev.loaded ? `${moneyShort(rev.thisMonth)} this month` : 'QuickBooks not read', go: { sheet: 'fin' } },
    { label: 'Owed to you', value: ar.loaded ? moneyShort(ar.total) : null, blind: !ar.loaded, hint: ar.loaded ? (ar.overdueTotal > 0 ? `${moneyShort(ar.overdueTotal)} overdue` : 'nothing overdue') : '', health: ar.overdueTotal > 0 ? 'watch' : 'good', go: { sheet: 'csh' } },
  ];
  return { items, headline, minions, data };
}

function mergeKinds(bank, months) {
  const out = {};
  for (const m of months) for (const [k, v] of Object.entries(bank.flows.byMonth[m].byKind)) out[k] = round2((out[k] || 0) + v);
  return out;
}
function mergePurpose(bank, months) {
  const out = {};
  for (const m of months) for (const [k, v] of Object.entries(bank.flows.byMonth[m].byPurpose)) out[k] = round2((out[k] || 0) + v);
  return out;
}
/** Money that left by cheque or e-transfer: Jarvis can see it went, not what it bought. */
function unknownOut(bank, months) {
  let t = 0;
  for (const m of months) t += (bank.flows.byMonth[m].byKind.cheque || 0) + (bank.flows.byMonth[m].byKind.etransfer_out || 0);
  return round2(t);
}

export default { key: 'fin', compute };
