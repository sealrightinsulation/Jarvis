// A-10 Purchasing and suppliers: where the money goes and who may spend it.
// Spend comes from JobTread bills (Advanced Builds). Terms and limits come from your list.

import { live, partial, blind, fixRegister, fixSettings, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, pct, plural, toNum, round2, shortDate, daysBetween } from '../app/format.js';
import { inScope } from '../registers/schemas.js';
import { jtIn, sameParty, anyBank } from '../model/derive.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const jt = jtIn(model, scope);
  const list = (registers.suppliers || []).filter((r) => inScope(r, scope));
  const inventory = (registers.inventory || []).filter((r) => inScope(r, scope));
  const vendors = jt ? jt.vendors.slice().sort((a, b) => b.billed - a.billed) : [];
  const termsFor = (v) => list.find((x) => x.name && sameParty(x.name, v.name)) || null;
  const rows = vendors.map((v) => ({ ...v, terms: termsFor(v) }));
  const spend = round2(vendors.reduce((t, v) => t + v.billed, 0));
  const bank = anyBank(model);
  const bankIn = bank && (scope === 'all' || scope === bank.company) ? bank : null;
  const it = {};
  const srGap = scope !== 'ab' ? ' Seal Right purchases appear only as uncategorized bank and card transactions.' : '';

  const approved = list.filter((x) => x.approved !== false);
  it['pur.approved'] = list.length ? live(`${plural(approved.length, 'approved supplier')}`, vendors.length ? `${rows.filter((v) => !v.terms).length} of the ${vendors.length} suppliers you have bills from are not on your approved list.` : 'From your supplier list.', 'Your supplier list', rows.some((v) => !v.terms && v.billed > 10000) ? 'watch' : 'good', fixRegister('suppliers', 'Update')) : vendors.length ? partial(`${plural(vendors.length, 'supplier')} with bills in JobTread`, `Largest: ${vendors.slice(0, 3).map((v) => `${v.name} (${money(v.billed)})`).join(', ')}. None is marked approved, with terms, anywhere.${srGap}`, 'JobTread bills', 'watch', fixRegister('suppliers', 'Record supplier terms')) : blind(`No suppliers are on file and no bills could be read.${srGap}`, fixRegister('suppliers', 'Add a supplier'));

  it['pur.pricing'] = list.some((x) => x.lastPriceReview) ? live(`${plural(list.filter((x) => x.lastPriceReview).length, 'supplier')} with a pricing review date`, 'Unit prices themselves are not recorded; JobTread bills carry totals.', 'Your supplier list', 'none') : blind('Material unit prices are not tracked anywhere, so price creep cannot be spotted. Record when each main supplier’s pricing was last negotiated to start.', fixRegister('suppliers', 'Record a review date'));
  const field = (key, label, what) => {
    const have = list.filter((x) => x[key] !== undefined && x[key] !== null && x[key] !== '');
    return have.length ? live(`On file for ${plural(have.length, 'supplier')}`, have.slice(0, 4).map((x) => `${x.name}: ${key === 'creditLimit' ? money(x[key]) : x[key]}`).join('; ') + '.', 'Your supplier list', 'none', fixRegister('suppliers', 'Update')) : blind(`${label} are not recorded for any supplier. ${what}`, fixRegister('suppliers', 'Record supplier terms'));
  };
  it['pur.terms'] = field('terms', 'Payment terms', 'Knowing who gives you 30 days and who wants cash on delivery is what lets you time payments.');
  it['pur.discounts'] = field('discount', 'Volume and early-payment discounts', '');
  const limited = rows.filter((v) => v.terms && toNum(v.terms.creditLimit) !== null);
  const over = limited.filter((v) => v.unpaid > toNum(v.terms.creditLimit));
  it['pur.credit_limits'] = limited.length ? live(over.length ? `${plural(over.length, 'supplier')} over the credit limit` : `Within limits at ${plural(limited.length, 'supplier')}`, limited.map((v) => `${v.name}: ${money(v.unpaid)} owed of ${money(v.terms.creditLimit)}`).join('; ') + '.', 'JobTread bills + your supplier list', over.length ? 'alert' : 'good') : field('creditLimit', 'Credit limits', '');

  if (jt && jt.loaded.docs.vendorBill) {
    const bills = jt.docs.filter((d) => d.type === 'vendorBill' && d.status !== 'draft' && d.status !== 'denied');
    const pos = jt.docs.filter((d) => d.type === 'vendorOrder');
    const noPo = bills.filter((d) => !d.refs.length);
    const threshold = toNum(s.poRequiredOver);
    it['pur.po_approvals'] = partial(`${plural(pos.length, 'purchase order')} for ${plural(bills.length, 'bill')}`, pos.length ? `${noPo.length} bills are not linked to a purchase order.` : 'Purchase orders are not being used in JobTread: every bill arrives without one, so nothing is approved before it is bought.', 'JobTread', pos.length === 0 && bills.length ? 'watch' : 'none');
    const big = noPo.filter((d) => threshold !== null && (d.cost || d.balance + d.amountPaid) > threshold);
    it['pur.unauthorized'] = threshold !== null ? partial(big.length ? `${plural(big.length, 'bill')} over ${money(threshold)} with no purchase order` : 'None over your limit', big.slice(0, 3).map((d) => `${d.account} ${money(d.cost || d.balance + d.amountPaid)} on ${d.job}`).join('; ') || 'Every bill above the limit has a purchase order.', 'JobTread bills', big.length ? 'watch' : 'good') : blind('Nothing defines an unauthorized purchase yet. Set the amount above which a purchase order is required and Jarvis will list every bill that broke the rule.', fixSettings('main', 'poRequiredOver', 'Set the limit'));
  } else {
    const b = blind(`No purchase orders or bills could be read.${srGap}`);
    it['pur.po_approvals'] = b;
    it['pur.unauthorized'] = b;
  }

  const wasted = inventory.filter((m) => toNum(m.wastePct) !== null);
  it['pur.waste'] = wasted.length ? live(`${pct(wasted.reduce((t, m) => t + toNum(m.wastePct), 0) / wasted.length)} average waste`, wasted.map((m) => `${m.name}: ${pct(m.wastePct)}`).join(', ') + '.', 'Your inventory count', 'none') : blind('Material waste is not measured. Comparing foam sets bought against board feet invoiced would be the simplest version.', fixRegister('inventory', 'Record waste'));
  const low = inventory.filter((m) => toNum(m.onHand) !== null && toNum(m.reorderLevel) !== null && toNum(m.onHand) <= toNum(m.reorderLevel));
  it['pur.inventory'] = inventory.length ? live(`${money(inventory.reduce((t, m) => t + (toNum(m.onHand) || 0) * (toNum(m.unitCost) || 0), 0))} on hand`, low.length ? `Reorder: ${low.map((m) => m.name).join(', ')}.` : `${plural(inventory.length, 'material')} counted, none at reorder level.`, 'Your inventory count', low.length ? 'watch' : 'good', fixRegister('inventory', 'Update count')) : blind('No inventory is counted.', fixRegister('inventory', 'Count your stock'));
  const rated = list.filter((x) => toNum(x.reliability) !== null);
  it['pur.reliability'] = rated.length ? live(`${plural(rated.filter((x) => toNum(x.reliability) <= 2).length, 'unreliable supplier')}`, rated.filter((x) => toNum(x.reliability) <= 2).map((x) => x.name).join(', ') || 'Nobody rated 2 or lower.', 'Your supplier list', rated.some((x) => toNum(x.reliability) <= 2) ? 'watch' : 'good') : blind('Supplier reliability is not rated.', fixRegister('suppliers', 'Rate a supplier'));

  const yearAgo = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const targets = rows.filter((v) => v.billed > 0 && spend > 0 && v.billed / spend >= 0.08 && (!v.terms || !v.terms.lastPriceReview || v.terms.lastPriceReview < yearAgo));
  it['pur.negotiate'] = vendors.length ? partial(`${plural(targets.length, 'supplier')} worth a pricing conversation`, targets.length ? `${targets.slice(0, 4).map((v) => `${v.name} (${money(v.billed)}, ${pct(v.billed / spend)} of spend)`).join('; ')}: each is over 8% of what you buy with no price review on file in the last year.` : 'Every large supplier has a recent price review on file.', 'JobTread bills + your supplier list', 'none') : blind(`No supplier spend could be read to rank.${srGap}`);

  const limits = [['limitCrew', 'crew'], ['limitLead', 'lead'], ['limitManager', 'manager']].filter(([k]) => toNum(s[k]) !== null);
  it['pur.limits'] = limits.length ? live(limits.map(([k, n]) => `${n} ${money(s[k])}`).join(', '), `${toNum(s.poRequiredOver) !== null ? `A purchase order is required above ${money(s.poRequiredOver)}.` : 'No purchase-order threshold is set.'}`, 'Your settings', 'good', fixSettings('main', 'limitCrew', 'Update')) : blind('No approval limits are set, so nobody knows what they can buy without asking you.', fixSettings('main', 'limitCrew', 'Set approval limits'));

  const items = finalizeItems('pur', it);
  const minions = [...itemMinions('pur', items)];
  for (const v of rows.slice(0, 60)) {
    const id = String(v.id || v.name).replace(/[^A-Za-z0-9]+/g, '_');
    minions.push(minion(`pur.vendor:${id}`, 'pur', 'Supplier file keeper', v.name, v.terms ? 'clear' : spend && v.billed / spend > 0.05 ? 'blind' : 'clear', v.terms ? `${money(v.billed)} billed; terms ${v.terms.terms || 'not set'}.` : `${money(v.billed)} billed across ${plural(v.bills, 'bill')}. No terms, limit or approval on file.`, { weight: Math.round((spend ? v.billed / spend : 0) * 60), amount: v.billed, action: v.terms ? undefined : fixRegister('suppliers', 'Record terms') }));
    if (v.overdue > 0) minions.push(minion(`pur.overdue:${id}`, 'pur', 'Supplier relations watcher', v.name, v.overdue > 20000 ? 'alert' : 'watch', `${money(v.overdue)} past due to this supplier.`, { weight: 52, amount: v.overdue }));
    if (v.terms && toNum(v.terms.creditLimit) !== null && v.unpaid > toNum(v.terms.creditLimit)) minions.push(minion(`pur.limit:${id}`, 'pur', 'Credit limit watcher', v.name, 'alert', `${money(v.unpaid)} owed against a ${money(v.terms.creditLimit)} limit.`, { weight: 66, amount: v.unpaid }));
  }
  for (const m of low) minions.push(minion(`pur.stock:${m.id}`, 'pur', 'Reorder watcher', m.name, 'watch', `${m.onHand} ${m.unit || ''} on hand, reorder at ${m.reorderLevel}.`, { weight: 38 }));

  const unknownOut = bankIn ? round2(Object.values(bankIn.flows.byMonth).reduce((t, m) => t + (m.byKind.cheque || 0) + (m.byKind.etransfer_out || 0), 0)) : null;
  const headline = [{ label: 'Supplier spend on record', value: vendors.length ? money(spend) : null, blind: !vendors.length, hint: vendors.length ? `${vendors.length} suppliers in JobTread` : 'no bills readable', go: { sheet: 'pur' } }];
  return { items, headline, minions, data: { rows, spend, list, inventory, low, unknownOut, bankPurpose: bankIn ? bankIn.flows.totals.byPurpose : null, loaded: !!(jt && jt.loaded.docs.vendorBill) } };
}

export default { key: 'pur', compute };
