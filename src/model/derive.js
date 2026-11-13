// Shared calculations more than one sheet needs. All pure; all take the Model.
//
// Scope: 'all' | 'ab' | 'sr'. JobTread belongs to Advanced Builds ('ab').

import { COMPANIES, inScope } from '../registers/schemas.js';
import { round2, toNum, nameKey, daysBetween, parseDate, isoDate, addDays, weekStart, monthKey, addMonths } from '../app/format.js';

export const scopeKeys = (scope) => (scope === 'all' ? ['ab', 'sr'] : [scope]);
export const companiesIn = (model, scope) => scopeKeys(scope).map((k) => model.companies[k]).filter(Boolean);
export const jtIn = (model, scope) => (scope === 'sr' ? null : model.jt);
export const scopeName = (scope) => (scope === 'all' ? 'both companies' : COMPANIES[scope].name);

/** Loose name match across systems ("Greg Howe" vs "Greig Howe", "Allen" vs "Allen & Suzette"). */
export function sameParty(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return x.length >= 6 && y.length >= 6 && editDistance(x, y) <= 1;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ---------- revenue ----------

/** Invoiced revenue (before HST) by month, combined over the companies in scope. */
export function revenueSeries(model, scope) {
  const cos = companiesIn(model, scope).filter((c) => c.loaded.pnl);
  const months = cos.length ? cos[0].months : [];
  const byCompany = {};
  const total = {};
  for (const m of months) total[m] = 0;
  for (const c of cos) {
    byCompany[c.key] = c.revenue;
    for (const m of months) total[m] = round2(total[m] + (c.revenue[m] || 0));
  }
  const sumOf = (f) => (cos.length ? round2(cos.reduce((t, c) => t + (f(c) || 0), 0)) : null);
  return {
    loaded: cos.length > 0,
    partial: cos.length < scopeKeys(scope).length,
    months,
    total,
    byCompany,
    ytd: sumOf((c) => c.revenueYtd),
    prevYtd: cos.length && cos.every((c) => c.revenuePrevYtd !== null) ? sumOf((c) => c.revenuePrevYtd) : null,
    prevFull: sumOf((c) => c.revenuePrevFull),
    ttm: sumOf((c) => c.revenueTtm),
    thisMonth: sumOf((c) => c.revenueThisMonth),
    // Books only describe profit when costs are being recorded in every company in scope.
    hasCosts: cos.length > 0 && cos.every((c) => c.hasCosts),
    costsYtd: sumOf((c) => c.costsYtd),
  };
}

/** Sum a month-keyed series over a quarter / year helper. */
export function sumMonths(series, months) {
  return round2(months.reduce((t, m) => t + (series[m] || 0), 0));
}

export function quarterMonths(now, offset = 0) {
  const q = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), q * 3, 1);
  return [0, 1, 2].map((i) => monthKey(addMonths(start, i)));
}

// ---------- receivables ----------

/**
 * Money owed to the companies, from QuickBooks invoices (the invoicing system for both).
 * @returns {{loaded, partial, invoices, total, overdue, overdueTotal, buckets, byCustomer, dueWithin: (days) => number}}
 */
export function receivables(model, scope) {
  const cos = companiesIn(model, scope);
  const loadedCos = cos.filter((c) => c.loaded.openInvoices);
  const invoices = [];
  for (const c of loadedCos) for (const i of c.openInvoices) invoices.push({ ...i, company: c.key, companyName: c.name });
  invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  for (const i of invoices) {
    const k = i.daysOverdue <= 0 ? 'current' : i.daysOverdue <= 30 ? 'd1_30' : i.daysOverdue <= 60 ? 'd31_60' : i.daysOverdue <= 90 ? 'd61_90' : 'd90';
    buckets[k] = round2(buckets[k] + i.balance);
  }
  const byCust = new Map();
  for (const i of invoices) {
    const k = `${i.company}:${i.customerId || nameKey(i.customer)}`;
    const e = byCust.get(k) || { customer: i.customer, company: i.company, balance: 0, overdue: 0, invoices: 0, oldest: 0 };
    e.balance = round2(e.balance + i.balance);
    if (i.daysOverdue > 0) e.overdue = round2(e.overdue + i.balance);
    e.invoices += 1;
    e.oldest = Math.max(e.oldest, i.daysOverdue);
    byCust.set(k, e);
  }
  const overdue = invoices.filter((i) => i.daysOverdue > 0);
  return {
    loaded: loadedCos.length > 0,
    partial: loadedCos.length < cos.length,
    invoices,
    total: round2(invoices.reduce((t, i) => t + i.balance, 0)),
    overdue,
    overdueTotal: round2(overdue.reduce((t, i) => t + i.balance, 0)),
    buckets,
    byCustomer: [...byCust.values()].sort((a, b) => b.balance - a.balance),
    // Unapplied credits make the balance-sheet A/R smaller than the open invoices.
    bookAr: loadedCos.every((c) => c.bs) ? round2(loadedCos.reduce((t, c) => t + (c.bs ? c.bs.ar : 0), 0)) : null,
  };
}

// ---------- payables (JobTread supplier bills; QuickBooks carries none) ----------

export function payables(model, scope) {
  const jt = jtIn(model, scope);
  if (!jt || !jt.loaded.docs.vendorBill) return { loaded: false, bills: [], total: 0, overdueTotal: 0, overdue: [], byVendor: [] };
  const today = parseDate(model.today);
  const bills = jt.docs
    .filter((d) => d.type === 'vendorBill' && d.balance > 0.005 && d.status !== 'draft' && d.status !== 'denied')
    .map((d) => ({ ...d, daysOverdue: d.dueDate ? Math.max(0, daysBetween(d.dueDate, today) || 0) : 0 }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
  const overdue = bills.filter((b) => b.daysOverdue > 0);
  return {
    loaded: true,
    bills,
    total: round2(bills.reduce((t, b) => t + b.balance, 0)),
    overdue,
    overdueTotal: round2(overdue.reduce((t, b) => t + b.balance, 0)),
    byVendor: jt.vendors.filter((v) => v.unpaid > 0).sort((a, b) => b.unpaid - a.unpaid),
  };
}

// ---------- cash ----------

/**
 * Real cash, never QuickBooks' book balance (which only ever counts money coming in).
 * Order of trust per company: a figure the owner typed in (if newer than the feed), then the
 * bank feed's own balance, then nothing.
 */
export function cashPosition(model, settings, scope) {
  const s = settings.main || {};
  const parts = [];
  for (const k of scopeKeys(scope)) {
    const bank = model.banks[k];
    const manual = toNum(k === 'ab' ? s.cashAb : s.cashSr);
    const manualAsOf = k === 'ab' ? s.cashAbAsOf : s.cashSrAsOf;
    const feedAsOf = bank && bank.lastUpdated ? String(bank.lastUpdated).slice(0, 10) : null;
    if (manual !== null && (!bank || bank.cashBalance === null || (manualAsOf && feedAsOf && manualAsOf >= feedAsOf))) {
      parts.push({ company: k, amount: manual, asOf: manualAsOf || null, source: 'typed in by you' });
    } else if (bank && bank.cashBalance !== null) {
      parts.push({ company: k, amount: bank.cashBalance, asOf: feedAsOf, source: `bank feed (${bank.accounts.filter((a) => a.type === 'bank').map((a) => a.name).join(', ')})`, feed: true });
    } else if (manual !== null) {
      parts.push({ company: k, amount: manual, asOf: manualAsOf || null, source: 'typed in by you' });
    } else {
      parts.push({ company: k, amount: null, asOf: null, source: 'none' });
    }
  }
  const known = parts.filter((p) => p.amount !== null);
  const cardOwing = scopeKeys(scope).reduce((t, k) => t + ((model.banks[k] && model.banks[k].cardOwing) || 0), 0);
  return {
    known: known.length > 0,
    complete: known.length === parts.length,
    amount: known.length ? round2(known.reduce((t, p) => t + p.amount, 0)) : null,
    parts,
    cardOwing: round2(cardOwing),
    asOf: known.map((p) => p.asOf).filter(Boolean).sort()[0] || null,
  };
}

/** The bank view to use for a scope (today only Seal Right's file has feeds). */
export function bankIn(model, scope) {
  for (const k of scopeKeys(scope)) if (model.banks[k] && model.banks[k].rowsLoaded) return model.banks[k];
  // In a single-company view with no feed of its own, still surface the group's only feed.
  return null;
}
export function anyBank(model) {
  return Object.values(model.banks).find((b) => b && b.rowsLoaded) || null;
}

// ---------- pipeline ----------

/**
 * Open quotes from both systems: JobTread proposals awaiting an answer and QuickBooks estimates
 * still pending. A quote that appears in both (same customer, same total) is counted once.
 */
export function openQuotes(model, scope) {
  const today = parseDate(model.today);
  const out = [];
  const jt = jtIn(model, scope);
  if (jt && jt.loaded.docs.customerOrder) {
    for (const d of jt.docs) {
      if (d.type !== 'customerOrder' || d.status !== 'pending') continue;
      out.push({ id: `jt:${d.id}`, system: 'JobTread', company: 'ab', customer: d.account, title: d.job || d.name, value: d.price, valueWithTax: d.priceWithTax, cost: d.cost, date: d.issueDate, ageDays: d.issueDate ? Math.max(0, daysBetween(d.issueDate, today) || 0) : null, jobId: d.jobId });
    }
  }
  for (const c of companiesIn(model, scope)) {
    if (!c.loaded.estimates) continue;
    for (const e of c.estimates) {
      if (e.status !== 'pending') continue;
      const dup = out.some((q) => q.company === c.key && q.system === 'JobTread' && sameParty(q.customer, e.customer) && Math.abs(q.valueWithTax - e.total) <= Math.max(1, e.total * 0.01));
      if (dup) continue;
      out.push({ id: `qbo:${c.key}:${e.id}`, system: 'QuickBooks', company: c.key, customer: e.customer, title: e.number ? `Estimate ${e.number}` : 'Estimate', value: round2(e.total / 1.13), valueWithTax: e.total, cost: null, date: e.date, ageDays: e.ageDays, jobId: null });
    }
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

/** Quote outcomes over a window (default: this calendar year), both systems. */
export function quoteOutcomes(model, scope, sinceIso) {
  const since = sinceIso || `${model.today.slice(0, 4)}-01-01`;
  const o = { won: 0, wonValue: 0, lost: 0, lostValue: 0, expired: 0, expiredValue: 0, pending: 0, pendingValue: 0, loaded: false };
  const jt = jtIn(model, scope);
  if (jt && jt.loaded.docs.customerOrder) {
    o.loaded = true;
    for (const d of jt.docs) {
      if (d.type !== 'customerOrder' || d.isChangeOrder || !d.issueDate || d.issueDate < since) continue;
      if (d.status === 'approved') (o.won += 1), (o.wonValue += d.price);
      else if (d.status === 'denied') (o.lost += 1), (o.lostValue += d.price);
      else if (d.status === 'pending') (o.pending += 1), (o.pendingValue += d.price);
    }
  }
  for (const c of companiesIn(model, scope)) {
    if (!c.loaded.estimates) continue;
    o.loaded = true;
    for (const e of c.estimates) {
      if (!e.date || e.date < since) continue;
      const v = e.total / 1.13;
      if (e.status === 'accepted') (o.won += 1), (o.wonValue += v);
      else if (e.status === 'rejected') (o.lost += 1), (o.lostValue += v);
      else if (e.status === 'expired') (o.expired += 1), (o.expiredValue += v);
      else (o.pending += 1), (o.pendingValue += v);
    }
  }
  for (const k of ['wonValue', 'lostValue', 'expiredValue', 'pendingValue']) o[k] = round2(o[k]);
  const decided = o.won + o.lost + o.expired;
  o.decided = decided;
  o.rate = decided ? o.won / decided : null;
  o.rateByValue = o.wonValue + o.lostValue + o.expiredValue > 0 ? o.wonValue / (o.wonValue + o.lostValue + o.expiredValue) : null;
  return o;
}

/** Signed work not yet invoiced, per active JobTread job. */
export function backlog(model, scope) {
  const jt = jtIn(model, scope);
  if (!jt || !jt.loaded.jobs) return { loaded: false, jobs: [], total: 0 };
  const jobs = jt.jobs
    .filter((j) => j.stage === 'active')
    .map((j) => ({ id: j.id, name: j.name, customer: j.customer, contract: j.contract, invoiced: j.invoiced, remaining: round2(Math.max(0, j.contract - j.invoiced)) }))
    .sort((a, b) => b.remaining - a.remaining);
  return { loaded: true, jobs, total: round2(jobs.reduce((t, j) => t + j.remaining, 0)) };
}

// ---------- customers ----------

/** One row per customer across systems: revenue, what they owe, how they pay. */
export function customerRollup(model, scope) {
  const map = new Map();
  const get = (name, company) => {
    for (const e of map.values()) if (e.company === company && sameParty(e.name, name)) return e;
    const e = { key: `${company}:${nameKey(name)}`, name, company, ytd: 0, prevYtd: 0, prevFull: 0, open: 0, overdue: 0, paidCount: 0, paidLate: 0, daysToPaySum: 0, daysLateSum: 0, jobs: 0, contract: 0, projectedMargin: null, quotes: 0 };
    map.set(e.key, e);
    return e;
  };
  for (const c of companiesIn(model, scope)) {
    for (const r of c.customers) {
      const e = get(r.name, c.key);
      e.ytd = round2(e.ytd + r.ytd);
      e.prevYtd = round2(e.prevYtd + (r.prevYtd || 0));
      e.prevFull = round2(e.prevFull + (r.prevFull || 0));
    }
    for (const i of c.openInvoices) {
      const e = get(i.customer, c.key);
      e.open = round2(e.open + i.balance);
      if (i.daysOverdue > 0) e.overdue = round2(e.overdue + i.balance);
    }
    for (const i of c.paidInvoices) {
      const e = get(i.customer, c.key);
      e.paidCount += 1;
      if (i.daysLate > 0) e.paidLate += 1;
      e.daysToPaySum += i.daysToPay || 0;
      e.daysLateSum += i.daysLate || 0;
    }
  }
  const jt = jtIn(model, scope);
  if (jt) {
    for (const j of jt.jobs) {
      if (!j.customer) continue;
      const e = get(j.customer, 'ab');
      e.jobs += 1;
      if (j.stage === 'quoted') e.quotes += 1;
      if (j.stage === 'active') {
        e.contract = round2(e.contract + j.contract);
        if (j.projectedPrice !== null && j.projectedCost !== null) e.projectedMargin = round2((e.projectedMargin || 0) + (j.projectedPrice - j.projectedCost));
      }
    }
  }
  return [...map.values()].map((e) => ({
    ...e,
    avgDaysToPay: e.paidCount ? Math.round(e.daysToPaySum / e.paidCount) : null,
    lateShare: e.paidCount ? e.paidLate / e.paidCount : null,
    repeat: e.ytd > 0 && e.prevFull > 0,
  }));
}

// ---------- commitments ----------

const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };
export const perMonth = (amount, frequency) => round2((toNum(amount) || 0) * (PER_MONTH[frequency] || 0));

/**
 * What goes out every month no matter what: payroll (settings), fixed commitments (register),
 * loan and equipment payments (registers). Bank-detected recurring payments are reported
 * separately so the owner can confirm them rather than have them silently assumed.
 */
export function monthlyCommitments(registers, settings, scope) {
  const s = settings.main || {};
  const lines = [];
  const payroll = scopeKeys(scope).reduce((t, k) => t + (toNum(k === 'ab' ? s.payrollAb : s.payrollSr) || 0), 0);
  if (payroll > 0 && s.payrollFrequency) lines.push({ kind: 'payroll', label: 'Payroll', monthly: perMonth(payroll, s.payrollFrequency), source: 'your payroll settings' });
  for (const o of (registers.obligations || []).filter((r) => inScope(r, scope))) {
    if (toNum(o.amount) && o.frequency) lines.push({ kind: 'obligation', label: o.name, monthly: perMonth(o.amount, o.frequency), source: 'fixed commitments', id: o.id });
  }
  for (const l of (registers.loans || []).filter((r) => inScope(r, scope))) {
    if (toNum(l.monthlyPayment)) lines.push({ kind: 'loan', label: l.name, monthly: round2(toNum(l.monthlyPayment)), source: 'loans and credit', id: l.id });
  }
  for (const e of (registers.equipment || []).filter((r) => inScope(r, scope))) {
    if (toNum(e.monthlyPayment) && e.status !== 'retired') lines.push({ kind: 'equipment', label: e.name, monthly: round2(toNum(e.monthlyPayment)), source: 'equipment list', id: e.id });
  }
  return { lines, total: round2(lines.reduce((t, l) => t + l.monthly, 0)), hasPayroll: payroll > 0 && !!s.payrollFrequency };
}

/** All dates a repeating commitment falls on inside [from, to]. */
export function occurrences(startIso, frequency, from, to) {
  const out = [];
  let d = parseDate(startIso);
  if (!d) return out;
  const step = (x) => {
    switch (frequency) {
      case 'weekly':
        return addDays(x, 7);
      case 'biweekly':
        return addDays(x, 14);
      case 'semimonthly':
        return addDays(x, 15);
      case 'monthly':
        return addMonths(x, 1);
      case 'quarterly':
        return addMonths(x, 3);
      case 'annual':
        return addMonths(x, 12);
      default:
        return null;
    }
  };
  let guard = 0;
  // Roll a past start date forward to the window.
  while (d < from && guard < 600) {
    const n = step(d);
    if (!n) return out;
    d = n;
    guard += 1;
  }
  while (d <= to && guard < 900) {
    out.push(isoDate(d));
    const n = step(d);
    if (!n) break;
    d = n;
    guard += 1;
  }
  return out;
}

export { weekStart };
