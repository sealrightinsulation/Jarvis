// Thirteen-week cash forecast.
//
// Two lines, both starting from real cash in the bank:
//   known   only things Jarvis can point at: invoices owed to you by due date, payroll and
//           commitments you entered, loan and equipment payments, supplier bills, tax dates.
//   pace    what happens if money keeps arriving and leaving the bank the way it has for the
//           last eight weeks (only available where a bank feed exists).
// Every assumption is returned in `notes` so the sheet can print it under the chart.

import { inScope } from '../registers/schemas.js';
import { round2, toNum, parseDate, isoDate, addDays, weekStart, daysBetween } from '../app/format.js';
import { receivables, payables, cashPosition, occurrences, scopeKeys, anyBank, customerRollup, sameParty } from '../model/derive.js';

export const WEEKS = 13;

/**
 * @param {Object} ctx DomainContext
 * @returns {Forecast}
 */
export function cashForecast(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const start0 = weekStart(now);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const from = addDays(start0, i * 7);
    return { index: i, from: isoDate(from), to: isoDate(addDays(from, 6)), inflow: 0, outflow: 0, items: [] };
  });
  const horizonEnd = parseDate(weeks[WEEKS - 1].to);
  const notes = [];
  const weekOf = (iso) => {
    const d = parseDate(iso);
    if (!d) return null;
    const i = Math.floor(daysBetween(start0, d) / 7);
    return i >= 0 && i < WEEKS ? weeks[i] : null;
  };
  const add = (iso, amount, label, kind) => {
    const w = weekOf(iso);
    if (!w || !amount) return;
    if (amount > 0) w.inflow = round2(w.inflow + amount);
    else w.outflow = round2(w.outflow - amount);
    w.items.push({ date: iso, amount: round2(amount), label, kind });
  };
  const todayIso = isoDate(now);

  // ---- money in: invoices owed to you ----
  const ar = receivables(model, scope);
  const habits = customerRollup(model, scope);
  let overdueAssumed = 0;
  for (const inv of ar.invoices) {
    let when = inv.dueDate;
    if (inv.daysOverdue > 0 || !when) {
      // Already late: assume two weeks out, or the customer's usual lateness if longer.
      const habit = habits.find((h) => h.company === inv.company && sameParty(h.name, inv.customer));
      const usual = habit && habit.paidCount ? Math.round(habit.daysLateSum / habit.paidCount) : 0;
      when = isoDate(addDays(now, Math.max(14, Math.min(usual, 60))));
      overdueAssumed += 1;
    }
    add(when, inv.balance, `${inv.customer} invoice ${inv.number || ''}`.trim(), 'invoice');
  }
  if (ar.loaded && overdueAssumed) notes.push(`${overdueAssumed} overdue invoice${overdueAssumed === 1 ? '' : 's'} assumed to arrive two weeks from today (later for customers who usually pay late).`);
  if (!ar.loaded) notes.push('Invoices could not be read, so no money in is shown.');

  // ---- money out: payroll ----
  const payroll = scopeKeys(scope).reduce((t, k) => t + (toNum(k === 'ab' ? s.payrollAb : s.payrollSr) || 0), 0);
  let hasPayroll = false;
  if (payroll > 0 && s.payrollFrequency && s.payrollNextDate) {
    hasPayroll = true;
    for (const d of occurrences(s.payrollNextDate, s.payrollFrequency, now, horizonEnd)) add(d, -payroll, 'Payroll', 'payroll');
  }

  // ---- money out: what the owner has listed ----
  const obligations = (registers.obligations || []).filter((r) => inScope(r, scope) && toNum(r.amount) && r.frequency);
  for (const o of obligations) {
    const first = o.nextDue || isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    for (const d of occurrences(first, o.frequency, now, horizonEnd)) add(d, -toNum(o.amount), o.name, 'commitment');
  }
  const loans = (registers.loans || []).filter((r) => inScope(r, scope) && toNum(r.monthlyPayment));
  for (const l of loans) {
    const day = Math.min(28, Math.max(1, Number(l.paymentDay) || 1));
    let first = new Date(now.getFullYear(), now.getMonth(), day);
    if (first < now) first = new Date(now.getFullYear(), now.getMonth() + 1, day);
    for (const d of occurrences(isoDate(first), 'monthly', now, horizonEnd)) add(d, -toNum(l.monthlyPayment), l.name, 'loan');
  }
  const assets = (registers.equipment || []).filter((r) => inScope(r, scope) && toNum(r.monthlyPayment) && r.status !== 'retired');
  for (const e of assets) {
    const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    for (const d of occurrences(isoDate(first), 'monthly', now, horizonEnd)) {
      if (e.payoffDate && d > e.payoffDate) continue;
      add(d, -toNum(e.monthlyPayment), `${e.name} payment`, 'equipment');
    }
  }

  // ---- money out: repeating payments seen in the bank that nobody has listed yet ----
  const bank = anyBank(model);
  const bankInScope = bank && (scope === 'all' || scope === bank.company);
  let detectedUsed = 0;
  if (bankInScope) {
    for (const r of bank.recurring) {
      const financing = r.kind === 'loan' || r.kind === 'equipment_finance';
      if (financing && (loans.length || assets.length)) continue; // the owner's list wins
      if (!financing && obligations.length) continue;
      const freq = r.cadence === 'twice a month' ? 'semimonthly' : 'monthly';
      for (const d of occurrences(r.nextDate, freq, now, horizonEnd)) add(d, -r.amount, `${r.payee} (seen in bank feed)`, 'detected');
      detectedUsed += 1;
    }
    if (detectedUsed) notes.push(`${detectedUsed} repeating payment${detectedUsed === 1 ? '' : 's'} found in the bank feed ${detectedUsed === 1 ? 'is' : 'are'} included. Add them to your commitments or loans to replace the guess with your own figures.`);
  }

  // ---- money out: supplier bills (JobTread) ----
  const ap = payables(model, scope);
  let overdueBills = 0;
  for (const b of ap.bills) {
    let when = b.dueDate;
    if (!when || b.daysOverdue > 0) {
      when = isoDate(addDays(now, 7));
      overdueBills += 1;
    }
    add(when, -b.balance, `${b.account} bill`, 'bill');
  }
  if (overdueBills) notes.push(`${overdueBills} supplier bill${overdueBills === 1 ? '' : 's'} already past due ${overdueBills === 1 ? 'is' : 'are'} assumed paid next week. If JobTread just has not been marked paid, mark ${overdueBills === 1 ? 'it' : 'them'} there and this drops out.`);

  // ---- money out: tax ----
  const hst = scopeKeys(scope).reduce((t, k) => t + (toNum(k === 'ab' ? s.hstOwingAb : s.hstOwingSr) || 0), 0);
  if (hst > 0 && s.hstNextDue) add(s.hstNextDue, -hst, 'HST remittance', 'tax');
  if (toNum(s.corpTaxInstalment) && s.corpTaxNextDue) add(s.corpTaxNextDue, -toNum(s.corpTaxInstalment), 'Corporate tax instalment', 'tax');

  if (!hasPayroll) notes.push('Payroll is not in the forecast because pay frequency, next pay date and amount are not set.');
  if (!obligations.length && !detectedUsed) notes.push('No fixed commitments are listed, so rent, insurance and similar costs are missing.');

  // ---- roll forward ----
  const cash = cashPosition(model, settings, scope);
  const start = cash.amount;
  let bal = start ?? 0;
  let low = { balance: Infinity, week: null };
  for (const w of weeks) {
    w.net = round2(w.inflow - w.outflow);
    bal = round2(bal + w.net);
    w.balance = bal;
    if (bal < low.balance) low = { balance: bal, week: w };
    w.items.sort((a, b) => a.amount - b.amount);
  }
  if (start === null) notes.unshift('No bank balance is known, so the lines show the change from today rather than an actual balance.');
  else if (!cash.complete) notes.unshift('The starting balance covers only the bank account Jarvis can see. Advanced Builds has no bank connected and no balance typed in.');

  // ---- the "recent pace" line ----
  let pace = null;
  if (bankInScope && bank.runRate && bank.runRate.rows >= 10) {
    const netPerWeek = round2(bank.runRate.inPerWeek - bank.runRate.outPerWeek);
    let b = start ?? 0;
    pace = { netPerWeek, inPerWeek: bank.runRate.inPerWeek, outPerWeek: bank.runRate.outPerWeek, from: bank.runRate.from, to: bank.runRate.to, balances: weeks.map(() => (b = round2(b + netPerWeek))) };
  }

  const totalIn = round2(weeks.reduce((t, w) => t + w.inflow, 0));
  const totalOut = round2(weeks.reduce((t, w) => t + w.outflow, 0));
  return {
    weeks,
    start,
    startKnown: start !== null,
    startComplete: cash.complete,
    end: weeks[WEEKS - 1].balance,
    low: { balance: low.balance === Infinity ? null : low.balance, weekIndex: low.week ? low.week.index : null, from: low.week ? low.week.from : null },
    totalIn,
    totalOut,
    pace,
    notes,
    inputs: { hasPayroll, obligations: obligations.length, loans: loans.length, assets: assets.length, detected: detectedUsed, invoices: ar.invoices.length, bills: ap.bills.length },
    today: todayIso,
  };
}

/** Sum of forecast outflows that fall within the next `days` days. */
export function committedWithin(forecast, now, days) {
  const end = isoDate(addDays(now, days));
  let t = 0;
  for (const w of forecast.weeks) for (const it of w.items) if (it.amount < 0 && it.date <= end) t += -it.amount;
  return round2(t);
}

/**
 * @typedef {Object} Forecast
 * @property {Array<{index:number, from:string, to:string, inflow:number, outflow:number, net:number, balance:number, items:Array}>} weeks
 * @property {number|null} start
 * @property {boolean} startKnown
 * @property {boolean} startComplete
 * @property {number} end
 * @property {{balance:number|null, weekIndex:number|null, from:string|null}} low
 * @property {number} totalIn
 * @property {number} totalOut
 * @property {Object|null} pace
 * @property {string[]} notes
 * @property {Object} inputs
 */
