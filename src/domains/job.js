// A-02 Job profitability: is every project making or losing money against what was quoted?
// Source: JobTread (Advanced Builds). Seal Right jobs are not costed anywhere.

import { live, partial, blind, fixSheet, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, pct, plural, round2, toNum, shortDate } from '../app/format.js';
import { jtIn } from '../model/derive.js';

/** Everything the sheet and the minions need about one job. */
export function jobView(j, marginTarget) {
  const hasBudget = j.projectedCost !== null && j.projectedPrice !== null && j.projectedPrice > 0;
  const projectedMargin = hasBudget ? round2(j.projectedPrice - j.projectedCost) : null;
  const projectedMarginPct = hasBudget ? projectedMargin / j.projectedPrice : null;
  // Cost recorded so far: JobTread's own actual cost, falling back to the bills on file.
  const actual = j.actualCost !== null ? j.actualCost : j.billsCost > 0 ? j.billsCost : null;
  const costProgress = hasBudget && j.projectedCost > 0 && actual !== null ? Math.min(1, actual / j.projectedCost) : null;
  const remainingCost = j.projectedCost !== null ? round2(Math.max(0, j.projectedCost - (actual || 0))) : null;
  const billedProgress = j.contract > 0 ? Math.min(1, j.invoiced / j.contract) : null;
  // Billing position: money collected or billed versus cost already spent.
  const underBilled = actual !== null && j.contract > 0 ? round2(actual - j.invoiced) : null;
  let health = 'none';
  if (hasBudget) {
    if (projectedMargin < 0) health = 'alert';
    else if (marginTarget && projectedMarginPct < marginTarget) health = 'watch';
    else health = 'good';
  }
  if (actual !== null && j.projectedCost !== null && actual > j.projectedCost * 1.02) health = 'alert';
  return { ...j, hasBudget, projectedMargin, projectedMarginPct, actual, costProgress, remainingCost, billedProgress, underBilled, health };
}

export function compute(ctx) {
  const { model, settings, scope, now } = ctx;
  const jt = jtIn(model, scope);
  const target = toNum((settings.main || {}).grossMarginTarget);
  const it = {};
  const srNote = scope === 'all' ? ' Seal Right jobs are not costed anywhere.' : '';

  if (!jt || !jt.loaded.jobs) {
    const why = scope === 'sr' ? 'Seal Right jobs exist only as QuickBooks invoices: no quote-to-cost record, no hours, no materials per job.' : 'JobTread could not be read.';
    const b = blind(why, scope === 'sr' ? undefined : fixSheet('command', 'See connection status'));
    const items = finalizeItems('job', Object.fromEntries(['quoted', 'labour', 'material', 'equipment', 'fuel_travel', 'subs', 'change_orders', 'est_vs_actual', 'hours', 'percent_complete', 'remaining_cost'].map((k) => [`job.${k}`, b])));
    return { items, headline: [{ label: 'Signed jobs', value: null, blind: true, hint: scope === 'sr' ? 'not tracked for Seal Right' : 'JobTread not read' }], minions: itemMinions('job', items), data: { jobs: [], active: [], loaded: false, srOnly: scope === 'sr' } };
  }

  const jobs = jt.jobs.map((j) => jobView(j, target));
  const active = jobs.filter((j) => j.stage === 'active');
  const budgeted = active.filter((j) => j.hasBudget);
  const sum = (list, f) => round2(list.reduce((t, j) => t + (f(j) || 0), 0));
  const contract = sum(active, (j) => j.contract);

  it['job.quoted'] = active.length
    ? live(`${money(contract)} signed on ${plural(active.length, 'job')}`, `${money(sum(active, (j) => j.originalContract))} original contracts plus ${money(sum(active, (j) => j.changeOrders))} approved after.${srNote}`, 'JobTread approved proposals', 'good')
    : partial('No signed jobs', `JobTread has ${plural(jobs.length, 'open job')} but none with an approved proposal.${srNote}`, 'JobTread', 'watch');

  const actualTotal = sum(active, (j) => j.actual);
  const billCount = active.reduce((t, j) => t + j.billsCount, 0);
  const hasTime = jt.time && jt.time.entries > 5;
  it['job.labour'] = hasTime
    ? partial(`${jt.time.hours} hours logged this year`, `${money(jt.time.cost)} of labour cost from JobTread time entries.`, 'JobTread time entries', 'none')
    : blind(`No crew time is being logged in JobTread (${jt.time ? `${jt.time.entries} entries this year` : 'none readable'}), so labour cost per job is unknown. It is the largest cost you cannot see.`, { label: 'What to start doing', go: { sheet: 'ppl' } });

  const costSplit = (label) => (billCount ? partial(`Inside ${money(actualTotal)} of recorded cost`, `JobTread has ${plural(billCount, 'supplier bill')} on signed jobs but they are not split into ${label}. Assign a cost type to each bill line and this fills in.`, 'JobTread bills', 'none', fixSheet('pur', 'See bills by supplier')) : blind(`No supplier bills are recorded against signed jobs, so ${label} cannot be measured.`));
  it['job.material'] = costSplit('materials');
  it['job.subs'] = costSplit('subcontractors');
  it['job.equipment'] = blind('JobTread has no Equipment cost type and no equipment charges against jobs. Add an Equipment cost type, or log rental bills under one cost code.');
  it['job.fuel_travel'] = blind('Fuel and travel are paid by card and never assigned to a job. The bank feed shows fuel in total (see Financial health) but not per job.');

  const co = sum(active, (j) => j.changeOrders);
  const pendingCo = jt.docs.filter((d) => d.type === 'customerOrder' && d.status === 'pending' && d.isChangeOrder);
  it['job.change_orders'] = active.length
    ? live(`${money(co)} approved after the original contract`, `${plural(active.reduce((t, j) => t + j.changeOrderCount, 0), 'approved change order')}${pendingCo.length ? `; ${plural(pendingCo.length, 'change order')} worth ${money(pendingCo.reduce((t, d) => t + d.price, 0))} awaiting approval` : ''}. JobTread counts every approved proposal after the first as a change order unless it is named otherwise.`, 'JobTread proposals', pendingCo.length ? 'watch' : 'none')
    : blind('No signed jobs to measure change orders on.');

  if (budgeted.length) {
    const price = sum(budgeted, (j) => j.projectedPrice);
    const cost = sum(budgeted, (j) => j.projectedCost);
    const losing = budgeted.filter((j) => j.projectedMargin < 0);
    it['job.est_vs_actual'] = partial(
      `${money(price - cost)} projected (${pct((price - cost) / price)})`,
      `${money(price)} of price against ${money(cost)} of budgeted cost on ${plural(budgeted.length, 'budgeted job')}; ${money(sum(budgeted, (j) => j.actual))} spent so far.${losing.length ? ` ${losing.map((j) => j.name).join(', ')} ${losing.length === 1 ? 'is' : 'are'} budgeted to lose money.` : ''} Labour is missing from actual cost.`,
      'JobTread budgets and bills',
      losing.length ? 'alert' : 'good',
    );
  } else {
    it['job.est_vs_actual'] = blind('No signed job has both a budget and a price in JobTread.');
  }

  it['job.hours'] = blind(hasTime ? 'Hours are logged but budgets do not carry labour hours to compare against.' : 'No hours are budgeted or logged per job.', { label: 'What to start doing', go: { sheet: 'ppl' } });

  const withProgress = active.filter((j) => j.costProgress !== null || j.progress !== null);
  it['job.percent_complete'] = withProgress.length
    ? partial(`${withProgress.length} of ${active.length} signed jobs measured`, withProgress.map((j) => `${j.name}: ${j.costProgress !== null ? `${pct(j.costProgress)} of budget spent` : ''}${j.costProgress !== null && j.progress !== null ? ', ' : ''}${j.progress !== null ? `${pct(j.progress)} of schedule done` : ''}`).join('. ') + '.', 'JobTread costs and schedule', 'none')
    : blind('No signed job has costs or a schedule to measure progress from.');

  const remaining = sum(budgeted, (j) => j.remainingCost);
  it['job.remaining_cost'] = budgeted.length ? partial(`${money(remaining)} left to spend`, `Budgeted cost less cost recorded, on ${plural(budgeted.length, 'budgeted job')}. Understated wherever labour is not in the actuals.`, 'JobTread budgets', 'none') : blind('No budgets to measure remaining cost against.');

  const items = finalizeItems('job', it);

  // ---- minions: a small crew per job ----
  const minions = [...itemMinions('job', items)];
  for (const j of jobs) {
    if (j.stage !== 'active' && !j.hasBudget) continue;
    const base = { action: { label: 'Open job', go: { sheet: 'job', job: j.id } } };
    const signed = j.stage === 'active';
    if (j.hasBudget) {
      minions.push(minion(`job.margin:${j.id}`, 'job', 'Margin watcher', j.name, j.projectedMargin < 0 ? 'alert' : target && j.projectedMarginPct < target ? 'watch' : 'clear', j.projectedMargin < 0 ? `Budgeted cost ${money(j.projectedCost)} is ${money(-j.projectedMargin)} more than the price ${money(j.projectedPrice)}.` : `Projected margin ${money(j.projectedMargin)} (${pct(j.projectedMarginPct)})${target ? `, target ${pct(target)}` : ''}.`, { ...base, weight: j.projectedMargin < 0 ? 92 : 40, amount: j.projectedMargin }));
      if (j.actual !== null) minions.push(minion(`job.overrun:${j.id}`, 'job', 'Cost overrun watcher', j.name, j.actual > j.projectedCost * 1.02 ? 'alert' : j.costProgress > 0.9 && (j.progress === null || j.progress < 0.8) ? 'watch' : 'clear', `${money(j.actual)} spent of ${money(j.projectedCost)} budgeted (${pct(j.costProgress)}).`, { ...base, weight: 55, amount: j.actual - j.projectedCost }));
    } else if (signed) {
      minions.push(minion(`job.nobudget:${j.id}`, 'job', 'Budget checker', j.name, 'blind', `Signed for ${money(j.contract)} but JobTread has no cost budget, so profit cannot be measured.`, { ...base, weight: 45 }));
    }
    if (!signed) continue;
    if (j.underBilled !== null) minions.push(minion(`job.billing:${j.id}`, 'job', 'Billing watcher', j.name, j.underBilled > Math.max(5000, j.contract * 0.05) ? 'watch' : 'clear', j.underBilled > 0 ? `${money(j.actual)} of cost recorded against ${money(j.invoiced)} invoiced: you are carrying ${money(j.underBilled)}.` : `Invoiced ${money(j.invoiced)} against ${money(j.actual)} of recorded cost.`, { ...base, weight: 50, amount: j.underBilled }));
    if (j.billsUnpaid > 0) minions.push(minion(`job.bills:${j.id}`, 'job', 'Unpaid bill counter', j.name, j.billsOverdue > 0 ? 'alert' : 'watch', `${money(j.billsUnpaid)} of supplier bills unpaid${j.billsOverdue > 0 ? `, ${money(j.billsOverdue)} past due` : ''}.`, { ...base, weight: 60, amount: j.billsUnpaid }));
    if (j.arBalance > 0) minions.push(minion(`job.ar:${j.id}`, 'job', 'JobTread invoice checker', j.name, 'watch', `JobTread shows ${money(j.arBalance)} of invoices unpaid. If QuickBooks shows it paid, mark it paid in JobTread.`, { ...base, weight: 30, amount: j.arBalance }));
    minions.push(minion(`job.remaining:${j.id}`, 'job', 'Left-to-bill tracker', j.name, 'clear', `${money(Math.max(0, j.contract - j.invoiced))} of the ${money(j.contract)} contract is still to invoice.`, { ...base, weight: 10 }));
  }
  for (const d of pendingCo) minions.push(minion(`job.co:${d.id}`, 'job', 'Change order chaser', `${d.job} · ${d.account}`, 'watch', `Change order for ${money(d.price)} sent ${shortDate(d.issueDate, now)} is not approved. Work done before approval is at your risk.`, { weight: 58, amount: d.price }));

  const worst = budgeted.slice().sort((a, b) => a.projectedMargin - b.projectedMargin)[0];
  const headline = [
    { label: 'Signed work', value: moneyShort(contract), hint: `${plural(active.length, 'job')} under contract`, go: { sheet: 'job' } },
    { label: 'Projected job margin', value: budgeted.length ? moneyShort(sum(budgeted, (j) => j.projectedMargin)) : null, blind: !budgeted.length, hint: worst && worst.projectedMargin < 0 ? `${worst.name} is underwater` : budgeted.length ? `${budgeted.length} budgeted` : 'no budgets', health: worst && worst.projectedMargin < 0 ? 'alert' : 'none', go: { sheet: 'job' } },
  ];
  return { items, headline, minions, data: { jobs, active, budgeted, loaded: true, target, time: jt.time, exampleHidden: jt.exampleJobsHidden, docsShort: jt.docsShort } };
}

export default { key: 'job', compute };
