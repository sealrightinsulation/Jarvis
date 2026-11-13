import test from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, syntheticModel, NOW } from './helpers.js';
import { computeAll } from '../../src/domains/index.js';
import { ITEMS, DOMAINS } from '../../src/catalog/catalog.js';
import { FLEET_SIZE } from '../../src/minions/engine.js';
import { cashForecast } from '../../src/calc/forecast.js';

const byId = (r, id) => r.items.find((i) => i.id === id);

test('every checklist item gets an answer in every scope, even with nothing connected', () => {
  const empty = syntheticModel({ fail: { Jobtread: 'needs_reauth', 'Intuit QuickBooks Labs': 'needs_reauth', 'Google Calendar': 'needs_reauth' } });
  for (const scope of ['all', 'ab', 'sr']) {
    for (const model of [undefined, empty]) {
      const out = computeAll(ctxFor(scope, model ? { model } : {}));
      for (const d of DOMAINS) assert.equal(out.results[d.key].error, null, `${d.key} threw in ${scope}: ${out.results[d.key].error}`);
      const seen = new Set(Object.values(out.results).flatMap((r) => r.items.map((i) => i.id)));
      for (const item of ITEMS) assert.ok(seen.has(item.id), `${item.id} missing in ${scope}`);
      for (const r of Object.values(out.results)) {
        for (const i of r.items) {
          assert.ok(['live', 'partial', 'blind'].includes(i.coverage), `${i.id} coverage ${i.coverage}`);
          assert.ok(['good', 'watch', 'alert', 'none'].includes(i.health), `${i.id} health ${i.health}`);
          if (i.coverage === 'blind') assert.ok(i.detail.length > 10, `${i.id} blind without an explanation`);
          assert.ok(!/undefined|NaN|\[object/.test(`${i.display} ${i.detail}`), `${i.id}: "${i.display} | ${i.detail}"`);
        }
      }
    }
  }
});

test('with nothing connected and nothing entered, live figures are blind rather than zero', () => {
  const empty = syntheticModel({ fail: { Jobtread: 'needs_reauth', 'Intuit QuickBooks Labs': 'needs_reauth', 'Google Calendar': 'needs_reauth' } });
  const out = computeAll(ctxFor('all', { model: empty }));
  for (const id of ['fin.revenue', 'fin.receivables', 'fin.cash_reserves', 'csh.today', 'sal.pipeline', 'job.quoted']) {
    const item = Object.values(out.results).flatMap((r) => r.items).find((i) => i.id === id);
    assert.equal(item.coverage, 'blind', id);
    assert.equal(item.display, '', id);
  }
});

test('financial health tells the truth about books without costs', () => {
  const out = computeAll(ctxFor('all'));
  const fin = out.results.fin;
  assert.match(byId(fin, 'fin.revenue').display, /\$1,812,000 this year/);
  const np = byId(fin, 'fin.net_profit');
  assert.equal(np.display, 'Cannot be calculated');
  assert.equal(np.health, 'alert');
  assert.equal(np.coverage, 'partial');
  // cash is the bank feed, never the 4.8M the books claim
  assert.match(byId(fin, 'fin.cash_reserves').display, /\$18,250/);
  assert.equal(byId(fin, 'fin.cash_reserves').coverage, 'partial');
  assert.match(byId(fin, 'fin.receivables').display, /\$45,600/);
  assert.match(byId(fin, 'fin.payables').display, /\$475,000/);
  assert.equal(byId(fin, 'fin.payroll').coverage, 'blind');
  // loans are not on file but the bank feed shows them
  assert.equal(byId(fin, 'fin.loans').coverage, 'partial');
  assert.match(byId(fin, 'fin.loans').display, /\$1,280 a month/);
  assert.ok(fin.minions.some((m) => m.id === 'fin.books:sr' && m.status === 'alert'));
  assert.ok(fin.minions.some((m) => m.id === 'fin.bookcash:sr' && m.status === 'alert'));
  assert.ok(fin.minions.some((m) => m.id === 'fin.nobank:ab' && m.status === 'blind'));
});

test('break-even and safe-to-spend use the owner inputs and say what they assumed', () => {
  const ctx = ctxFor('all', { main: { grossMarginTarget: 0.3, payrollFrequency: 'biweekly', payrollNextDate: '2026-11-20', payrollAb: 20000, payrollSr: 6000, reserveTarget: 10000, cashAb: 60000, cashAbAsOf: '2026-11-13' }, registers: { obligations: [{ id: 'o1', name: 'Shop rent', amount: 3000, frequency: 'monthly', nextDue: '2026-12-01', company: 'both' }] } });
  const out = computeAll(ctx);
  const fin = out.results.fin;
  // payroll 26,000 biweekly = 56,333.33/mo + rent 3,000 = 59,333.33 fixed ; / 0.30 = 197,777.77
  assert.match(byId(fin, 'fin.breakeven').display, /\$197,778 of revenue a month/);
  assert.match(byId(fin, 'fin.payroll').display, /\$56,333 a month/);
  const safe = byId(fin, 'fin.safe_to_spend');
  assert.equal(safe.coverage, 'partial');
  assert.match(safe.detail, /\$78,250 in the bank/);
});

test('thirteen-week forecast places money on the right weeks', () => {
  const ctx = ctxFor('all', { main: { payrollFrequency: 'biweekly', payrollNextDate: '2026-11-20', payrollAb: 20000, payrollSr: 0, cashAb: 100000, cashAbAsOf: '2026-11-13' } });
  const f = cashForecast(ctx);
  assert.equal(f.weeks.length, 13);
  assert.equal(f.weeks[0].from, '2026-11-09');
  assert.equal(f.start, 118250.4);
  // payroll: Nov 20 (wk1), Dec 4 (wk3), Dec 18 (wk5) ...
  assert.ok(f.weeks[1].items.some((i) => i.kind === 'payroll' && i.amount === -20000));
  assert.ok(f.weeks[3].items.some((i) => i.kind === 'payroll'));
  assert.ok(!f.weeks[2].items.some((i) => i.kind === 'payroll'));
  // invoice due Nov 18 (5,000) and Nov 27 (25,000) land on their weeks; overdue ones two weeks out
  assert.ok(f.weeks[1].items.some((i) => i.kind === 'invoice' && i.amount === 5000));
  assert.ok(f.weeks[2].items.some((i) => i.kind === 'invoice' && i.amount === 25000));
  // overdue supplier bills (136,000) are assumed paid next week
  const nextWeekBills = f.weeks[1].items.filter((i) => i.kind === 'bill').reduce((t, i) => t - i.amount, 0);
  assert.equal(nextWeekBills, 136000);
  // repeating payments from the bank feed are included because nothing is listed
  assert.ok(f.inputs.detected > 0);
  assert.ok(f.weeks.some((w) => w.items.some((i) => i.kind === 'detected')));
  assert.ok(f.pace && f.pace.balances.length === 13);
  // balance arithmetic
  let bal = f.start;
  for (const w of f.weeks) {
    bal = Math.round((bal + w.inflow - w.outflow) * 100) / 100;
    assert.equal(w.balance, bal);
  }
  assert.ok(f.low.balance < 0, 'the unpaid bills push the known-items line below zero');
});

test('job costing flags the job budgeted to lose money', () => {
  const out = computeAll(ctxFor('all'));
  const job = out.results.job;
  assert.match(byId(job, 'job.quoted').display, /\$1,021,000 signed on 3 jobs/);
  assert.equal(byId(job, 'job.est_vs_actual').health, 'alert');
  assert.equal(byId(job, 'job.labour').coverage, 'blind');
  const varga = job.minions.find((m) => m.id === 'job.margin:j1');
  assert.equal(varga.status, 'alert');
  assert.match(varga.finding, /\$170,000 more than the price/);
  assert.ok(job.minions.some((m) => m.id === 'job.bills:j1' && m.status === 'alert'));
  // Seal Right scope: honest blind, no throw
  const sr = computeAll(ctxFor('sr')).results.job;
  assert.ok(sr.items.every((i) => i.coverage === 'blind'));
});

test('sales, customers and strategy read both systems', () => {
  const out = computeAll(ctxFor('all', { main: { revenueTargetAb: 2000000, revenueTargetSr: 400000 } }));
  assert.match(byId(out.results.sal, 'sal.pipeline').display, /in 7 open quotes/);
  assert.match(byId(out.results.sal, 'sal.acceptance').display, /55% of decided quotes won/);
  assert.equal(byId(out.results.sal, 'sal.cac').coverage, 'blind');
  const cus = out.results.cus;
  assert.match(byId(cus, 'cus.top_revenue').display, /Ines & Tomas Varga: \$700,000/);
  assert.equal(byId(cus, 'cus.top_revenue').health, 'watch');
  assert.equal(byId(out.results.str, 'str.concentration').health, 'alert');
  assert.match(byId(out.results.str, 'str.revenue_target').display, /Advanced Builds 79% of \$2M/);
  assert.equal(byId(out.results.str, 'str.valuation').coverage, 'blind');
});

test('registers turn blind spots into watched items', () => {
  const registers = {
    people: [{ id: 'p1', name: 'Dana Reyes', role: 'Lead installer', employment: 'employee', hourlyRate: 32, independent: 'yes', supervisorReady: 'ready', company: 'sr', active: true }, { id: 'p2', name: 'Sam Okoro', role: 'Installer', employment: 'employee', hourlyRate: 24, company: 'sr', active: true }],
    scorecards: ['2026-W46', '2026-W45', '2026-W44'].flatMap((week) => [{ id: `${week}a`, week, person: 'p1', hours: 40, daysAbsent: 0, productivity: 5, quality: 4, attitude: 5, safety: 5, revenueProduced: 6000 }, { id: `${week}b`, week, person: 'p2', hours: 36, daysAbsent: 1, productivity: 2, quality: 2, attitude: 3, safety: 2, revenueProduced: 1500 }]),
    equipment: [{ id: 'e1', name: 'Spray rig 1', kind: 'rig', company: 'sr', ownership: 'financed', purchaseDate: '2022-05-01', purchasePrice: 120000, usefulLifeYears: 8, salvageValue: 20000, monthlyPayment: 1500, status: 'available', nextServiceDate: '2026-11-10', insuranceExpiry: '2026-12-01', daysUsedLast30: 18 }],
    policies: [{ id: 'pol1', name: 'CGL policy', kind: 'liability', provider: 'Harbour Mutual', coverage: 5000000, expiry: '2026-12-15', status: 'in_force', company: 'both' }, { id: 'pol2', name: 'WSIB clearance', kind: 'wsib', expiry: '2026-11-01', company: 'both' }],
    roles: [{ id: 'r1', title: 'Owner', holderName: 'Jake', duties: ['payroll', 'purchasing', 'customer_issues'] }, { id: 'r2', title: 'Site supervisor', holder: 'p1', reportsTo: 'r1', duties: ['crews', 'quality', 'scheduling'], spendLimit: 1000, approvesOvertime: true, backup: 'p2', responsibilities: 'Runs the crew.' }],
    weekly: [{ id: '2026-W46', checks: { cash: true, collect: true }, decisions: [{ id: 'd1', text: 'Call the truss supplier', done: false }] }, { id: '2026-W45', closedOn: '2026-11-06', checks: {}, decisions: [] }],
  };
  const out = computeAll(ctxFor('all', { registers, main: { burdenPct: 0.2 } }));
  const ppl = out.results.ppl;
  assert.match(byId(ppl, 'ppl.underperforming').display, /1 person below 3/);
  assert.equal(byId(ppl, 'ppl.underperforming').health, 'alert');
  assert.ok(ppl.minions.some((m) => m.id === 'ppl.safety:p2' && m.status === 'alert'));
  assert.match(byId(ppl, 'ppl.wage_vs_value').detail, /Dana Reyes: \$18,000 produced for \$4,608 of wages/);
  const eqp = out.results.eqp;
  assert.match(byId(eqp, 'eqp.depreciation').display, /\$12,500 a year/);
  assert.equal(byId(eqp, 'eqp.maintenance').health, 'alert');
  assert.ok(eqp.minions.some((m) => m.id === 'eqp.service:e1' && m.status === 'alert'));
  const lgl = out.results.lgl;
  assert.equal(byId(lgl, 'lgl.wsib').health, 'alert');
  assert.equal(byId(lgl, 'lgl.liability').health, 'watch');
  assert.equal(byId(lgl, 'lgl.vehicle_insurance').coverage, 'blind');
  const org = out.results.org;
  assert.match(byId(org, 'org.crews').display, /Dana Reyes \(Site supervisor\)/);
  assert.equal(byId(org, 'org.payroll').health, 'watch');
  assert.match(byId(org, 'org.overtime').display, /Dana Reyes/);
  const wkr = out.results.wkr;
  assert.match(byId(wkr, 'wkr.this_week').display, /2 of 12 steps done/);
  assert.match(byId(wkr, 'wkr.streak').display, /1 of the last 8 weeks/);
  assert.equal(wkr.data.steps.length, 12);
  assert.ok(wkr.data.steps[0].facts.length >= 3);
});

test('the fleet seats real watches only, by priority, within 1,200 seats', () => {
  const out = computeAll(ctxFor('all'));
  const f = out.fleet;
  assert.equal(f.size, FLEET_SIZE);
  assert.ok(f.seatedCount > 200 && f.seatedCount <= FLEET_SIZE, `seated ${f.seatedCount}`);
  assert.equal(f.seatedCount + f.idle, FLEET_SIZE);
  assert.equal(new Set(f.seated.map((m) => m.id)).size, f.seatedCount, 'ids are unique');
  assert.equal(f.totals.alert + f.totals.watch + f.totals.clear + f.totals.blind, f.seatedCount);
  for (const m of f.seated) {
    assert.ok(m.finding && m.finding.length > 5, `${m.id} has no finding`);
    assert.ok(!/undefined|NaN|\[object/.test(`${m.target} ${m.finding}`), `${m.id}: ${m.target} | ${m.finding}`);
    assert.ok(DOMAINS.some((d) => d.key === m.division), `${m.id} division ${m.division}`);
  }
  // alerts are seated first
  assert.equal(f.seated[0].status, 'alert');
  assert.ok(out.coverage.overall.total === ITEMS.length);
  assert.ok(out.coverage.overall.blind > 40, 'with no registers most owner-only items are blind');
});
