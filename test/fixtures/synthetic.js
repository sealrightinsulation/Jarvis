// SYNTHETIC connector payloads. Every name and number here is invented.
//
// The shapes mirror what the real connectors return (report rows with kind/group/values,
// transactions_search items, bank-feed rows with fixed-width bank descriptions, JobTread
// {data, meta} envelopes), so the normalizers, the unit tests and the local preview all
// exercise the same code paths the live page does. Real business data never lives in git.

export const TODAY = '2026-11-13';
const REALM = { sr: '9130348000286976', ab: '9130355329365546' };

// ---------- QuickBooks report builders ----------

const MONTH_LABELS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

function pnlByMonth(revenueByMonth, costs) {
  // 23 columns: Jan 2025 .. Nov 2026 (partial), then Total.
  const keys = [];
  for (let i = 0; i < 23; i += 1) {
    const y = 2025 + Math.floor(i / 12);
    const m = i % 12;
    keys.push(i === 22 ? 'Nov. 1-13, 2026' : `${MONTH_LABELS[m]} ${y}`);
  }
  const columns = [{ key: 'account', title: '', type: 'Account', col_key: 'account' }, ...keys.map((k) => ({ key: k, title: k, type: 'Money', col_key: k })), { key: 'Total', title: 'Total', type: 'Money', col_key: 'total' }];
  const row = (kind, group, label, vals, extra = {}) => {
    const values = {};
    keys.forEach((k, i) => {
      values[k] = vals ? vals[i] : null;
    });
    values.Total = vals ? Math.round(vals.reduce((t, v) => t + v, 0) * 100) / 100 : null;
    return { kind, group, path: [], level: kind === 'Data' ? 1 : 0, label, cells: {}, values, ...extra };
  };
  const rows = [row('Header', 'Income', 'INCOME', null), row('Data', 'Income', 'Sales', revenueByMonth, { id: '7' }), row('Summary', 'Income', 'Total Income', revenueByMonth)];
  const totals = [rows[2]];
  let net = revenueByMonth.slice();
  if (costs) {
    rows.push(row('Header', 'COGS', 'COST OF GOODS SOLD', null), row('Data', 'COGS', 'Supplies and materials - COS', costs.cogs, { id: '15' }), row('Summary', 'COGS', 'Total Cost of Goods Sold', costs.cogs));
    rows.push(row('Header', 'Expenses', 'EXPENSES', null), row('Data', 'Expenses', 'Insurance', costs.expenses, { id: '23' }), row('Summary', 'Expenses', 'Total Expenses', costs.expenses));
    totals.push(rows[5], rows[8]);
    net = net.map((v, i) => Math.round((v - costs.cogs[i] - costs.expenses[i]) * 100) / 100);
  }
  const profit = row('Summary', 'NetIncome', 'PROFIT', net);
  rows.push(profit);
  totals.push(profit);
  return { meta: { report: 'ProfitAndLoss', source: 'api', basis: 'Accrual', period: { start: '2025-01-01', end: TODAY }, currency: 'CAD', summarize_by: 'Month', no_data: false }, columns, rows, totals, summary: 'Profit and Loss (api)' };
}

function balanceSheet(accounts) {
  const columns = [{ key: 'account', title: '', type: 'Account', col_key: 'account' }, { key: 'Total', title: 'Total', type: 'Money', col_key: 'total' }];
  const rows = [];
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    rows.push({ kind: 'Data', group: a.group, path: [], level: 3, label: a.name, id: a.id, cells: {}, values: { Total: a.value } });
    if (['BankAccounts', 'AR', 'OtherCurrentAssets'].includes(a.group)) assets += a.value;
    if (['CreditCards', 'OtherCurrentLiabilities'].includes(a.group)) liabilities += a.value;
  }
  const s = (group, label, v) => ({ kind: 'Summary', group, path: [], level: 0, label, cells: {}, values: { Total: Math.round(v * 100) / 100 } });
  rows.push(s('Liabilities', 'Total Liabilities', liabilities), s('Equity', 'Total Equity', assets - liabilities));
  const totals = [s('TotalAssets', 'Total Assets', assets), s('TotalLiabilitiesAndEquity', 'Total Liabilities and Equity', assets)];
  rows.push(...totals);
  return { meta: { report: 'BalanceSheet', source: 'api', basis: 'Accrual', period: { start: TODAY, end: TODAY }, currency: 'CAD', no_data: false }, columns, rows, totals, summary: 'Balance Sheet (api)' };
}

function customerSales(list, withPy) {
  const cur = withPy ? 'Jan. 1 - Nov. 13, 2026' : 'Total';
  const py = 'Jan. 1 - Nov. 13, 2025 (PY)';
  const columns = [{ key: 'Customer', title: '', type: 'Customer' }, { key: cur, title: cur, type: 'Money', col_key: 'total' }];
  if (withPy) columns.push({ key: py, title: py, type: 'Money', col_key: 'subcol_py', group: 'Total' });
  const rows = list.map(([id, name, a, b]) => ({ kind: 'Data', path: [], level: 0, label: name, id, cells: {}, values: withPy ? { [cur]: a, [py]: b || 0 } : { [cur]: a } }));
  const tot = { kind: 'Summary', group: 'GrandTotal', path: [], level: 0, label: 'TOTAL', cells: {}, values: withPy ? { [cur]: list.reduce((t, r) => t + r[2], 0), [py]: list.reduce((t, r) => t + (r[3] || 0), 0) } : { [cur]: list.reduce((t, r) => t + r[2], 0) } };
  rows.push(tot);
  return { meta: { report: 'CustomerSales', source: 'api', currency: 'CAD', no_data: false }, columns, rows, totals: [tot], summary: 'Sales by Customer Summary (api)' };
}

function taxSummary(sales, collected, itc) {
  const columns = [{ key: 'String', title: '', type: 'String' }, { key: 'Total', title: 'Total', type: 'Money', col_key: 'total' }];
  const r = (kind, group, label, v) => ({ kind, group, path: [], level: 0, label, cells: {}, values: { Total: v } });
  const rows = [r('Data', 'Line 101', 'Line 101 Sales and other revenue', sales), r('Data', 'Line 103', 'Line 103 GST/HST collected or collectible', collected), r('Summary', 'Line 105', 'Line 105 Total GST/HST and adjustments for period', collected), r('Data', 'Line 106', 'Line 106 Input tax credits (ITCs)', itc), r('Summary', 'Line 108', 'Line 108 Total ITCs and adjustments', itc), r('Summary', 'Line 109', 'Line 109 Net tax', Math.round((collected - itc) * 100) / 100), r('Summary', 'Line 113C', 'Line 113C Balance', Math.round((collected - itc) * 100) / 100)];
  return { meta: { report: 'TaxSummary', source: 'api', basis: 'Accrual', currency: 'CAD', no_data: false }, columns, rows, totals: rows.filter((x) => x.kind === 'Summary'), summary: 'Sales Tax Summary (api)' };
}

const inv = (id, num, cust, custId, date, due, total, balance, paid) => ({ id, type: 'Invoice', txn_date: date, doc_number: num, total: total.toFixed(2), balance: balance.toFixed(2), signed_balance: balance.toFixed(2), due_date: due, ...(paid ? { paid_date: paid } : {}), contact: { id: custId, name: cust, type: 'Customer' }, account: { id: '56', name: 'Accounts Receivable (A/R)' }, status: balance > 0 ? (due < TODAY ? 'Overdue' : 'Open') : 'Paid', voided: false });
const est = (id, num, cust, custId, date, total, status) => ({ id, type: 'Estimate', txn_date: date, doc_number: num, total: total.toFixed(2), balance: '0.00', contact: { id: custId, name: cust, type: 'Customer' }, status, voided: false });
const page = (items) => ({ items, next_cursor: null, total_count: items.length, summary: `Found ${items.length}` });

// ---------- the two fictional companies ----------

// Northfield Foam (plays the 'sr' company): revenue only, no costs recorded, a connected bank feed.
const SR_REV = [12000, 6000, 30000, 26000, 31000, 22000, 14000, 4000, 21000, 18000, 60000, 70000, 28000, 24000, 26000, 23000, 7000, 0, 8000, 6000, 23000, 70000, 12000];
// Harbour Post-Frame (plays the 'ab' company): larger, lumpy revenue, no bank feed.
const AB_REV = [0, 40000, 150000, 230000, 90000, 15000, 150000, 120000, 80000, 170000, 150000, 1000, 20000, 35000, 55000, 280000, 190000, 45000, 210000, 480000, 180000, 90000, 0];

const QBO = {
  sr: {
    pnl: pnlByMonth(SR_REV, null),
    bs: balanceSheet([
      { group: 'BankAccounts', name: 'Legacy Current Account', id: '55', value: 1500000 },
      { group: 'BankAccounts', name: 'Business Chequing (1111)', id: '65', value: 3000 },
      { group: 'BankAccounts', name: 'Undeposited Funds', id: '3', value: 250000 },
      { group: 'AR', name: 'Accounts Receivable (A/R)', id: '60', value: 6100 },
      { group: 'CreditCards', name: 'Business VISA (2222)', id: '66', value: 9000 },
      { group: 'OtherCurrentLiabilities', name: 'GST/HST Payable', id: '57', value: 200000 },
    ]),
    custYtd: customerSales([['101', 'Maple Ridge Homes', 90000, 60000], ['102', 'Tern Builders', 60000, 0], ['103', 'Okafor Renovations', 47000, 40000], ['104', 'Private client (Lindqvist)', 30000, 0]], true),
    custPrev: customerSales([['101', 'Maple Ridge Homes', 140000], ['103', 'Okafor Renovations', 90000], ['105', 'Drummond Farms', 84000]], false),
    openInv: page([inv('951', '1328', 'Tern Builders', '102', '2026-10-19', '2026-11-18', 5000, 5000), inv('952', '1329', 'Okafor Renovations', '103', '2026-09-01', '2026-10-01', 3100, 1100)]),
    paidInv: page([inv('900', '1300', 'Maple Ridge Homes', '101', '2026-08-01', '2026-08-31', 20000, 0, '2026-08-20'), inv('901', '1301', 'Maple Ridge Homes', '101', '2026-09-01', '2026-10-01', 15000, 0, '2026-10-21'), inv('902', '1302', 'Okafor Renovations', '103', '2026-06-01', '2026-07-01', 9000, 0, '2026-08-30')]),
    estimates: page([est('960', '1440', 'Tern Builders', '102', '2026-11-06', 64000, 'Pending'), est('961', '1441', 'Calloway Dental', '106', '2026-10-01', 11300, 'Pending'), est('962', '1430', 'Maple Ridge Homes', '101', '2026-08-10', 22600, 'Accepted'), est('963', '1431', 'Okafor Renovations', '103', '2026-07-02', 5650, 'Rejected'), est('964', '1420', 'Drummond Farms', '105', '2026-03-02', 9040, 'Expired'), est('965', '1432', 'Lindqvist', '104', '2026-09-12', 33900, 'Closed')]),
    feeds: { items: [{ account: { id: '65', name: 'Business Chequing (1111)' }, account_type: 'Bank', account_sub_type: 'Checking', institution: { id: '6', name: 'Example Bank' }, connection_type: 'OAuth', book_balance: '3000.00', bank_balance: '18250.40', currency: 'CAD', last_updated: '2026-11-12T03:17:28.000Z', needs_attention: false, pending_count: 0, unmatched_count: 0 }, { account: { id: '66', name: 'Business VISA (2222)' }, account_type: 'Credit Card', account_sub_type: 'CreditCard', institution: { id: '6', name: 'Example Bank' }, connection_type: 'OAuth', book_balance: '9000.00', bank_balance: '7420.10', currency: 'CAD', last_updated: '2026-11-12T03:17:28.000Z', needs_attention: false, pending_count: 0, unmatched_count: 0 }], summary: 'Found 2 bank feed connection(s)' },
    recon: { items: [{ account: { id: '65', name: 'Business Chequing (1111)' }, account_type: 'Bank', in_progress: false, is_reconcilable: true, is_bank_connected: true, last: {}, statement_ending_date: null }, { account: { id: '66', name: 'Business VISA (2222)' }, account_type: 'Credit Card', in_progress: false, is_reconcilable: true, is_bank_connected: true, last: {}, statement_ending_date: null }, { account: { id: '57', name: 'GST/HST Payable' }, account_type: 'Other Current Liability', last: {} }], summary: 'Found 3' },
    taxYtd: taxSummary(227000, 29510, 0),
    taxQtr: taxSummary(82000, 10660, 0),
  },
  ab: {
    pnl: pnlByMonth(AB_REV, null),
    bs: balanceSheet([
      { group: 'BankAccounts', name: 'Checking', id: '61', value: 3300000 },
      { group: 'BankAccounts', name: 'Undeposited Funds', id: '5', value: 2300000 },
      { group: 'AR', name: 'Accounts Receivable (A/R)', id: '56', value: 85000 },
      { group: 'OtherCurrentLiabilities', name: 'GST/HST Payable', id: '54', value: 650000 },
    ]),
    custYtd: customerSales([['58', 'Ines & Tomas Varga', 700000, 80000], ['64', 'Corwin Haldane', 340000, 0], ['68', 'Owner (related party)', 260000, 0], ['43', 'Saltmarsh Holdings', 110000, 165000], ['62', 'Priya Raman', 98000, 115000], ['73', 'Greig Howell', 45000, 0], ['72', 'Alden & Sue', 19000, 0], ['71', 'Brandt Kovac', 13000, 0]], true),
    custPrev: customerSales([['57', 'Battersea & Spence', 650000], ['43', 'Saltmarsh Holdings', 166000], ['62', 'Priya Raman', 155000], ['58', 'Ines & Tomas Varga', 80000], ['54', 'Jacob Geist', 145000]], false),
    openInv: page([inv('262', '1095', 'Priya Raman', '62', '2026-06-24', '2026-06-24', 38000, 8700), inv('289', '1106', 'Brandt Kovac', '71', '2026-10-20', '2026-10-20', 5800, 5800), inv('298', '1111', 'Owner (related party)', '68', '2026-10-28', '2026-11-27', 25000, 25000)]),
    paidInv: page([inv('296', '1110', 'Greig Howell', '73', '2026-10-22', '2026-10-22', 16857.78, 0, '2026-10-22'), inv('280', '1100', 'Ines & Tomas Varga', '58', '2026-07-01', '2026-07-15', 240000, 0, '2026-07-12'), inv('281', '1101', 'Corwin Haldane', '64', '2026-08-03', '2026-08-17', 130000, 0, '2026-09-20')]),
    estimates: page([est('288', '1066', 'Wren Dance Studio', '70', '2026-10-02', 19600, 'Pending'), est('287', '1065', 'PE Example Construction', '69', '2026-10-02', 67500, 'Pending'), est('270', '1060', 'Corwin Haldane', '64', '2026-03-10', 384000, 'Accepted'), est('271', '1061', 'Marsh Custom Homes', '75', '2026-05-11', 113000, 'Rejected')]),
    feeds: { items: [], summary: 'Found 0 bank feed connection(s) with 0 row(s) pending review.' },
    recon: { items: [{ account: { id: '61', name: 'Checking' }, account_type: 'Bank', in_progress: false, is_reconcilable: true, is_bank_connected: false, last: {}, statement_ending_date: null }], summary: 'Found 1' },
    taxYtd: taxSummary(1585000, 206050, 0),
    taxQtr: taxSummary(90000, 11700, 0),
  },
};

// ---------- bank feed rows (the fixed-width description style of a Canadian bank) ----------

function bankRows() {
  const rows = [];
  let id = 400;
  const add = (date, amount, desc, merchant) => rows.push({ id: String((id += 1)), account: { id: '65' }, state: 'Pending', txn_date: date, amount: amount.toFixed(2), description: desc.split(/\s{2,}/)[0], original_description: desc, bank_memo: desc, ...(merchant ? { merchant_name: merchant } : {}), suggestion: { readiness: 'NeedsReview', category_confidence: 'Low', recommended_action: 'Categorize' } });
  for (let m = 1; m <= 11; m += 1) {
    const mm = String(m).padStart(2, '0');
    const last = m === 11;
    add(`2026-${mm}-01`, -1500, 'Business PAD         NORTHWAY EQUIP FINANCE', 'Northway Equip Finance');
    add(`2026-${mm}-01`, -820.5, 'Business PAD         NORTHWAY EQUIP FINANCE', 'Northway Equip Finance');
    add(`2026-${mm}-05`, -640, 'Loan Payment');
    if (!last) add(`2026-${mm}-20`, -640, 'Loan Payment');
    add(`2026-${mm}-08`, -1210.25, 'Miscellaneous Payment   HARBOUR MUTUAL INSURANCE');
    add(`2026-${mm}-03`, 40000 + m * 1000, 'Deposit');
    if (!last) add(`2026-${mm}-18`, 22000, 'Credit Memo          FREE INTERAC E-TRANSFER');
    add(`2026-${mm}-07`, -9000 - m * 100, 'Cheque');
    add(`2026-${mm}-09`, -6000, 'Debit Memo           FREE INTERAC E-TRANSFER');
    add(`2026-${mm}-10`, -5000, 'Customer Transfer Dr.   MB-CREDIT CARD/LOC PAY.');
    if (!last) add(`2026-${mm}-12`, -2500, 'Customer Transfer Dr.   MB-TRANSFER');
    add(`2026-${mm}-06`, -210.4, 'POS Purchase         LAKESIDE GAS BAR         TOWN', 'Lakeside Gas Bar');
    if (!last) add(`2026-${mm}-14`, -480.1, 'POS Purchase         RONA EXAMPLETOWN   XXXX3150   TOWN', 'Rona');
    if (!last) add(`2026-${mm}-15`, -3200, 'Business PAD         GOVERNMENT TAX PAYMENTS');
    add(`2026-${mm}-02`, -39.5, 'Service Charge');
  }
  add('2026-08-03', 50000, 'Deposit');
  add('2026-08-03', 50000, 'Deposit');
  add('2026-08-03', -50000, 'Correction');
  add('2026-09-02', 820.5, 'Returned Cheque - NSF');
  add('2026-10-02', 1500, 'Returned Cheque - NSF');
  return rows;
}

function cardRows() {
  const rows = [];
  let id = 2000;
  const add = (date, amount, desc, merchant) => rows.push({ id: String((id += 1)), account: { id: '66' }, state: 'Pending', txn_date: date, amount: amount.toFixed(2), description: desc.slice(0, 12), original_description: desc, bank_memo: desc, ...(merchant ? { merchant_name: merchant } : {}), suggestion: { readiness: 'NeedsReview', category_confidence: 'Low', recommended_action: 'Categorize' } });
  for (let m = 1; m <= 10; m += 1) {
    const mm = String(m).padStart(2, '0');
    add(`2026-${mm}-11`, -31.64, 'INTUIT X*QBooks Online    888-829-8589 ON', 'Intuit QuickBooks Online');
    add(`2026-${mm}-13`, 5000, 'PAYMENT FROM - *****XX*1111');
    add(`2026-${mm}-16`, -390, 'TOWNLINE EQUIPMENT RENTL TOWN ON');
    add(`2026-${mm}-19`, -88.2, 'ESSO CIRCLE K TOWN ON');
    add(`2026-${mm}-27`, -92.1, 'INTEREST CHARGES-PURCHASE');
  }
  return rows;
}

// ---------- JobTread ----------

const acct = (id, name) => ({ id, name });
const JOBS = [
  { id: 'jEX', name: 'Job 1', number: '1', location: { id: 'l0', name: 'JobTread', city: 'Dallas', state: 'TX', account: acct('aEX', 'Example Customer') } },
  { id: 'j1', name: 'Varga Residence', number: '1039', location: { id: 'l1', name: 'Varga Lot', city: 'Essex', state: 'ON', account: acct('a1', 'Ines & Tomas Varga') } },
  { id: 'j2', name: 'Howell Basement', number: '1051', location: { id: 'l2', name: '12 Shore Rd', city: 'Lakeshore', state: 'ON', account: acct('a2', 'Greg Howell') } },
  { id: 'j3', name: 'Alden 20x20 Sunroom', number: '1062', location: { id: 'l3', name: '5 Smith Rd', city: 'Essex', state: 'ON', account: acct('a3', 'Alden') } },
  { id: 'j4', name: 'Josh 45x30 Pole Barn', number: '1074', location: { id: 'l4', name: '22 County Rd', city: 'Lakeshore', state: 'ON', account: acct('a4', 'Josh - Woodslee') } },
  { id: 'j5', name: 'Sawyer Barndominium', number: '1068', location: { id: 'l5', name: 'Deer Run', city: 'Exampleton', state: 'ON', account: acct('a5', 'Nick Sawyer') } },
  { id: 'j6', name: 'Sawyer - Steel Option', number: '1077', location: { id: 'l5', name: 'Deer Run', city: 'Exampleton', state: 'ON', account: acct('a5', 'Nick Sawyer') } },
  { id: 'j7', name: 'Dobson Barn Re-Clad', number: '1067', location: { id: 'l7', name: 'County Rd 34', city: null, state: 'ON', account: acct('a7', 'Dan Dobson') } },
  { id: 'j8', name: '1902 Middle Rd - New Build', number: '1057', location: { id: 'l8', name: '1902 Middle Rd', city: 'Lakeshore', state: 'ON', account: acct('a8', 'Owner build') } },
];

const boardRow = (id, name, number, pc, pp, ac, ts, overdue = 0) => ({ id, name, number, closedOn: null, projectedCost: pc, projectedPrice: pp, actualCost: ac, taskSummary: { progress: null, completed: 0, started: 0, unstarted: 0, startDate: null, endDate: null, ...ts }, approvedCustomerInvoices: { nextPage: null, sum: null, sumPrice: null, sumBalance: null, count: 0 }, overdueTasks: { nextPage: null, count: overdue } });
const BOARD = [
  boardRow('jEX', 'Job 1', '1', null, null, null, { unstarted: 76, startDate: '2026-04-11', endDate: '2026-10-22' }, 76),
  boardRow('j1', 'Varga Residence', '1039', 1000000, 830000, 620000, { progress: 0.94, completed: 70, started: 1, unstarted: 4, startDate: '2026-06-10', endDate: '2026-11-20' }, 4),
  boardRow('j2', 'Howell Basement', '1051', 43000, 59000, 6500, { progress: 1, completed: 1 }),
  boardRow('j3', 'Alden 20x20 Sunroom', '1062', 96000, 132000, null, {}),
  boardRow('j4', 'Josh 45x30 Pole Barn', '1074', null, null, null, {}),
  boardRow('j5', 'Sawyer Barndominium', '1068', null, null, null, {}),
  boardRow('j6', 'Sawyer - Steel Option', '1077', null, null, null, {}),
  boardRow('j7', 'Dobson Barn Re-Clad', '1067', null, null, null, {}),
  boardRow('j8', '1902 Middle Rd - New Build', '1057', null, null, null, { progress: 0, started: 31, startDate: '2026-09-08', endDate: '2027-03-19' }, 8),
];

let docSeq = 0;
const doc = (type, status, job, account, price, cost, opts = {}) => {
  docSeq += 1;
  const withTax = Math.round(price * 1.13 * 100) / 100;
  const j = JOBS.find((x) => x.id === job);
  return {
    id: `d${docSeq}`,
    name: opts.name || (type === 'customerOrder' ? 'Proposal' : type === 'customerInvoice' ? 'Progress Invoice' : 'Bill'),
    createdAt: `${opts.issue || '2026-09-01'}T12:00:00.000Z`,
    description: opts.description || '',
    number: docSeq,
    type,
    subject: opts.subject || null,
    status,
    externalId: null,
    price,
    priceWithTax: type.startsWith('vendor') ? 0 : withTax,
    cost,
    tax: type.startsWith('vendor') ? 0 : Math.round(price * 0.13 * 100) / 100,
    balance: opts.balance ?? 0,
    amountPaid: opts.paid ?? 0,
    taxRate: 0.13,
    issueDate: opts.issue || '2026-09-01',
    closedAt: null,
    dueDate: opts.due || null,
    account: acct(account[0], account[1]),
    job: j ? { id: j.id, name: j.name, number: j.number } : null,
    referencedDocuments: { nodes: (opts.refs || []).map((id) => ({ id })) },
  };
};

const C = { a1: ['a1', 'Ines & Tomas Varga'], a2: ['a2', 'Greg Howell'], a3: ['a3', 'Alden'], a4: ['a4', 'Josh - Woodslee'], a5: ['a5', 'Nick Sawyer'], a7: ['a7', 'Dan Dobson'], ex: ['aEX', 'Example Customer'] };
const V = { v1: ['v1', 'Kestrel Framing'], v2: ['v2', 'Brightline Electric'], v3: ['v3', 'Township Permits'], v4: ['v4', 'Cedar Truss Co'] };

const ORDERS = [
  doc('customerOrder', 'approved', 'j1', C.a1, 700000, 880000, { issue: '2026-02-01' }),
  doc('customerOrder', 'approved', 'j1', C.a1, 90000, 80000, { issue: '2026-06-01', name: 'Change Order' }),
  doc('customerOrder', 'approved', 'j1', C.a1, 40000, 40000, { issue: '2026-08-01', name: 'Change Order' }),
  doc('customerOrder', 'approved', 'j2', C.a2, 59000, 43000, { issue: '2026-07-20' }),
  doc('customerOrder', 'denied', 'j2', C.a2, 72000, 52000, { issue: '2026-07-02' }),
  doc('customerOrder', 'pending', 'j2', C.a2, 7000, 5000, { issue: '2026-09-25', name: 'Change Order' }),
  doc('customerOrder', 'approved', 'j3', C.a3, 132000, 96000, { issue: '2026-10-15' }),
  doc('customerOrder', 'pending', 'j4', C.a4, 90000, 72000, { issue: '2026-10-27', due: '2026-11-26' }),
  doc('customerOrder', 'pending', 'j5', C.a5, 610000, 500000, { issue: '2026-10-01' }),
  doc('customerOrder', 'denied', 'j6', C.a5, 505000, 440000, { issue: '2026-11-10' }),
  doc('customerOrder', 'draft', 'j7', C.a7, 48000, 39000, { issue: '2026-11-05' }),
  doc('customerOrder', 'pending', 'jEX', C.ex, 14000, 9000, { issue: '2026-04-11' }),
];
const INVOICES = [
  doc('customerInvoice', 'approved', 'j1', C.a1, 540000, 0, { issue: '2026-07-01', paid: 610200 }),
  doc('customerInvoice', 'approved', 'j2', C.a2, 29800, 0, { issue: '2026-08-01', paid: 33674 }),
  doc('customerInvoice', 'pending', 'j2', C.a2, 14900, 10800, { issue: '2026-09-14', due: '2026-10-14', balance: 16837 }),
  doc('customerInvoice', 'draft', 'j2', C.a2, 14900, 0, { issue: '2026-10-01' }),
  doc('customerInvoice', 'approved', 'j3', C.a3, 19800, 0, { issue: '2026-11-01', paid: 22374 }),
];
const BILLS = [
  doc('vendorBill', 'approved', 'j1', V.v1, 0, 190000, { issue: '2026-05-01', paid: 214700 }),
  doc('vendorBill', 'pending', 'j1', V.v1, 0, 46000, { issue: '2026-08-15', due: '2026-09-14', balance: 52000 }),
  doc('vendorBill', 'pending', 'j1', V.v2, 0, 39000, { issue: '2026-09-20', due: '2026-10-20', balance: 44000 }),
  doc('vendorBill', 'pending', 'j1', V.v3, 0, 40000, { issue: '2026-06-18', due: '2026-07-18', balance: 40000 }),
  doc('vendorBill', 'pending', 'j1', V.v4, 0, 300000, { issue: '2026-11-01', due: '2026-12-01', balance: 339000 }),
  doc('vendorBill', 'approved', 'j2', V.v2, 0, 5800, { issue: '2026-09-01', paid: 6554 }),
];

const task = (id, name, job, start, end, progress, extra = {}) => {
  const j = JOBS.find((x) => x.id === job);
  return { id, name, description: null, progress, isGroup: false, isToDo: false, completed: progress >= 1 ? 1 : 0, started: progress > 0 && progress < 1 ? 1 : 0, unstarted: progress === 0 ? 1 : 0, startDate: start, startTime: null, endDate: end, endTime: null, baselineStartDate: null, baselineEndDate: null, position: 'a', job: j ? { id: j.id, name: j.name, number: j.number } : null, location: null, account: j ? { ...j.location.account, type: 'customer' } : null, taskType: null, parentTask: null, assignedMemberships: { nextPage: null, nodes: [] }, ...extra };
};
const TASKS = [
  task('t1', 'Closeout & Exterior Completion', 'j1', '2026-10-21', '2026-11-20', 0.66, { isGroup: true }),
  task('t2', 'Exterior trim', 'j1', '2026-10-21', '2026-11-05', 0.5),
  task('t3', 'Final grade', 'j1', '2026-10-28', '2026-11-08', 0),
  task('t4', 'Site clean up', 'j1', '2026-11-16', '2026-11-18', 0),
  task('t5', 'Foundation', 'j8', '2026-09-08', '2026-10-01', 0.3),
  task('t6', 'Framing', 'j8', '2026-11-16', '2026-12-20', 0),
  task('t7', 'Occupancy', 'j8', '2027-03-18', '2027-03-19', 0),
  task('tEX', 'Example task', 'jEX', '2026-04-11', '2026-04-12', 0),
];

const JT = {
  jobs: { data: { jobs: JOBS }, meta: { tool: 'jobtread_jobs' } },
  board: { data: { jobs: BOARD }, meta: { tool: 'jobtread_multi_job_comparison' } },
  docs: {
    customerOrder: { data: { documents: ORDERS }, meta: { tool: 'jobtread_documents' } },
    customerInvoice: { data: { documents: INVOICES }, meta: { tool: 'jobtread_documents' } },
    vendorBill: { data: { documents: BILLS }, meta: { tool: 'jobtread_documents' } },
    vendorOrder: { data: { documents: [] }, meta: { tool: 'jobtread_documents' } },
  },
  docCounts: { data: { groupBy: 'type', groups: [{ type: 'customerOrder', count: ORDERS.length }, { type: 'customerInvoice', count: INVOICES.length }, { type: 'vendorBill', count: BILLS.length }] }, meta: { tool: 'jobtread_documents' } },
  payments: { data: { rawData: { _type: 'root', organization: { id: 'org', payments: { nodes: [{ id: 'p1', amount: 610200, type: 'credit', paidAt: '2026-07-12T12:00:00.000Z', account: acct('a1', 'Ines & Tomas Varga') }, { id: 'p2', amount: 214700, type: 'debit', paidAt: '2026-06-01T12:00:00.000Z', account: acct('v1', 'Kestrel Framing') }, { id: 'p3', amount: 22374, type: 'credit', paidAt: '2026-11-04T12:00:00.000Z', account: acct('a3', 'Alden') }], _pagination: { complete: true, pages: 1 } } } } }, meta: { tool: 'jobtread_payments' } },
  tasks: { data: { tasks: TASKS }, meta: { tool: 'jobtread_tasks' } },
  logs: { data: { dailyLogs: [{ createdAt: '2026-11-03T20:05:51.953Z', date: '2026-11-03', id: 'log1', notes: 'Trim crew on site. Two windows back-ordered.', job: { id: 'j1', name: 'Varga Residence', number: '1039' }, user: { id: 'u1', name: 'Owner' } }] }, meta: { tool: 'jobtread_daily_logs' } },
  time: { data: { groupBy: 'user', groups: [{ label: 'Owner', entryCount: 2, totalMinutes: 91, totalCost: 60.67 }], totals: { entryCount: 2, totalMinutes: 91, totalCost: 60.67 } }, meta: { tool: 'jobtread_time_report' } },
  users: { data: { memberships: [{ id: 'm1', user: { id: 'u1', name: 'Owner', emailAddress: 'owner@example.com' }, role: { id: 'r1', name: 'Admin', type: 'internal' } }] }, meta: { tool: 'jobtread_get_users' } },
};

const CAL = { events: [{ id: 'e1', summary: 'Site walk - Varga Residence', start: { dateTime: '2026-11-16T09:00:00-05:00' }, end: { dateTime: '2026-11-16T10:00:00-05:00' }, location: 'Varga Lot', attendees: [{}, {}] }, { id: 'e2', summary: 'Quote review - Sawyer', start: { dateTime: '2026-11-17T14:00:00-05:00' }, end: { dateTime: '2026-11-17T15:00:00-05:00' } }] };

/**
 * Answer a connector call the way the real connectors do. Returns the payload, or throws
 * {code} for the failure modes worth simulating.
 */
export function respond(server, tool, input = {}, opts = {}) {
  if (opts.fail && opts.fail[server]) throw { code: opts.fail[server], message: 'simulated failure', server };
  if (server === 'Intuit QuickBooks Labs') {
    const co = input.realm_id === REALM.ab ? 'ab' : 'sr';
    const q = QBO[co];
    if (tool === 'reports_profit_and_loss') return q.pnl;
    if (tool === 'reports_balance_sheet') return q.bs;
    if (tool === 'reports_run' && input.report === 'CustomerSales') return input.compare ? q.custYtd : q.custPrev;
    if (tool === 'reports_run' && input.report === 'TaxSummary') return input.period && input.period.start && input.period.start.endsWith('-01-01') ? q.taxYtd : q.taxQtr;
    if (tool === 'transactions_search') {
      const t = (input.types || [])[0];
      if (t === 'Estimate') return q.estimates;
      if (input.status === 'open') return q.openInv;
      return q.paidInv;
    }
    if (tool === 'bank_feed_list_connections') return q.feeds;
    if (tool === 'reconciliation_list_accounts') return q.recon;
    if (tool === 'bank_feed_list_transactions') {
      if (co !== 'sr') throw { code: 'tool_error', message: 'not_found: no bank feed' };
      if (input.state !== 'Pending') return { items: [], next_cursor: null, total_count: 0, summary: 'Found 0' };
      const all = input.account_id === '66' ? cardRows() : bankRows();
      // Two pages, to exercise the cursor.
      const half = Math.ceil(all.length / 2);
      if (!input.cursor) return { items: all.slice(0, half), next_cursor: 'page2', summary: 'more available' };
      return { items: all.slice(half), next_cursor: null, total_count: all.length, summary: 'done' };
    }
  }
  if (server === 'Jobtread') {
    if (tool === 'jobtread_jobs') return JT.jobs;
    if (tool === 'jobtread_multi_job_comparison') return JT.board;
    if (tool === 'jobtread_documents') return input.summaryOnly ? JT.docCounts : JT.docs[input.documentType] || { data: { documents: [] } };
    if (tool === 'jobtread_payments') return JT.payments;
    if (tool === 'jobtread_tasks') return JT.tasks;
    if (tool === 'jobtread_daily_logs') return JT.logs;
    if (tool === 'jobtread_time_report') return JT.time;
    if (tool === 'jobtread_get_users') return JT.users;
  }
  if (server === 'Google Calendar' && tool === 'list_events') return CAL;
  throw { code: 'not_in_manifest', message: `no synthetic answer for ${server}/${tool}` };
}

export const SYNTH = { QBO, JT, CAL, bankRows, cardRows, REALM };
