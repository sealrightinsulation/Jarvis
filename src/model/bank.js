// Bank-feed intelligence.
//
// QuickBooks holds invoices but (today) no expenses, so the connected bank feed is the only
// place real money movement can be seen. This module turns raw feed rows into something an
// owner can read: what kind of movement each row is, what it was probably for, monthly money
// in and out with transfers taken out, payments that recur, and bounced payments.
//
// It classifies on the bank's own description text (never on QuickBooks' category guesses,
// which are low-confidence on un-reviewed rows). Anything it cannot place is called "unknown",
// not guessed.

import { toNum, round2, parseDate, daysBetween, isoDate, addDays } from '../app/format.js';

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Split a fixed-width bank description into [head, tail] on runs of 2+ spaces. */
function headTail(raw) {
  const parts = String(raw || '').trim().split(/\s{2,}/);
  return [squash(parts[0] || '').toUpperCase(), squash(parts.slice(1).join(' ')).toUpperCase()];
}

// What the money was for, when the merchant text makes it clear.
const PURPOSE_RULES = [
  ['fuel', /\b(ESSO|PETRO[- ]?CAN|PETROLEUM|SHELL|PIONEER|ULTRAMAR|HUSKY|MOBIL|GAS BAR|BREAKAWAY G|CIRCLE K|DOUBLE SEVEN GAS|FUEL|SUNOCO|CANADIAN TIRE GAS)/],
  ['equipment_rental', /\b(EQUIPMENT RENT|RENTL|RENTAL|SUNBELT|UNITED RENTALS|BATTLEFIELD)/],
  ['materials', /\b(HOME HARDWARE|HOME HDW|HME HDW|RONA|HOME DEPOT|HOME BUIL|BUILD SUPPLY|BUILDING CE|LUMBER|TIMBER ?MART|PRINCESS AUTO|LOWE'?S|CASTLE|FASTENAL|INSULATION|ROOFMART|STEEL)/],
  ['vehicle', /\b(AUTO PARTS|NAPA|MTO |SERVICEONTARIO|OIL CHA|TIRE|MIDAS|MR LUBE|TRUCK|TRAILER|CAR WASH|407 ETR)/],
  ['software', /\b(INTUIT|QBOOKS|QUICKBOOKS|MICROSOFT|GOOGLE|SMARTDRAW|ADOBE|APPLE\.COM|JOBTREAD|DROPBOX|ZOOM|OPENAI|ANTHROPIC|CLAUDE)/],
  ['utilities', /\b(ENBRIDGE|HYDRO|WASTE CONNECTIONS|SOLID WASTE|BELL |ROGERS|TELUS|COGECO|UNION GAS|WATER)/],
  ['meals', /\b(WENDY|SUBWAY|TIM HORTON|MCDONALD|A&W|PIZZA|RESTAURANT|BURGER|COFFEE|THE HIDE OUT|BAR & GRILL|DAIRY QUEEN|STARBUCKS)/],
  ['insurance', /\b(INSURANCE|ASSURANCE|DOMINION OF CANADA|UNICA|INTACT|AVIVA|ECONOMICAL|CO-?OPERATORS|MANULIFE|SUN LIFE|WSIB)/],
];

function purposeOf(text) {
  for (const [name, re] of PURPOSE_RULES) if (re.test(text)) return name;
  return 'unknown';
}

/**
 * Classify one feed row.
 * @param {{id: string, txn_date: string, amount: string|number, original_description?: string, description?: string, merchant_name?: string, state?: string}} row
 * @param {'bank'|'card'} accountType
 * @returns {BankRow}
 *
 * kind (how the money moved):
 *   deposit | etransfer_in | etransfer_out | cheque | cheque_reversal | card_payment | transfer |
 *   correction | tax | equipment_finance | loan | insurance | bill_payment | pad | purchase |
 *   refund | cash | fees | interest | nsf_return | other
 * purpose (what it was for): fuel | materials | equipment_rental | vehicle | software | utilities |
 *   meals | insurance | tax | financing | fees | unknown
 * transfer: true when the row only moves money between the owner's own accounts (or reverses
 *   an entry) and so is neither income nor spending.
 */
export function classifyBankRow(row, accountType = 'bank') {
  const amount = toNum(row.amount) || 0;
  const raw = row.original_description || row.bank_memo || row.description || '';
  const [head, tail] = headTail(raw);
  const text = `${head} ${tail}`.trim();
  const out = amount < 0;
  let kind = 'other';
  let purpose = 'unknown';
  let transfer = false;
  let payee = '';

  if (accountType === 'card') {
    if (/^PAYMENT FROM|PAYMENT - THANK YOU|PAYMENT RECEIVED|SCOTIABANK TRANSIT/.test(text) && !out) {
      kind = 'card_payment';
      transfer = true;
    } else if (/INTEREST CHARGE/.test(text)) {
      kind = 'interest';
      purpose = 'fees';
    } else if (/\bFEE\b|OVERLIMIT|ANNUAL FEE/.test(text)) {
      kind = 'fees';
      purpose = 'fees';
    } else if (out) {
      kind = 'purchase';
      purpose = purposeOf(text);
      payee = merchantKey(row.merchant_name || text);
    } else {
      kind = 'refund';
      purpose = purposeOf(text);
    }
  } else if (/CREDIT CARD\/LOC PAY|^CREDIT CARD PAYMENT|MASTERCARD|\bVISA\b/.test(text) && out) {
    kind = 'card_payment';
    transfer = true;
    payee = /MASTERCARD/.test(text) ? 'Mastercard' : 'Card / line of credit';
  } else if (/^CUSTOMER TRANSFER|MB-TRANSFER|^TRANSFER\b/.test(text)) {
    kind = 'transfer';
    transfer = true;
  } else if (/^CORRECTION/.test(head)) {
    kind = 'correction';
    transfer = true;
  } else if (/RETURNED CHEQUE|\bNSF\b|RETURNED ITEM/.test(text)) {
    kind = 'nsf_return';
    transfer = true; // reverses a payment that did not go through
  } else if (/^CHEQUE DELETE/.test(head)) {
    kind = 'cheque_reversal';
    transfer = true;
  } else if (/GOVERNMENT TAX|CCRA|\bCRA\b|REVENUE CANADA|RECEIVER GENERAL|MINISTER OF FINANCE/.test(text)) {
    kind = 'tax';
    purpose = 'tax';
    payee = 'Government tax payment';
  } else if (/EQUIP FINANCE|LEASING|\bLEASE\b/.test(text)) {
    kind = 'equipment_finance';
    purpose = 'financing';
    payee = titleCase(tail || head);
  } else if (/^LOANS?\b|LOAN PAYMENT|LOAN PYMT|MORTGAGE/.test(text)) {
    kind = 'loan';
    purpose = 'financing';
    payee = /RBC/.test(text) ? 'RBC loan' : 'Loan payment';
  } else if (/E-TRANSFER FEE|SERVICE CHARGE|MONTHLY FEE|OVERDRAFT/.test(text)) {
    kind = 'fees';
    purpose = 'fees';
  } else if (/E-TRANSFER/.test(text)) {
    kind = out ? 'etransfer_out' : 'etransfer_in';
  } else if (/^CHEQUE/.test(head)) {
    kind = out ? 'cheque' : 'deposit';
  } else if (/^(ABM )?DEPOSIT|MB-DEP/.test(text) && !out) {
    kind = 'deposit';
  } else if (/ABM WITHDRAWAL|CASH\/COIN|CASH WITHDRAWAL/.test(text)) {
    kind = 'cash';
  } else if (/^POS RETURN/.test(head)) {
    kind = 'refund';
    purpose = purposeOf(tail);
  } else if (/^POS PURCHASE|^FPOS|^POINT OF SALE/.test(head)) {
    kind = 'purchase';
    purpose = purposeOf(tail);
    payee = merchantKey(row.merchant_name || tail);
  } else if (/^MISCELLANEOUS PAYMENT|^BILL PAYMENT|^BUSINESS PAD|^PAD\b|^ACCOUNTS PAYABLE|^PRE-?AUTH/.test(head)) {
    purpose = purposeOf(tail);
    kind = purpose === 'insurance' ? 'insurance' : /^BUSINESS PAD|^PAD\b|^PRE-?AUTH/.test(head) ? 'pad' : 'bill_payment';
    payee = titleCase(tail.replace(/\bMB-|\bPC-|X{2,}\d+/g, '').trim());
  } else if (!out) {
    kind = 'deposit';
  }

  return {
    id: String(row.id),
    date: row.txn_date,
    amount: round2(amount),
    out,
    kind,
    purpose,
    transfer,
    payee,
    text: titleCase(squash(raw)).slice(0, 80),
    pending: row.state ? row.state === 'Pending' : true,
  };
}

function merchantKey(s) {
  return titleCase(
    squash(s)
      .toUpperCase()
      .replace(/^FPOS\s+/, '')
      .replace(/X{2,}\S*/g, '')
      .replace(/#\S+/g, '')
      .replace(/\b(LEAMI\w*|KINGSVILLE|ESSEX|WINDSOR|HARROW|LASAL\w*|WHEATLEY|ON|ONT)\b.*$/, '')
      .trim(),
  ).slice(0, 40);
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Rbc|Cwb|Pad|Mb|Pos|Abm|Nsf|Cra|Hst|Loc|Inc|Mto)\b/g, (m) => m.toUpperCase());
}

export const KIND_LABEL = {
  deposit: 'Deposits',
  etransfer_in: 'E-transfers received',
  etransfer_out: 'E-transfers sent',
  cheque: 'Cheques written',
  cheque_reversal: 'Cheques reversed',
  card_payment: 'Payments to cards and lines of credit',
  transfer: 'Transfers between accounts',
  correction: 'Bank corrections',
  tax: 'Government tax payments',
  equipment_finance: 'Equipment finance and leases',
  loan: 'Loan payments',
  insurance: 'Insurance',
  bill_payment: 'Bill payments',
  pad: 'Pre-authorized debits',
  purchase: 'Card and debit purchases',
  refund: 'Refunds',
  cash: 'Cash withdrawals',
  fees: 'Bank fees',
  interest: 'Interest charges',
  nsf_return: 'Returned (NSF) items',
  other: 'Other',
};

export const PURPOSE_LABEL = {
  fuel: 'Fuel',
  materials: 'Materials and hardware',
  equipment_rental: 'Equipment rental',
  vehicle: 'Vehicles',
  software: 'Software',
  utilities: 'Utilities and waste',
  meals: 'Meals',
  insurance: 'Insurance',
  tax: 'Tax',
  financing: 'Loans and leases',
  fees: 'Fees and interest',
  unknown: 'Not identified',
};

/**
 * Roll classified rows of ONE bank (chequing) account up by month.
 * Operating in/out exclude transfers, corrections and reversals so the totals mean
 * "money that arrived" and "money that left for good".
 * @param {BankRow[]} rows
 * @returns {{months: string[], byMonth: Object<string, MonthFlow>, totals: MonthFlow, firstDate: string|null, lastDate: string|null}}
 */
export function monthlyFlows(rows) {
  const byMonth = {};
  const blank = () => ({ in: 0, out: 0, net: 0, transfersOut: 0, transfersIn: 0, countIn: 0, countOut: 0, byKind: {}, byPurpose: {} });
  const totals = blank();
  let firstDate = null;
  let lastDate = null;
  for (const r of rows) {
    if (!r.date) continue;
    const key = r.date.slice(0, 7);
    const m = byMonth[key] || (byMonth[key] = blank());
    if (!firstDate || r.date < firstDate) firstDate = r.date;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
    for (const t of [m, totals]) {
      if (r.transfer) {
        if (r.out) t.transfersOut += -r.amount;
        else t.transfersIn += r.amount;
      } else if (r.out) {
        t.out += -r.amount;
        t.countOut += 1;
        t.byKind[r.kind] = (t.byKind[r.kind] || 0) + -r.amount;
        t.byPurpose[r.purpose] = (t.byPurpose[r.purpose] || 0) + -r.amount;
      } else {
        t.in += r.amount;
        t.countIn += 1;
      }
    }
  }
  const fix = (t) => {
    t.in = round2(t.in);
    t.out = round2(t.out);
    t.net = round2(t.in - t.out);
    t.transfersOut = round2(t.transfersOut);
    t.transfersIn = round2(t.transfersIn);
    for (const k of Object.keys(t.byKind)) t.byKind[k] = round2(t.byKind[k]);
    for (const k of Object.keys(t.byPurpose)) t.byPurpose[k] = round2(t.byPurpose[k]);
  };
  Object.values(byMonth).forEach(fix);
  fix(totals);
  return { months: Object.keys(byMonth).sort(), byMonth, totals, firstDate, lastDate };
}

/**
 * Find payments that repeat: same payee and (nearly) the same amount in at least three
 * different months. These are the fixed commitments the owner never typed in anywhere.
 * @param {BankRow[]} rows classified rows (any account)
 * @param {Date} now
 * @returns {Recurring[]} sorted by monthly cost, largest first
 */
export function detectRecurring(rows, now) {
  // 1. Group candidate rows by who was paid.
  const byPayee = new Map();
  for (const r of rows) {
    if (!r.out || r.transfer) continue;
    if (!['equipment_finance', 'loan', 'insurance', 'pad', 'bill_payment', 'purchase'].includes(r.kind)) continue;
    // Card and debit purchases only count when they look like a subscription or a utility;
    // fuel and hardware repeat at similar amounts without being a commitment.
    if (r.kind === 'purchase' && !['software', 'utilities', 'insurance'].includes(r.purpose)) continue;
    const amt = Math.abs(r.amount);
    if (amt < 15) continue;
    const who = r.payee || r.text;
    const key = `${r.kind}|${who}`;
    if (!byPayee.has(key)) byPayee.set(key, { kind: r.kind, purpose: r.purpose, payee: who, rows: [] });
    byPayee.get(key).rows.push({ date: r.date, amt });
  }
  // 2. Within a payee, cluster amounts that are within 2% of each other (premiums and lease
  //    payments drift by cents; separate contracts with the same lender stay separate).
  const out = [];
  for (const g of byPayee.values()) {
    const sorted = [...g.rows].sort((x, y) => x.amt - y.amt);
    const clusters = [];
    for (const row of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && row.amt <= last.base * 1.02) last.rows.push(row);
      else clusters.push({ base: row.amt, rows: [row] });
    }
    for (const c of clusters) {
      const months = new Set(c.rows.map((x) => x.date.slice(0, 7)));
      if (months.size < 3) continue;
      const dates = c.rows.map((x) => x.date).sort();
      const last = dates[dates.length - 1];
      // Nothing in the last 75 days means the commitment has probably ended.
      const sinceLast = daysBetween(last, now);
      if (sinceLast !== null && sinceLast > 75) continue;
      const amts = c.rows.map((x) => x.amt).sort((x, y) => x - y);
      const amount = amts[Math.floor(amts.length / 2)];
      // Payments per month over the months it was seen (catches "twice a month" loans).
      const perMonth = c.rows.length / months.size;
      const times = perMonth >= 1.6 ? 2 : 1;
      out.push({
        id: `${g.kind}:${g.payee}:${amount.toFixed(2)}`.replace(/[^A-Za-z0-9:.]+/g, '_'),
        kind: g.kind,
        purpose: g.purpose,
        payee: g.payee,
        amount: round2(amount),
        cadence: times === 2 ? 'twice a month' : 'monthly',
        monthly: round2(amount * times),
        typicalDay: Number(last.slice(8, 10)),
        seen: c.rows.length,
        monthsSeen: months.size,
        lastDate: last,
        nextDate: nextOccurrence(last, times, now),
      });
    }
  }
  return out.sort((x, y) => y.monthly - x.monthly);
}

function nextOccurrence(lastIso, timesPerMonth, now) {
  const last = parseDate(lastIso);
  if (!last) return null;
  const step = (d) => (timesPerMonth === 2 ? addDays(d, 15) : new Date(d.getFullYear(), d.getMonth() + 1, Math.min(last.getDate(), 28)));
  let next = step(last);
  let guard = 0;
  while (next < now && guard < 6) {
    next = step(next);
    guard += 1;
  }
  return isoDate(next);
}

/** Returned / NSF items: each one is a payment that bounced. */
export function nsfEvents(rows) {
  return rows.filter((r) => r.kind === 'nsf_return').map((r) => ({ id: r.id, date: r.date, amount: Math.abs(r.amount), text: r.text }));
}

/** Largest single movements, for the "what moved" list. */
export function largest(rows, n = 10, outOnly = true) {
  return rows
    .filter((r) => !r.transfer && (outOnly ? r.out : !r.out))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, n);
}

/**
 * Average operating money out per week over the last `weeks` full weeks before `now`,
 * split into fixed (recurring kinds) and everything else. Used to seed the 13-week forecast
 * when the owner has not typed in payroll and commitments.
 */
export function weeklyRunRate(rows, now, weeks = 8) {
  const end = addDays(now, -1);
  const start = addDays(end, -weeks * 7 + 1);
  const a = isoDate(start);
  const b = isoDate(end);
  let out = 0;
  let inn = 0;
  let fixed = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.date || r.date < a || r.date > b || r.transfer) continue;
    n += 1;
    if (r.out) {
      out += -r.amount;
      if (['equipment_finance', 'loan', 'insurance'].includes(r.kind)) fixed += -r.amount;
    } else inn += r.amount;
  }
  return { weeks, from: a, to: b, rows: n, outPerWeek: round2(out / weeks), inPerWeek: round2(inn / weeks), fixedPerWeek: round2(fixed / weeks) };
}

/**
 * @typedef {Object} BankRow
 * @property {string} id
 * @property {string} date
 * @property {number} amount signed; negative = money out
 * @property {boolean} out
 * @property {string} kind
 * @property {string} purpose
 * @property {boolean} transfer
 * @property {string} payee
 * @property {string} text
 * @property {boolean} pending
 *
 * @typedef {Object} MonthFlow
 * @property {number} in @property {number} out @property {number} net
 * @property {number} transfersOut @property {number} transfersIn
 * @property {number} countIn @property {number} countOut
 * @property {Object<string, number>} byKind @property {Object<string, number>} byPurpose
 *
 * @typedef {Object} Recurring
 * @property {string} id @property {string} kind @property {string} purpose @property {string} payee
 * @property {number} amount @property {string} cadence @property {number} monthly
 * @property {number} typicalDay @property {number} seen @property {number} monthsSeen
 * @property {string} lastDate @property {string|null} nextDate
 */
