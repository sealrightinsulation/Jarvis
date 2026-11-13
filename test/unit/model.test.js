import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticModel, loadSynthetic, NOW } from './helpers.js';
import { TOOLS, SERVERS } from '../../src/platform/manifest.js';
import { baseSpecs, expandSpecs, assertReadOnly } from '../../src/sources/specs.js';
import { classifyBankRow, monthlyFlows, detectRecurring } from '../../src/model/bank.js';
import { receivables, payables, cashPosition, openQuotes, quoteOutcomes, revenueSeries, backlog, customerRollup, sameParty, occurrences, perMonth } from '../../src/model/derive.js';

const m = syntheticModel();

test('every source spec uses a tool declared in the manifest, and only read actions', () => {
  const done = loadSynthetic();
  const specs = [...baseSpecs(NOW), ...expandSpecs(done, NOW)];
  assert.ok(specs.length > 30);
  for (const s of specs) {
    assert.ok(SERVERS[s.connector], `unknown connector ${s.connector}`);
    assert.ok(TOOLS[s.connector].includes(s.tool), `${s.tool} not in manifest`);
    assertReadOnly(s);
  }
  assert.throws(() => assertReadOnly({ tool: 'jobtread_documents', input: { action: 'delete' } }));
  assert.throws(() => assertReadOnly({ tool: 'jobtread_jobs', input: { action: 'create' } }));
});

test('profit and loss by month maps columns to months by position', () => {
  const sr = m.companies.sr;
  assert.equal(sr.months.length, 23);
  assert.equal(sr.months[0], '2025-01');
  assert.equal(sr.months[22], '2026-11');
  assert.equal(sr.revenue['2026-10'], 70000);
  assert.equal(sr.revenue['2026-11'], 12000);
  assert.equal(sr.revenueYtd, 227000);
  assert.equal(sr.revenuePrevFull, 314000);
  // trailing 12 full months = Nov 2025 .. Oct 2026
  assert.equal(sr.revenueTtm, 60000 + 70000 + 215000);
  assert.equal(sr.hasCosts, false);
  assert.equal(m.companies.ab.revenueYtd, 1585000);
});

test('balance sheet separates undeposited funds from bank accounts', () => {
  const bs = m.companies.sr.bs;
  assert.equal(bs.undeposited, 250000);
  assert.equal(bs.bookCash, 1503000);
  assert.equal(bs.hstPayable, 200000);
  assert.equal(bs.cards[0].value, 9000);
  assert.equal(bs.ar, 6100);
});

test('open invoices carry days overdue computed from today', () => {
  const r = receivables(m, 'all');
  assert.equal(r.total, 5000 + 1100 + 8700 + 5800 + 25000);
  assert.equal(r.overdueTotal, 1100 + 8700 + 5800);
  const worst = r.invoices[0];
  assert.equal(worst.number, '1095');
  assert.equal(worst.daysOverdue, 142);
  assert.equal(r.buckets.current, 30000);
  assert.equal(r.buckets.d90, 8700);
  assert.equal(receivables(m, 'sr').total, 6100);
});

test('bank rows: transfers and reversals are kept out of operating money in and out', () => {
  const bank = m.banks.sr;
  assert.ok(bank && bank.rowsLoaded);
  assert.equal(m.banks.ab, null);
  assert.equal(bank.cashBalance, 18250.4);
  assert.equal(bank.cardOwing, 7420.1);
  const oct = bank.flows.byMonth['2026-10'];
  // in: deposit 50,000 + e-transfer 22,000 ; NSF return is a reversal, not income
  assert.equal(oct.in, 72000);
  assert.equal(oct.transfersIn, 1500);
  // out excludes card payment 5,000 and own-account transfer 2,500
  assert.equal(oct.transfersOut, 7500);
  assert.equal(oct.out, 1500 + 820.5 + 640 + 640 + 1210.25 + 10000 + 6000 + 210.4 + 480.1 + 3200 + 39.5);
  // the duplicated deposit and its correction net out of August
  const aug = bank.flows.byMonth['2026-08'];
  assert.equal(aug.transfersOut, 7500 + 50000);
  assert.equal(bank.nsf.length, 2);
});

test('bank description classifier', () => {
  const k = (d, amt, type) => classifyBankRow({ id: 1, txn_date: '2026-01-01', amount: amt, original_description: d }, type || 'bank');
  assert.equal(k('Customer Transfer Dr.   MB-CREDIT CARD/LOC PAY.', -500).kind, 'card_payment');
  assert.equal(k('Customer Transfer Dr.   MB-CREDIT CARD/LOC PAY.', -500).transfer, true);
  assert.equal(k('Debit Memo           FREE INTERAC E-TRANSFER', -1000).kind, 'etransfer_out');
  assert.equal(k('Debit Memo           FREE INTERAC E-TRANSFER', -1000).transfer, false);
  assert.equal(k('Credit Memo          FREE INTERAC E-TRANSFER', 900).kind, 'etransfer_in');
  assert.equal(k('Service Charge       INTERAC E-TRANSFER FEE', -1).kind, 'fees');
  assert.equal(k('Returned Cheque - NSF', 410.5).kind, 'nsf_return');
  assert.equal(k('Business PAD         GOVERNMENT TAX PAYMENTS', -3200).kind, 'tax');
  assert.equal(k('PAD CCRA             CANADA', -2000).kind, 'tax');
  assert.equal(k('Business PAD         NORTHWAY EQUIP FINANCE', -1500).kind, 'equipment_finance');
  assert.equal(k('Loans                EXAMPLE BANK LOAN PYMT', -640).kind, 'loan');
  assert.equal(k('Miscellaneous Payment   HARBOUR MUTUAL INSURANCE', -1210.25).kind, 'insurance');
  assert.equal(k('POS Purchase         LAKESIDE GAS BAR         Town', -210.4).purpose, 'fuel');
  assert.equal(k('Bill Payment         MB-EXAMPLE MASTERCARD XXXX0000', -2000).kind, 'card_payment');
  assert.equal(k('Cheque', -5000).kind, 'cheque');
  assert.equal(k('Cheque Delete', 5000).kind, 'cheque_reversal');
  assert.equal(k('Deposit', 50000).kind, 'deposit');
  assert.equal(k('ABM Withdrawal', -400).kind, 'cash');
  assert.equal(k('PAYMENT FROM - *****XX*1111', 300, 'card').transfer, true);
  assert.equal(k('INTEREST CHARGES-PURCHASE', -92.1, 'card').kind, 'interest');
  assert.equal(k('TOWNLINE EQUIPMENT RENTL TOWN ON', -390, 'card').purpose, 'equipment_rental');
});

test('recurring payments are detected with their cadence', () => {
  const rec = m.banks.sr.recurring;
  const by = (amt) => rec.find((r) => r.amount === amt);
  assert.equal(by(1500).cadence, 'monthly');
  assert.equal(by(820.5).monthly, 820.5);
  assert.equal(by(640).cadence, 'twice a month');
  assert.equal(by(640).monthly, 1280);
  assert.equal(by(1210.25).kind, 'insurance');
  assert.ok(by(31.64), 'software subscription on the card');
  assert.ok(!rec.some((r) => r.purpose === 'fuel'), 'fuel is not a commitment');
  assert.ok(!rec.some((r) => r.kind === 'tax'));
});

test('JobTread: example records are dropped and jobs carry their documents', () => {
  const jt = m.jt;
  assert.equal(jt.exampleJobsHidden, 1);
  assert.ok(!jt.jobs.some((j) => j.customer === 'Example Customer'));
  assert.ok(!jt.docs.some((d) => d.account === 'Example Customer'));
  assert.ok(!jt.tasks.some((t) => t.id === 'tEX'));
  const varga = jt.jobs.find((j) => j.id === 'j1');
  assert.equal(varga.stage, 'active');
  assert.equal(varga.contract, 830000);
  assert.equal(varga.originalContract, 700000);
  assert.equal(varga.changeOrders, 130000);
  assert.equal(varga.changeOrderCount, 2);
  assert.equal(varga.projectedCost, 1000000);
  assert.equal(varga.billsUnpaid, 52000 + 44000 + 40000 + 339000);
  assert.equal(varga.billsOverdue, 52000 + 44000 + 40000);
  assert.equal(varga.invoiced, 540000);
  assert.equal(jt.jobs.find((j) => j.id === 'j4').stage, 'quoted');
  assert.equal(jt.jobs.find((j) => j.id === 'j6').stage, 'lost');
  assert.equal(jt.jobs.find((j) => j.id === 'j7').stage, 'estimating');
  assert.equal(jt.jobs.find((j) => j.id === 'j8').stage, 'lead');
  assert.equal(jt.time.hours, 1.52);
  assert.deepEqual(jt.docsShort, []);
});

test('payables come from JobTread bills', () => {
  const p = payables(m, 'all');
  assert.equal(p.total, 475000);
  assert.equal(p.overdueTotal, 136000);
  assert.equal(p.byVendor[0].name, 'Cedar Truss Co');
  assert.equal(payables(m, 'sr').loaded, false);
});

test('cash uses the bank feed, never the book balance, and honours a newer typed figure', () => {
  const none = cashPosition(m, { main: {} }, 'all');
  assert.equal(none.amount, 18250.4);
  assert.equal(none.complete, false);
  assert.equal(none.parts.find((p) => p.company === 'ab').amount, null);
  const typed = cashPosition(m, { main: { cashAb: 90000, cashAbAsOf: '2026-11-12' } }, 'all');
  assert.equal(typed.amount, 108250.4);
  assert.equal(typed.complete, true);
  const override = cashPosition(m, { main: { cashSr: 20000, cashSrAsOf: '2026-11-13' } }, 'sr');
  assert.equal(override.amount, 20000);
  const stale = cashPosition(m, { main: { cashSr: 20000, cashSrAsOf: '2026-10-01' } }, 'sr');
  assert.equal(stale.amount, 18250.4);
});

test('open quotes merge both systems; outcomes give an acceptance rate', () => {
  const q = openQuotes(m, 'all');
  // JobTread: j2 change order 7,000, j4 90,000, j5 610,000 ; QuickBooks: sr 2 pending, ab 2 pending
  assert.equal(q.length, 7);
  assert.equal(q[0].value, 610000);
  const o = quoteOutcomes(m, 'all');
  // JobTread (non change orders, this year): approved j1 base, j2, j3 = 3 ; denied 2 ; QBO: accepted 3 (incl. Closed), rejected 2, expired 1
  assert.equal(o.won, 6);
  assert.equal(o.lost, 4);
  assert.equal(o.expired, 1);
  assert.equal(Math.round(o.rate * 100), 55);
});

test('backlog, revenue series and customer rollup', () => {
  const b = backlog(m, 'all');
  assert.equal(b.total, 830000 - 540000 + (59000 - 44700) + (132000 - 19800));
  const rev = revenueSeries(m, 'all');
  assert.equal(rev.ytd, 227000 + 1585000);
  assert.equal(rev.hasCosts, false);
  assert.equal(rev.total['2026-10'], 160000);
  const cust = customerRollup(m, 'all');
  const maple = cust.find((c) => c.name === 'Maple Ridge Homes');
  assert.equal(maple.ytd, 90000);
  assert.equal(maple.repeat, true);
  assert.equal(maple.paidCount, 2);
  assert.equal(maple.paidLate, 1);
  const howell = cust.find((c) => c.company === 'ab' && sameParty(c.name, 'Greig Howell'));
  assert.ok(howell.jobs >= 1, 'JobTread "Greg Howell" matched to QuickBooks "Greig Howell"');
});

test('name matching and schedules', () => {
  assert.ok(sameParty('Dana Reyes', 'Dana Reyez'));
  assert.ok(sameParty('Alden', 'Alden & Sue'));
  assert.ok(!sameParty('Karen', 'Kyle Nolan'));
  assert.deepEqual(occurrences('2026-11-06', 'biweekly', new Date(2026, 10, 13), new Date(2026, 11, 20)), ['2026-11-20', '2026-12-04', '2026-12-18']);
  assert.equal(perMonth(1000, 'biweekly'), 2166.67);
});

test('an outage leaves sections empty instead of throwing', () => {
  const down = syntheticModel({ fail: { Jobtread: 'server_not_connected' } });
  assert.equal(down.jt, null);
  assert.ok(down.missing.some((x) => x.connector === 'jt'));
  assert.equal(payables(down, 'all').loaded, false);
  const allDown = syntheticModel({ fail: { Jobtread: 'needs_reauth', 'Intuit QuickBooks Labs': 'needs_reauth', 'Google Calendar': 'needs_reauth' } });
  assert.equal(allDown.anyLive, false);
  assert.equal(receivables(allDown, 'all').loaded, false);
  assert.equal(revenueSeries(allDown, 'all').loaded, false);
});
