// A-09 Legal and compliance. Almost none of this lives in a connected system, so the sheet is a
// register with expiry watches. It tells the owner what is on file, not what the law requires.

import { live, partial, blind, fixRegister, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, plural, toNum, shortDate, daysBetween } from '../app/format.js';
import { inScope } from '../registers/schemas.js';
import { companiesIn, jtIn } from '../model/derive.js';

const expiryStatus = (days) => (days === null ? 'blind' : days < 0 ? 'alert' : days <= 60 ? 'watch' : 'clear');

export function compute(ctx) {
  const { model, registers, scope, now } = ctx;
  const policies = (registers.policies || []).filter((r) => inScope(r, scope)).map((p) => ({ ...p, days: p.expiry ? daysBetween(now, p.expiry) : null }));
  const contracts = (registers.contracts || []).filter((r) => inScope(r, scope));
  const issues = (registers.issues || []).filter((r) => inScope(r, scope));
  const people = (registers.people || []).filter((r) => inScope(r, scope) && r.active !== false);
  const jt = jtIn(model, scope);
  const cos = companiesIn(model, scope);
  const it = {};

  const policyItem = (kind, name, why) => {
    const list = policies.filter((p) => p.kind === kind);
    if (!list.length) return blind(`No ${name} is on file. ${why}`, fixRegister('policies', `Add ${name}`));
    const bad = list.filter((p) => p.days !== null && p.days < 0);
    const soon = list.filter((p) => p.days !== null && p.days >= 0 && p.days <= 60);
    const undated = list.filter((p) => p.days === null);
    return live(
      list.map((p) => `${p.provider || p.name}${toNum(p.coverage) ? ` ${money(p.coverage)}` : ''}`).slice(0, 2).join('; '),
      bad.length ? `${bad.map((p) => p.name).join(', ')} expired ${shortDate(bad[0].expiry, now)}.` : soon.length ? `${soon.map((p) => `${p.name} renews ${shortDate(p.expiry, now)}`).join('; ')}.` : undated.length ? 'On file with no expiry date.' : `In force; next renewal ${shortDate(list.map((p) => p.expiry).sort()[0], now)}.`,
      'Your compliance list',
      bad.length || list.some((p) => p.status === 'lapsed') ? 'alert' : soon.length || undated.length ? 'watch' : 'good',
      fixRegister('policies', 'Update'),
    );
  };
  it['lgl.liability'] = policyItem('liability', 'liability insurance', 'A certificate of insurance is usually the first thing a general contractor asks for.');
  it['lgl.wsib'] = policyItem('wsib', 'WSIB account or clearance certificate', 'Clearance certificates expire and contractors can refuse to pay without one.');
  it['lgl.vehicle_insurance'] = policyItem('vehicle', 'commercial vehicle insurance', '');
  it['lgl.health_safety'] = policyItem('health_safety', 'health and safety requirement', 'For example your policy, training records and Working at Heights tickets.');
  it['lgl.building_code'] = policyItem('building_code', 'building code or permit requirement', '');
  it['lgl.fire_regs'] = policyItem('fire', 'fire and building regulation item', 'For spray foam this includes thermal barrier requirements.');

  const kindItem = (kind, name, extra) => {
    const list = contracts.filter((c) => c.kind === kind);
    if (!list.length) return blind(`No ${name} is on file.${extra ? ` ${extra}` : ''}`, fixRegister('contracts', `Add ${name}`));
    const unsigned = list.filter((c) => c.signed === false);
    return live(`${plural(list.length, 'agreement')} on file`, unsigned.length ? `${plural(unsigned.length, 'agreement')} without a signed copy: ${unsigned.map((c) => c.name).join(', ')}.` : 'All have a signed copy on file.', 'Your agreements list', unsigned.length ? 'watch' : 'good', fixRegister('contracts', 'Update'));
  };
  const employees = people.filter((p) => p.employment === 'employee' || p.employment === 'seasonal' || p.employment === 'office');
  const subs = people.filter((p) => p.employment === 'subcontractor');
  it['lgl.employment'] = kindItem('employment', 'employment agreement', employees.length ? `Your roster has ${plural(employees.length, 'employee')}.` : '');
  it['lgl.subcontractor'] = kindItem('subcontractor', 'subcontractor agreement', subs.length ? `Your roster has ${plural(subs.length, 'subcontractor')}.` : jt && jt.vendors.length ? `JobTread shows bills from ${plural(jt.vendors.length, 'supplier or subcontractor', 'suppliers and subcontractors')}.` : '');
  const signedJt = jt ? jt.docs.filter((d) => d.type === 'customerOrder' && d.status === 'approved') : [];
  const custContracts = contracts.filter((c) => c.kind === 'customer');
  it['lgl.customer_contracts'] = custContracts.length || signedJt.length ? partial(`${plural(signedJt.length, 'approved proposal')} in JobTread${custContracts.length ? `, ${custContracts.length} on file here` : ''}`, `${signedJt.length ? `Approved JobTread proposals worth ${money(signedJt.reduce((t, d) => t + d.price, 0))} act as your customer contracts. ` : ''}Jarvis cannot read their terms; record the important ones here. Seal Right work has no contract record beyond the invoice.`, 'JobTread + your agreements list', 'none', fixRegister('contracts', 'Record contract terms')) : blind('No customer contracts are on file.', fixRegister('contracts', 'Add a contract'));

  const paid = cos.flatMap((c) => c.paidInvoices);
  const termed = contracts.filter((c) => c.paymentTerms);
  it['lgl.payment_terms'] = paid.length ? partial(`Invoices are due in ${Math.round(paid.reduce((t, i) => t + Math.max(0, daysBetween(i.date, i.dueDate) || 0), 0) / paid.length)} days on average`, `From ${plural(paid.length, 'paid invoice')}.${termed.length ? ` Contract terms recorded for ${termed.length} agreements.` : ' Deposit, draw and holdback terms written into contracts are not recorded.'}`, 'QuickBooks invoices', 'none', fixRegister('contracts', 'Record contract terms')) : blind('No invoice terms could be read and no contract terms are recorded.', fixRegister('contracts', 'Record contract terms'));

  const warranties = contracts.filter((c) => c.warrantyEnds && c.warrantyEnds >= model.today);
  it['lgl.warranty'] = contracts.some((c) => c.warrantyTerms || c.warrantyEnds) ? live(`${plural(warranties.length, 'warranty', 'warranties')} still running`, warranties.slice(0, 3).map((c) => `${c.party || c.name} until ${shortDate(c.warrantyEnds, now)}`).join('; ') || 'No warranty you recorded is still in force.', 'Your agreements list', 'none') : blind('The warranties you give are not recorded, so nothing tracks when your obligation on a job ends.', fixRegister('contracts', 'Record a warranty'));
  const disputes = issues.filter((i) => i.kind === 'dispute');
  const openD = disputes.filter((i) => i.status !== 'closed');
  it['lgl.disputes'] = disputes.length ? live(`${plural(openD.length, 'open dispute')}`, openD.map((i) => `${i.title}${toNum(i.exposure) ? ` (${money(i.exposure)} at risk)` : ''}`).join('; ') || 'All recorded disputes are closed.', 'Your issues log', openD.length ? 'alert' : 'good', fixRegister('issues', 'Update')) : blind('No disputes are recorded. If there are none, that is good news; log any that arise so the exposure is visible.', fixRegister('issues', 'Log a dispute'));
  const exposed = contracts.filter((c) => c.liabilities);
  const unreviewed = contracts.filter((c) => toNum(c.value) >= 100000 && !c.reviewedByLawyer);
  it['lgl.liabilities'] = contracts.length ? partial(`${plural(exposed.length, 'agreement')} with obligations noted`, unreviewed.length ? `${plural(unreviewed.length, 'contract')} over $100,000 not marked as reviewed by a lawyer: ${unreviewed.map((c) => c.name).join(', ')}.` : 'No large contract is flagged as unreviewed.', 'Your agreements list', unreviewed.length ? 'watch' : 'none', fixRegister('contracts', 'Update')) : blind('Nothing records what your contracts commit you to: penalties, indemnities, personal guarantees, holdbacks.', fixRegister('contracts', 'Record obligations'));

  const items = finalizeItems('lgl', it);
  const minions = [...itemMinions('lgl', items)];
  for (const p of policies) minions.push(minion(`lgl.policy:${p.id}`, 'lgl', 'Expiry watcher', p.name, p.status === 'lapsed' ? 'alert' : expiryStatus(p.days), p.days === null ? 'No expiry date on file.' : p.days < 0 ? `Expired ${shortDate(p.expiry, now)}.` : `Renews ${shortDate(p.expiry, now)}, ${p.days} days away.`, { weight: p.days !== null && p.days < 0 ? 95 : p.days !== null && p.days <= 30 ? 70 : 30, action: fixRegister('policies', 'Update') }));
  for (const c of contracts) {
    const end = c.endDate ? daysBetween(now, c.endDate) : null;
    minions.push(minion(`lgl.contract:${c.id}`, 'lgl', 'Agreement keeper', c.name, c.signed === false ? 'watch' : end !== null && end < 0 ? 'watch' : end !== null && end <= 60 ? 'watch' : 'clear', c.signed === false ? 'No signed copy on file.' : end === null ? 'On file, no end date.' : end < 0 ? `Ended ${shortDate(c.endDate, now)}.` : `Runs to ${shortDate(c.endDate, now)}.`, { weight: 24 }));
    if (c.warrantyEnds && c.warrantyEnds >= model.today) minions.push(minion(`lgl.warranty:${c.id}`, 'lgl', 'Warranty clock', c.party || c.name, 'clear', `Your warranty runs until ${shortDate(c.warrantyEnds, now)}.`, { weight: 8 }));
  }
  for (const p of people) {
    const has = contracts.some((c) => (c.kind === 'employment' || c.kind === 'subcontractor') && c.party && String(c.party).toLowerCase().includes(String(p.name).toLowerCase().split(' ')[0]));
    minions.push(minion(`lgl.person:${p.id}`, 'lgl', 'Paperwork checker', p.name, has ? 'clear' : 'blind', has ? 'An agreement is on file.' : `No ${p.employment === 'subcontractor' ? 'subcontractor' : 'employment'} agreement on file under this name.`, { weight: 14, action: fixRegister('contracts', 'Add agreement') }));
  }
  const expiring = policies.filter((p) => p.days !== null && p.days <= 60).length;
  const headline = [{ label: 'Policies and certificates', value: policies.length ? String(policies.length) : null, blind: !policies.length, hint: policies.length ? `${expiring} expiring or expired` : 'nothing on file', health: policies.some((p) => p.days !== null && p.days < 0) ? 'alert' : expiring ? 'watch' : 'none', go: { sheet: 'lgl' } }];
  return { items, headline, minions, data: { policies, contracts, disputes: openD, signedJt: signedJt.length } };
}

export default { key: 'lgl', compute };
