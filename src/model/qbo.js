// QuickBooks payloads -> one normalized Company per QuickBooks file.
//
// Everything here is defensive: a section that failed to load is left null/empty and recorded in
// company.loaded, never guessed. Report columns are addressed by position and col_key because
// QuickBooks' column keys are display labels that change daily ("Nov. 1-12, 2026").

import { toNum, round2, daysBetween, parseDate, monthKey, addMonths } from '../app/format.js';

const ok = (done, key) => (done[key] && done[key].status === 'ok' ? done[key].payload : null);
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- generic report helpers ----------

/** Money columns of a report in order, without the label column. */
export function moneyColumns(payload) {
  return arr(payload && payload.columns).filter((c) => c && c.type === 'Money');
}

/** First top-level Summary row for a group ('Income', 'COGS', 'Expenses', 'NetIncome', ...). */
export function summaryRow(payload, group) {
  const pools = [arr(payload && payload.totals), arr(payload && payload.rows)];
  for (const pool of pools) {
    const hit = pool.find((r) => r && r.kind === 'Summary' && r.group === group);
    if (hit) return hit;
  }
  return null;
}

const val = (row, col) => {
  if (!row || !row.values || !col) return null;
  const v = row.values[col.key];
  return typeof v === 'number' && Number.isFinite(v) ? v : toNum(v);
};

// ---------- profit and loss by month ----------

/**
 * @param {any} payload reports_profit_and_loss summarized by Month
 * @param {string} startIso first day of the first month requested
 */
export function parsePnlByMonth(payload, startIso) {
  if (!payload || !Array.isArray(payload.rows)) return null;
  const start = parseDate(startIso);
  const cols = moneyColumns(payload).filter((c) => c.col_key !== 'total');
  const months = cols.map((_, i) => monthKey(addMonths(new Date(start.getFullYear(), start.getMonth(), 1), i)));
  const series = (group) => {
    const row = summaryRow(payload, group);
    const out = {};
    months.forEach((m, i) => {
      out[m] = row ? round2(val(row, cols[i]) || 0) : 0;
    });
    return out;
  };
  const revenue = series('Income');
  const cogs = series('COGS');
  const expenses = series('Expenses');
  // Other expense sections, if the books ever grow them.
  const other = series('OtherExpenses');
  for (const m of months) expenses[m] = round2(expenses[m] + (other[m] || 0));
  return { months, revenue, cogs, expenses, hasIncomeRow: !!summaryRow(payload, 'Income') };
}

// ---------- balance sheet ----------

export function parseBalanceSheet(payload) {
  if (!payload || !Array.isArray(payload.rows)) return null;
  const col = moneyColumns(payload).find((c) => c.col_key === 'total') || moneyColumns(payload)[0];
  const data = payload.rows.filter((r) => r && r.kind === 'Data');
  const pick = (group) => data.filter((r) => r.group === group).map((r) => ({ id: r.id ? String(r.id) : null, name: r.label, value: round2(val(r, col) || 0) }));
  const bankish = pick('BankAccounts');
  const undeposited = bankish.filter((a) => /undeposited/i.test(a.name));
  const bankAccounts = bankish.filter((a) => !/undeposited/i.test(a.name));
  const otherLiab = pick('OtherCurrentLiabilities');
  const tot = (group) => {
    const r = summaryRow(payload, group);
    return r ? round2(val(r, col) || 0) : null;
  };
  const sumOf = (list) => round2(list.reduce((t, a) => t + a.value, 0));
  const liabilitiesRow = payload.rows.find((r) => r && r.kind === 'Summary' && r.group === 'Liabilities');
  const equityRow = payload.rows.find((r) => r && r.kind === 'Summary' && r.group === 'Equity');
  return {
    asOf: (payload.meta && payload.meta.period && payload.meta.period.end) || null,
    bankAccounts,
    bookCash: sumOf(bankAccounts),
    undeposited: sumOf(undeposited),
    ar: sumOf(pick('AR')),
    cards: pick('CreditCards'),
    hstPayable: sumOf(otherLiab.filter((a) => /gst|hst/i.test(a.name))),
    otherCurrentLiabilities: otherLiab.filter((a) => !/gst|hst/i.test(a.name)),
    ap: sumOf(pick('AP')),
    loans: [...pick('LongTermLiabilities'), ...pick('LongTermLiability')],
    fixedAssets: sumOf([...pick('FixedAssets'), ...pick('FixedAsset')]),
    totalAssets: tot('TotalAssets'),
    totalLiabilities: liabilitiesRow ? round2(val(liabilitiesRow, col) || 0) : null,
    equity: equityRow ? round2(val(equityRow, col) || 0) : null,
  };
}

// ---------- sales by customer ----------

export function parseCustomerSales(payload) {
  if (!payload || !Array.isArray(payload.rows)) return null;
  const cols = moneyColumns(payload);
  const cur = cols.find((c) => c.col_key === 'total') || cols[0];
  const py = cols.find((c) => c.col_key === 'subcol_py') || null;
  const rows = payload.rows
    .filter((r) => r && r.kind === 'Data' && r.label)
    .map((r) => ({ id: r.id ? String(r.id) : null, name: r.label, amount: round2(val(r, cur) || 0), prev: py ? round2(val(r, py) || 0) : null }));
  const totalRow = summaryRow(payload, 'GrandTotal');
  return { rows, total: totalRow ? round2(val(totalRow, cur) || 0) : round2(rows.reduce((t, r) => t + r.amount, 0)), prevTotal: totalRow && py ? round2(val(totalRow, py) || 0) : null };
}

// ---------- transactions ----------

function parseInvoices(payload, today) {
  return arr(payload && payload.items)
    .filter((t) => t && t.type === 'Invoice' && !t.voided)
    .map((t) => {
      const balance = toNum(t.balance) || 0;
      const dueDate = t.due_date || t.txn_date || null;
      const past = dueDate ? daysBetween(dueDate, today) : null;
      return {
        id: String(t.id),
        number: t.doc_number || '',
        customer: (t.contact && t.contact.name) || 'Unknown customer',
        customerId: t.contact && t.contact.id ? String(t.contact.id) : null,
        date: t.txn_date || null,
        dueDate,
        total: round2(toNum(t.total) || 0),
        balance: round2(balance),
        daysOverdue: past !== null && past > 0 ? past : 0,
        daysUntilDue: past !== null && past <= 0 ? -past : 0,
        paidDate: t.paid_date || null,
      };
    });
}

const ESTIMATE_STATUS = { pending: 'pending', accepted: 'accepted', closed: 'accepted', converted: 'accepted', rejected: 'rejected', expired: 'expired' };

function parseEstimates(payload, today) {
  return arr(payload && payload.items)
    .filter((t) => t && t.type === 'Estimate' && !t.voided)
    .map((t) => ({
      id: String(t.id),
      number: t.doc_number || '',
      customer: (t.contact && t.contact.name) || 'Unknown customer',
      customerId: t.contact && t.contact.id ? String(t.contact.id) : null,
      date: t.txn_date || null,
      total: round2(toNum(t.total) || 0), // includes HST
      status: ESTIMATE_STATUS[String(t.status || '').toLowerCase()] || 'pending',
      rawStatus: t.status || '',
      ageDays: t.txn_date ? Math.max(0, daysBetween(t.txn_date, today) || 0) : null,
    }));
}

// ---------- bank feeds, reconciliation, tax ----------

function parseFeeds(payload) {
  return arr(payload && payload.items)
    .filter((f) => f && f.account && f.account.id)
    .map((f) => ({
      accountId: String(f.account.id),
      name: f.account.name || 'Account',
      type: /credit/i.test(f.account_type || '') ? 'card' : 'bank',
      institution: (f.institution && f.institution.name) || '',
      bankBalance: toNum(f.bank_balance),
      bookBalance: toNum(f.book_balance),
      lastUpdated: f.last_updated || null,
      needsAttention: !!f.needs_attention,
      pendingCount: Number(f.pending_count) || 0,
    }));
}

function parseRecon(payload) {
  return arr(payload && payload.items)
    .filter((r) => r && r.account && /^(bank|credit card)$/i.test(r.account_type || ''))
    .map((r) => {
      const last = r.last && typeof r.last === 'object' ? r.last : {};
      return {
        accountId: String(r.account.id),
        name: r.account.name || 'Account',
        type: /credit/i.test(r.account_type) ? 'card' : 'bank',
        lastDate: last.statement_ending_date || last.statement_date || last.ending_date || r.statement_ending_date || null,
        connected: !!r.is_bank_connected,
      };
    });
}

function parseTax(payload) {
  if (!payload || !Array.isArray(payload.rows) || (payload.meta && payload.meta.no_data)) return null;
  const col = moneyColumns(payload).find((c) => c.col_key === 'total') || moneyColumns(payload)[0];
  const line = (g) => {
    const r = payload.rows.find((x) => x && x.group === g);
    return r ? round2(val(r, col) || 0) : 0;
  };
  return { sales: line('Line 101'), collected: line('Line 105') || line('Line 103'), itc: line('Line 108') || line('Line 106'), net: line('Line 109') || round2((line('Line 105') || line('Line 103')) - (line('Line 108') || line('Line 106'))) };
}

// ---------- the company ----------

/**
 * @param {{key: string, name: string}} company
 * @param {Object} done loader output (key -> source state)
 * @param {Date} now
 */
export function normalizeCompany(company, done, now) {
  const k = (name) => `qbo.${company.key}.${name}`;
  const today = now;
  const y = now.getFullYear();
  const pnl = parsePnlByMonth(ok(done, k('pnl')), `${y - 1}-01-01`);
  const bs = parseBalanceSheet(ok(done, k('bs')));
  const custYtd = parseCustomerSales(ok(done, k('custYtd')));
  const custPrev = parseCustomerSales(ok(done, k('custPrev')));
  const openP = ok(done, k('openInv'));
  const paidP = ok(done, k('paidInv'));
  const estP = ok(done, k('estimates'));
  const feedsP = ok(done, k('feeds'));

  const thisMonth = monthKey(now);
  const months = pnl ? pnl.months : [];
  const ytdMonths = months.filter((m) => m.startsWith(String(y)));
  const prevMonths = months.filter((m) => m.startsWith(String(y - 1)));
  const sumM = (obj, list) => round2(list.reduce((t, m) => t + (obj[m] || 0), 0));
  // Trailing 12 FULL months (the current, partial month is left out).
  const idx = months.indexOf(thisMonth);
  const ttmMonths = idx >= 12 ? months.slice(idx - 12, idx) : idx >= 0 ? months.slice(0, idx) : months.slice(-12);
  const costInTtm = pnl ? ttmMonths.filter((m) => (pnl.cogs[m] || 0) !== 0 || (pnl.expenses[m] || 0) !== 0).length : 0;

  // Customers: merge this-year and last-year lists by id (falling back to name).
  const customers = new Map();
  const keyOf = (r) => r.id || `n:${r.name}`;
  for (const r of (custYtd && custYtd.rows) || []) customers.set(keyOf(r), { id: r.id, name: r.name, ytd: r.amount, prevYtd: r.prev || 0, prevFull: 0 });
  for (const r of (custPrev && custPrev.rows) || []) {
    const c = customers.get(keyOf(r)) || { id: r.id, name: r.name, ytd: 0, prevYtd: 0, prevFull: 0 };
    c.prevFull = r.amount;
    customers.set(keyOf(r), c);
  }

  const openInvoices = parseInvoices(openP, today).filter((i) => i.balance > 0.005);
  const paidInvoices = parseInvoices(paidP, today)
    .filter((i) => i.paidDate)
    .map((i) => ({ ...i, daysToPay: daysBetween(i.date, i.paidDate), daysLate: Math.max(0, daysBetween(i.dueDate, i.paidDate) || 0) }));

  return {
    key: company.key,
    name: company.name,
    loaded: {
      pnl: !!pnl,
      bs: !!bs,
      customers: !!custYtd,
      customersPrev: !!custPrev,
      openInvoices: !!openP,
      paidInvoices: !!paidP,
      estimates: !!estP,
      feeds: !!feedsP,
      recon: !!ok(done, k('recon')),
      tax: !!ok(done, k('taxYtd')),
    },
    truncated: { openInvoices: !!(openP && openP.truncated), paidInvoices: !!(paidP && paidP.truncated), estimates: !!(estP && estP.truncated) },
    months,
    revenue: pnl ? pnl.revenue : {},
    cogs: pnl ? pnl.cogs : {},
    expenses: pnl ? pnl.expenses : {},
    revenueYtd: pnl ? sumM(pnl.revenue, ytdMonths) : null,
    revenuePrevFull: pnl ? sumM(pnl.revenue, prevMonths) : null,
    revenuePrevYtd: custYtd && custYtd.prevTotal !== null ? custYtd.prevTotal : null,
    revenueTtm: pnl ? sumM(pnl.revenue, ttmMonths) : null,
    revenueThisMonth: pnl ? pnl.revenue[thisMonth] || 0 : null,
    ttmMonths,
    costsYtd: pnl ? round2(sumM(pnl.cogs, ytdMonths) + sumM(pnl.expenses, ytdMonths)) : null,
    // The books only mean "profit" when costs are actually being recorded.
    hasCosts: costInTtm >= 6,
    costMonthsInTtm: costInTtm,
    customers: [...customers.values()],
    bs,
    openInvoices,
    paidInvoices,
    estimates: parseEstimates(estP, today),
    feeds: parseFeeds(feedsP),
    recon: parseRecon(ok(done, k('recon'))),
    tax: { ytd: parseTax(ok(done, k('taxYtd'))), quarter: parseTax(ok(done, k('taxQtr'))) },
  };
}
