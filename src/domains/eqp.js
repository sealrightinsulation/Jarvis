// A-08 Equipment and vehicles. QuickBooks has no fixed assets, so this runs on your equipment
// list and repair log, with a nudge from the equipment-finance payments seen in the bank feed.

import { live, partial, blind, fixRegister, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, pct, plural, toNum, round2, shortDate, daysBetween, parseDate } from '../app/format.js';
import { inScope } from '../registers/schemas.js';
import { anyBank } from '../model/derive.js';

export function assetView(a, repairs, now) {
  const price = toNum(a.purchasePrice);
  const life = toNum(a.usefulLifeYears);
  const salvage = toNum(a.salvageValue) || 0;
  const bought = parseDate(a.purchaseDate);
  const ageYears = bought ? Math.max(0, daysBetween(bought, now) / 365.25) : null;
  const perYear = price !== null && life ? round2((price - salvage) / life) : null;
  const accumulated = perYear !== null && ageYears !== null ? round2(Math.min(price - salvage, perYear * ageYears)) : null;
  const mine = repairs.filter((r) => r.asset === a.id);
  const year = String(now.getFullYear());
  const ytd = mine.filter((r) => String(r.date || '').startsWith(year));
  const used = toNum(a.daysUsedLast30);
  const revenue = toNum(a.annualRevenue);
  const annualCost = (perYear || 0) + (toNum(a.annualInsurance) || 0) + round2(ytd.reduce((t, r) => t + (toNum(r.cost) || 0), 0));
  return {
    ...a,
    ageYears: ageYears !== null ? round2(ageYears) : null,
    depreciationPerYear: perYear,
    bookValue: accumulated !== null ? round2(price - accumulated) : null,
    replaceYear: bought && life ? bought.getFullYear() + Math.round(life) : null,
    repairsYtd: round2(ytd.reduce((t, r) => t + (toNum(r.cost) || 0), 0)),
    downtimeYtd: ytd.reduce((t, r) => t + (toNum(r.downtimeDays) || 0), 0),
    utilization: used !== null ? Math.min(1, used / 22) : null,
    roi: revenue !== null && annualCost > 0 ? round2(revenue / annualCost) : null,
    serviceDue: a.nextServiceDate ? daysBetween(now, a.nextServiceDate) : null,
    insuranceDue: a.insuranceExpiry ? daysBetween(now, a.insuranceExpiry) : null,
  };
}

export function compute(ctx) {
  const { model, registers, scope, now } = ctx;
  const repairs = (registers.maintenance || []).filter((r) => inScope(r, scope));
  const assets = (registers.equipment || []).filter((r) => inScope(r, scope) && r.status !== 'retired').map((a) => assetView(a, repairs, now));
  const bank = anyBank(model);
  const detected = bank && (scope === 'all' || scope === bank.company) ? bank.recurring.filter((r) => r.kind === 'equipment_finance') : [];
  const rental = bank && (scope === 'all' || scope === bank.company) ? round2([...bank.cardRows, ...bank.cashRows].filter((r) => r.purpose === 'equipment_rental' && r.out).reduce((t, r) => t - r.amount, 0)) : 0;
  const it = {};
  const none = (what) => blind(`No equipment is on file.${what ? ` ${what}` : ''}`.trim(), fixRegister('equipment', 'Add equipment'));
  const hint = detected.length ? ` The bank feed shows ${plural(detected.length, 'equipment-finance payment')} totalling ${money(detected.reduce((t, r) => t + r.monthly, 0))} a month, so there are financed assets to list.` : '';

  const vehicles = assets.filter((a) => a.kind === 'vehicle' || a.kind === 'trailer');
  it['eqp.inventory'] = assets.length ? live(`${plural(assets.length, 'asset')} on file`, `${plural(vehicles.length, 'vehicle or trailer', 'vehicles and trailers')}, ${assets.length - vehicles.length} other.${toNum(assets[0].purchasePrice) !== null ? ` ${money(assets.reduce((t, a) => t + (toNum(a.purchasePrice) || 0), 0))} at purchase price.` : ''}`, 'Your equipment list', 'none', fixRegister('equipment', 'Add')) : none(`Neither QuickBooks file has a fixed-asset account.${hint}`);
  it['eqp.vehicles'] = assets.length ? (vehicles.length ? live(`${plural(vehicles.length, 'vehicle or trailer', 'vehicles and trailers')}`, ['owned', 'financed', 'leased', 'rented'].map((o) => `${vehicles.filter((v) => v.ownership === o).length} ${o}`).join(', ') + '.', 'Your equipment list', 'none') : partial('No vehicles listed', 'Equipment is on file but none is marked as a vehicle or trailer.', 'Your equipment list', 'none', fixRegister('equipment', 'Add a vehicle'))) : none('');
  const paying = assets.filter((a) => toNum(a.monthlyPayment));
  it['eqp.payments'] = paying.length ? live(`${money(paying.reduce((t, a) => t + toNum(a.monthlyPayment), 0))} a month`, `${plural(paying.length, 'financed or leased asset')}; ${money(paying.reduce((t, a) => t + (toNum(a.balanceOwing) || 0), 0))} owing in total.`, 'Your equipment list', 'none') : detected.length ? partial(`${money(detected.reduce((t, r) => t + r.monthly, 0))} a month seen in the bank`, `${detected.map((r) => `${r.payee} ${money(r.amount)}`).join('; ')}. Which asset each pays for, the balance and the end date are not on file.`, 'Bank feed', 'watch', fixRegister('equipment', 'Match them to assets')) : assets.length ? live('No payments', 'Nothing on file is financed or leased.', 'Your equipment list', 'good') : none('');
  const due = assets.filter((a) => a.serviceDue !== null && a.serviceDue <= 14);
  it['eqp.maintenance'] = assets.length ? (assets.some((a) => a.nextServiceDate) ? live(due.length ? `${plural(due.length, 'service')} due within two weeks` : 'No service due', due.map((a) => `${a.name}: ${a.serviceDue < 0 ? `${-a.serviceDue} days overdue` : shortDate(a.nextServiceDate, now)}`).join('; ') || 'Every asset with a service date is more than two weeks out.', 'Your equipment list', due.some((a) => a.serviceDue < 0) ? 'alert' : due.length ? 'watch' : 'good') : blind('No asset has a next-service date.', fixRegister('equipment', 'Add service dates'))) : none('');
  it['eqp.repairs'] = repairs.length ? live(`${money(assets.reduce((t, a) => t + a.repairsYtd, 0))} this year`, assets.filter((a) => a.repairsYtd > 0).sort((a, b) => b.repairsYtd - a.repairsYtd).slice(0, 3).map((a) => `${a.name}: ${money(a.repairsYtd)}`).join('; ') || 'No repair cost logged this year.', 'Your repair log', 'none', fixRegister('maintenance', 'Log a repair')) : blind('Repairs are not logged.', fixRegister('maintenance', 'Log a repair'));
  const used = assets.filter((a) => a.utilization !== null);
  it['eqp.utilization'] = used.length ? live(`${pct(used.reduce((t, a) => t + a.utilization, 0) / used.length)} average utilization`, used.filter((a) => a.utilization < 0.4).length ? `Under 40%: ${used.filter((a) => a.utilization < 0.4).map((a) => a.name).join(', ')}.${rental ? ` Meanwhile ${money(rental)} went on equipment rental this year.` : ''}` : 'Nothing is sitting idle.', 'Your equipment list', used.some((a) => a.utilization < 0.4) ? 'watch' : 'good') : assets.length ? blind('No asset has days-used recorded.', fixRegister('equipment', 'Add days used')) : none(rental ? `The bank feed shows ${money(rental)} spent on equipment rental this year.` : '');
  const insured = assets.filter((a) => a.insuranceExpiry);
  it['eqp.insurance'] = insured.length ? live(`${insured.length} of ${assets.length} have insurance on file`, insured.filter((a) => a.insuranceDue <= 30).map((a) => `${a.name}: ${a.insuranceDue < 0 ? 'EXPIRED' : `expires ${shortDate(a.insuranceExpiry, now)}`}`).join('; ') || 'Nothing expires within 30 days.', 'Your equipment list', insured.some((a) => a.insuranceDue < 0) ? 'alert' : insured.some((a) => a.insuranceDue <= 30) ? 'watch' : insured.length < assets.length ? 'watch' : 'good') : assets.length ? blind('No asset has an insurance expiry date.', fixRegister('equipment', 'Add insurance dates')) : none('');
  const dep = assets.filter((a) => a.depreciationPerYear !== null);
  it['eqp.depreciation'] = dep.length ? partial(`${money(dep.reduce((t, a) => t + a.depreciationPerYear, 0))} a year`, `Straight-line on ${plural(dep.length, 'asset')}; book value now about ${money(dep.reduce((t, a) => t + (a.bookValue || 0), 0))}. Your accountant’s tax figures will differ.`, 'Your equipment list', 'none') : assets.length ? blind('Needs purchase price and useful life on each asset.', fixRegister('equipment', 'Add price and life')) : none('');
  const yr = now.getFullYear();
  const soon = assets.filter((a) => a.replaceYear !== null && a.replaceYear <= yr + 1);
  it['eqp.replacement'] = assets.some((a) => a.replaceYear !== null) ? live(soon.length ? `${plural(soon.length, 'asset')} due for replacement by ${yr + 1}` : 'Nothing due before ' + (yr + 2), soon.map((a) => `${a.name} (${a.replaceYear})`).join(', ') || 'Based on purchase date plus useful life.', 'Your equipment list', soon.length ? 'watch' : 'good') : assets.length ? blind('Needs purchase date and useful life on each asset.', fixRegister('equipment', 'Add dates')) : none('');
  it['eqp.downtime'] = repairs.length ? live(`${assets.reduce((t, a) => t + a.downtimeYtd, 0)} days out of service this year`, assets.filter((a) => a.downtimeYtd > 0).map((a) => `${a.name}: ${a.downtimeYtd}`).join(', ') || 'No downtime logged.', 'Your repair log', 'none') : blind('Downtime is not logged.', fixRegister('maintenance', 'Log downtime'));
  const roi = assets.filter((a) => a.roi !== null);
  it['eqp.roi'] = roi.length ? partial(`${plural(roi.length, 'asset')} measured`, roi.sort((a, b) => a.roi - b.roi).map((a) => `${a.name}: earns ${a.roi}x its yearly cost`).join('; ') + '.', 'Your equipment list', roi.some((a) => a.roi < 1) ? 'watch' : 'good') : blind('Return needs the revenue each asset earns per year, plus its price and useful life.', fixRegister('equipment', 'Add revenue earned'));

  const items = finalizeItems('eqp', it);
  const minions = [...itemMinions('eqp', items)];
  for (const a of assets) {
    minions.push(minion(`eqp.service:${a.id}`, 'eqp', 'Service scheduler', a.name, a.serviceDue === null ? 'blind' : a.serviceDue < 0 ? 'alert' : a.serviceDue <= 14 ? 'watch' : 'clear', a.serviceDue === null ? 'No next-service date on file.' : a.serviceDue < 0 ? `Service was due ${shortDate(a.nextServiceDate, now)}.` : `Next service ${shortDate(a.nextServiceDate, now)}.`, { weight: 44, action: fixRegister('equipment', 'Update') }));
    minions.push(minion(`eqp.ins:${a.id}`, 'eqp', 'Insurance expiry watcher', a.name, a.insuranceDue === null ? 'blind' : a.insuranceDue < 0 ? 'alert' : a.insuranceDue <= 30 ? 'watch' : 'clear', a.insuranceDue === null ? 'No insurance expiry on file.' : a.insuranceDue < 0 ? `Insurance expired ${shortDate(a.insuranceExpiry, now)}.` : `Insured to ${shortDate(a.insuranceExpiry, now)}.`, { weight: a.insuranceDue !== null && a.insuranceDue < 0 ? 88 : 36 }));
    if (toNum(a.monthlyPayment)) minions.push(minion(`eqp.pay:${a.id}`, 'eqp', 'Payoff tracker', a.name, 'clear', `${money(a.monthlyPayment)} a month${a.payoffDate ? ` until ${shortDate(a.payoffDate, now)}` : ''}${toNum(a.balanceOwing) ? `, ${money(a.balanceOwing)} owing` : ''}.`, { weight: 10 }));
    if (a.status === 'down') minions.push(minion(`eqp.down:${a.id}`, 'eqp', 'Downtime tracker', a.name, 'watch', 'Marked down / in the shop.', { weight: 42 }));
    if (a.replaceYear !== null && a.replaceYear <= yr + 1) minions.push(minion(`eqp.replace:${a.id}`, 'eqp', 'Replacement planner', a.name, 'watch', `Reaches the end of its useful life in ${a.replaceYear}.`, { weight: 20 }));
  }
  for (const r of detected) if (!paying.length) minions.push(minion(`eqp.unmatched:${r.id}`, 'eqp', 'Finance matcher', `${r.payee} ${money(r.amount)}`, 'blind', 'A repeating equipment-finance payment with no asset on file to match it to.', { weight: 24, amount: r.monthly, action: fixRegister('equipment', 'Add the asset') }));

  const headline = [{ label: 'Equipment on file', value: assets.length ? String(assets.length) : null, blind: !assets.length, hint: assets.length ? `${money(paying.reduce((t, a) => t + toNum(a.monthlyPayment), 0))}/mo in payments` : detected.length ? 'financing seen in bank' : 'nothing listed', go: { sheet: 'eqp' } }];
  return { items, headline, minions, data: { assets, repairs, detected, rental } };
}

export default { key: 'eqp', compute };
