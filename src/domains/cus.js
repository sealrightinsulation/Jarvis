// A-07 Customers: who matters most, who pays, and who needs a call from you.

import { live, partial, blind, fixRegister, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, pct, plural, toNum, shortDate, daysBetween, round2 } from '../app/format.js';
import { inScope, COMPANIES } from '../registers/schemas.js';
import { customerRollup, companiesIn, jtIn, sameParty } from '../model/derive.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const cos = companiesIn(model, scope);
  const jt = jtIn(model, scope);
  const all = customerRollup(model, scope);
  const notes = (registers.customer_notes || []).filter((r) => inScope(r, scope));
  const issues = (registers.issues || []).filter((r) => inScope(r, scope));
  const loaded = cos.some((c) => c.loaded.customers);
  const it = {};
  const noteFor = (c) => notes.find((n) => n.customer && sameParty(n.customer, c.name)) || null;
  const rows = all.map((c) => ({ ...c, note: noteFor(c) }));
  const billed = rows.filter((c) => c.ytd > 0).sort((a, b) => b.ytd - a.ytd);
  const total = round2(billed.reduce((t, c) => t + c.ytd, 0));
  const top10 = billed.slice(0, 10);
  const limit = toNum((settings.main || {}).concentrationPct) || 0.25;

  if (loaded && billed.length) {
    const top = billed[0];
    it['cus.top_revenue'] = live(`${top.name}: ${money(top.ytd)}`, `Top ${Math.min(10, billed.length)} customers bring ${money(top10.reduce((t, c) => t + c.ytd, 0))} of ${money(total)} invoiced this year (${pct(top10.reduce((t, c) => t + c.ytd, 0) / total)}). ${top.name} alone is ${pct(top.ytd / total)}.`, 'QuickBooks sales by customer', top.ytd / total > limit ? 'watch' : 'good');
  } else {
    it['cus.top_revenue'] = blind('Sales by customer could not be read from QuickBooks.');
  }

  const withMargin = rows.filter((c) => c.projectedMargin !== null).sort((a, b) => b.projectedMargin - a.projectedMargin);
  it['cus.top_profit'] = withMargin.length
    ? partial(`${withMargin[0].name}: ${money(withMargin[0].projectedMargin)} projected`, `Only ${plural(withMargin.length, 'customer')} ${withMargin.length === 1 ? 'has' : 'have'} a signed JobTread job with a budget, so projected profit can be ranked for ${withMargin.length === 1 ? 'that one' : 'those'} alone${withMargin.some((c) => c.projectedMargin < 0) ? `; ${withMargin.filter((c) => c.projectedMargin < 0).map((c) => c.name).join(', ')} ${withMargin.filter((c) => c.projectedMargin < 0).length === 1 ? 'is' : 'are'} projected to lose money` : ''}. Everyone else is revenue only.`, 'JobTread budgets', withMargin.some((c) => c.projectedMargin < 0) ? 'alert' : 'none')
    : blind('Profit by customer needs job costs. QuickBooks has none, and no signed JobTread job has a budget.', { label: 'Open job costing', go: { sheet: 'job' } });

  const payers = rows.filter((c) => c.paidCount >= 1);
  if (payers.length) {
    const slow = payers.filter((c) => c.lateShare >= 0.5).sort((a, b) => b.daysLateSum / b.paidCount - a.daysLateSum / a.paidCount);
    it['cus.pay_on_time'] = live(`${payers.length - slow.length} of ${payers.length} customers usually pay on time`, slow.length ? `Usually late: ${slow.slice(0, 4).map((c) => `${c.name} (${Math.round(c.daysLateSum / c.paidCount)} days late on average)`).join('; ')}.` : 'Nobody has paid late more than half the time in the last 12 months.', 'QuickBooks paid invoices', slow.length ? 'watch' : 'good');
  } else {
    it['cus.pay_on_time'] = blind('No paid invoices could be read to judge payment habits.');
  }

  const rated = notes.filter((n) => toNum(n.difficulty) !== null);
  it['cus.difficult'] = rated.length ? live(`${plural(rated.filter((n) => toNum(n.difficulty) >= 4).length, 'difficult customer')} flagged`, rated.filter((n) => toNum(n.difficulty) >= 4).map((n) => n.customer).join(', ') || 'Nobody rated 4 or 5 for difficulty.', 'Your relationship notes', 'none', fixRegister('customer_notes', 'Add a note')) : blind('Only you know who is hard to work with. Rate your main customers once and Jarvis will weigh it against what they are worth.', fixRegister('customer_notes', 'Rate a customer'));

  const openOf = (kind) => issues.filter((i) => i.kind === kind && i.status !== 'closed');
  const anyOf = (kind) => issues.some((i) => i.kind === kind);
  it['cus.complaints'] = anyOf('complaint') ? live(`${plural(openOf('complaint').length, 'open complaint')}`, openOf('complaint').slice(0, 3).map((i) => `${i.customer || 'Unknown'}: ${i.title}`).join('; ') || 'All logged complaints are closed.', 'Your issues log', openOf('complaint').length ? 'watch' : 'good', fixRegister('issues', 'Log one')) : blind('Complaints are not logged anywhere.', fixRegister('issues', 'Log a complaint'));
  it['cus.warranty'] = anyOf('warranty') ? live(`${plural(openOf('warranty').length, 'open warranty claim')}`, `${money(issues.filter((i) => i.kind === 'warranty').reduce((t, i) => t + (toNum(i.cost) || 0), 0))} spent on warranty work logged so far.`, 'Your issues log', openOf('warranty').length ? 'watch' : 'good', fixRegister('issues', 'Log one')) : blind('Warranty claims are not logged anywhere.', fixRegister('issues', 'Log a warranty claim'));

  const lapsed = rows.filter((c) => c.prevFull > 0 && c.ytd === 0).sort((a, b) => b.prevFull - a.prevFull);
  it['cus.repeat_opps'] = loaded && cos.some((c) => c.loaded.customersPrev) ? live(`${plural(lapsed.length, 'customer')} from last year not invoiced this year`, lapsed.length ? `Worth ${money(lapsed.reduce((t, c) => t + c.prevFull, 0))} last year. Largest: ${lapsed.slice(0, 4).map((c) => `${c.name} (${moneyShort(c.prevFull)})`).join(', ')}.` : 'Every customer from last year has been invoiced again.', 'QuickBooks sales by customer', 'none') : blind('Last year’s customers could not be read to compare.');

  const scored = notes.filter((n) => toNum(n.satisfaction) !== null);
  it['cus.satisfaction'] = scored.length ? live(`${(scored.reduce((t, n) => t + toNum(n.satisfaction), 0) / scored.length).toFixed(1)} of 5 across ${plural(scored.length, 'customer')}`, scored.filter((n) => toNum(n.satisfaction) <= 2).map((n) => `${n.customer} is unhappy`).join('; ') || 'Nobody rated 2 or lower.', 'Your relationship notes', scored.some((n) => toNum(n.satisfaction) <= 2) ? 'watch' : 'good', fixRegister('customer_notes', 'Update')) : blind('Customer satisfaction is not recorded. A 1 to 5 score for your top ten is enough to start.', fixRegister('customer_notes', 'Score a customer'));

  const promised = notes.filter((n) => n.commitments);
  const unbilled = jt ? jt.jobs.filter((j) => j.stage === 'active' && j.contract > j.invoiced) : [];
  it['cus.commitments'] = unbilled.length || promised.length ? partial(`${plural(unbilled.length, 'signed job')} with work still owed`, `${unbilled.slice(0, 4).map((j) => `${j.customer}: ${money(j.contract - j.invoiced)} left on ${j.name}`).join('; ')}${unbilled.length ? '. ' : ''}${promised.length ? `${plural(promised.length, 'customer')} with promises you noted.` : 'Informal promises are not recorded.'}`, 'JobTread contracts + your notes', 'none', fixRegister('customer_notes', 'Note a promise')) : blind('No signed work or noted promises are on record.', fixRegister('customer_notes', 'Note a promise'));

  const gcs = notes.filter((n) => ['gc', 'developer', 'builder'].includes(n.type));
  it['cus.gc_relationships'] = gcs.length ? live(`${plural(gcs.length, 'contractor or developer')} tracked`, gcs.map((n) => `${n.customer}${n.lastContact ? ` (last spoke ${shortDate(n.lastContact, now)})` : ''}`).join('; ') + '.', 'Your relationship notes', gcs.some((n) => n.lastContact && daysBetween(n.lastContact, now) > 60) ? 'watch' : 'good', fixRegister('customer_notes', 'Update')) : blind('Customers are not tagged as contractors, developers or homeowners, so these relationships cannot be singled out.', fixRegister('customer_notes', 'Tag a contractor'));

  const items = finalizeItems('cus', it);

  // ---- minions: one relationship keeper per customer that matters ----
  const minions = [...itemMinions('cus', items)];
  for (const c of billed.slice(0, 40)) {
    const share = total ? c.ytd / total : 0;
    const n = c.note;
    const quiet = n && n.lastContact ? daysBetween(n.lastContact, now) : null;
    const idBase = `${c.company}:${c.name}`.replace(/[^A-Za-z0-9:]+/g, '_');
    minions.push(minion(`cus.rel:${idBase}`, 'cus', 'Relationship keeper', `${c.name} · ${COMPANIES[c.company].name}`, !n ? (share > 0.05 ? 'blind' : 'clear') : quiet !== null && quiet > 60 ? 'watch' : n.nextTouch && n.nextTouch < model.today ? 'watch' : 'clear', !n ? `${money(c.ytd)} this year (${pct(share)}). No relationship note on file.` : quiet !== null ? `${money(c.ytd)} this year. You last spoke ${quiet} days ago.` : `${money(c.ytd)} this year. No last-contact date recorded.`, { weight: Math.round(share * 100), amount: c.ytd, action: !n ? fixRegister('customer_notes', 'Add a note') : undefined }));
    if (share > limit) minions.push(minion(`cus.conc:${idBase}`, 'cus', 'Concentration lookout', c.name, 'watch', `${pct(share)} of this year’s invoiced revenue comes from this one customer.`, { weight: 55, amount: c.ytd }));
    if (c.paidCount >= 2 && c.lateShare >= 0.5) minions.push(minion(`cus.slow:${idBase}`, 'cus', 'Payment habit tracker', c.name, 'watch', `Paid late on ${c.paidLate} of ${c.paidCount} invoices, ${Math.round(c.daysLateSum / c.paidCount)} days late on average.`, { weight: 34 }));
  }
  for (const c of lapsed.slice(0, 15)) minions.push(minion(`cus.lapsed:${c.company}:${c.name}`.replace(/[^A-Za-z0-9:.]+/g, '_'), 'cus', 'Win-back scout', `${c.name} · ${COMPANIES[c.company].name}`, 'watch', `Invoiced ${money(c.prevFull)} last year and nothing this year.`, { weight: 15 + Math.min(20, c.prevFull / 20000), amount: c.prevFull, action: { label: 'Draft a check-in', go: { ask: `Draft a short, friendly check-in message to ${c.name}, a past customer, asking how the last project is holding up and whether they have anything coming up.` } } }));
  for (const i of issues.filter((x) => x.status !== 'closed' && ['complaint', 'warranty', 'dispute'].includes(x.kind))) {
    const age = i.opened ? daysBetween(i.opened, now) : null;
    minions.push(minion(`cus.issue:${i.id}`, 'cus', 'Issue closer', `${i.title}${i.customer ? ` · ${i.customer}` : ''}`, age !== null && age > 30 ? 'alert' : 'watch', `Open ${i.kind}${age !== null ? ` for ${age} days` : ''}${toNum(i.exposure) ? `, ${money(i.exposure)} at risk` : ''}.`, { weight: 62, amount: toNum(i.exposure), action: fixRegister('issues', 'Update') }));
  }

  const headline = [{ label: 'Largest customer', value: billed.length ? pct(billed[0].ytd / total) : null, blind: !billed.length, hint: billed.length ? `${billed[0].name} of this year’s revenue` : '', health: billed.length && billed[0].ytd / total > limit ? 'watch' : 'none', go: { sheet: 'cus' } }];
  return { items, headline, minions, data: { rows, billed, top10, total, lapsed, withMargin, payers, notes, issues, loaded, limit } };
}

export default { key: 'cus', compute };
