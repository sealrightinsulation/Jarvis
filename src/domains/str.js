// A-12 Growth and strategy: targets, risks, and where the company should be in 1, 3 and 5 years.

import { live, partial, blind, fixRegister, fixSettings, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, pct, plural, toNum, round2, shortDate, daysBetween } from '../app/format.js';
import { inScope, COMPANIES } from '../registers/schemas.js';
import { revenueSeries, customerRollup, scopeKeys, companiesIn } from '../model/derive.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const st = settings.strategy || {};
  const plans = (registers.initiatives || []).filter((r) => inScope(r, scope));
  const loans = (registers.loans || []).filter((r) => inScope(r, scope));
  const comps = (registers.competitors || []).filter((r) => inScope(r, scope));
  const people = (registers.people || []).filter((r) => inScope(r, scope) && r.active !== false);
  const rev = revenueSeries(model, scope);
  const it = {};
  const dayOfYear = Math.max(1, daysBetween(new Date(now.getFullYear(), 0, 1), now) + 1);
  const yearShare = dayOfYear / 365;

  // ---- revenue target ----
  const targets = scopeKeys(scope).map((k) => ({ key: k, target: toNum(k === 'ab' ? s.revenueTargetAb : s.revenueTargetSr), ytd: model.companies[k] && model.companies[k].loaded.pnl ? model.companies[k].revenueYtd : null }));
  const set = targets.filter((t) => t.target);
  const pace = set.map((t) => ({ ...t, projected: t.ytd !== null ? round2(t.ytd / yearShare) : null, share: t.ytd !== null ? t.ytd / t.target : null }));
  if (set.length) {
    const behind = pace.filter((t) => t.projected !== null && t.projected < t.target * 0.95);
    it['str.revenue_target'] = (set.length === targets.length ? live : partial)(pace.map((t) => `${COMPANIES[t.key].name} ${t.share !== null ? pct(t.share) : 'n/a'} of ${moneyShort(t.target)}`).join(', '), pace.map((t) => (t.projected !== null ? `${COMPANIES[t.key].name} has invoiced ${money(t.ytd)} with ${pct(yearShare)} of the year gone; at this pace it finishes near ${money(t.projected)}` : `${COMPANIES[t.key].name} revenue could not be read`)).join('. ') + '.', 'QuickBooks revenue against your targets', behind.length ? 'watch' : 'good', fixSettings('main', 'revenueTargetAb', 'Update targets'));
  } else {
    it['str.revenue_target'] = blind(`No revenue target is set.${rev.loaded ? ` For reference, ${money(rev.ytd)} has been invoiced this year and ${money(rev.prevFull)} was invoiced last year.` : ''}`, fixSettings('main', scope === 'sr' ? 'revenueTargetSr' : 'revenueTargetAb', 'Set a target'));
  }
  const pt = toNum(s.profitTarget);
  it['str.profit_target'] = pt !== null ? (rev.loaded && rev.hasCosts ? live(`${money(rev.ytd - rev.costsYtd)} of ${money(pt)}`, 'From QuickBooks profit and loss.', 'QuickBooks', rev.ytd - rev.costsYtd < pt * yearShare ? 'watch' : 'good') : partial(`Target ${money(pt)}`, 'Progress cannot be measured: profit is not in the books until expenses are recorded.', 'Your target', 'watch', { label: 'How to fix the books', go: { sheet: 'fin', anchor: 'books' } })) : blind('No profit target is set.', fixSettings('main', 'profitTarget', 'Set a target'));

  // ---- plans by kind ----
  const planItem = (kinds, label, extra = '', addLabel = 'Add a plan') => {
    const list = plans.filter((p) => kinds.includes(p.kind) && p.status !== 'dropped' && p.status !== 'done');
    return list.length ? live(`${plural(list.length, 'plan')}`, list.slice(0, 3).map((p) => `${p.name}${toNum(p.investment) ? ` (${moneyShort(p.investment)}${toNum(p.expectedReturn) ? ` for ${moneyShort(p.expectedReturn)} a year` : ''})` : ''}`).join('; ') + '.', 'Your growth plans', 'none', fixRegister('initiatives', 'Add')) : blind(`No ${label} written down.${extra}`, fixRegister('initiatives', addLabel));
  };
  it['str.opportunities'] = planItem(['opportunity'], 'growth opportunities', '', 'Add a growth plan');
  it['str.services'] = planItem(['service'], 'new services', '', 'Add a growth plan');
  const cities = model.jt ? [...new Set(model.jt.jobs.map((j) => j.city).filter(Boolean))] : [];
  it['str.markets'] = planItem(['market'], 'new markets', cities.length && scope !== 'sr' ? ` JobTread jobs today are in ${cities.slice(0, 6).join(', ')}.` : '', 'Add a growth plan');
  it['str.hiring'] = planItem(['hire'], 'hiring plans', people.length ? ` The roster has ${plural(people.length, 'person', 'people')}.` : '', 'Add a growth plan');
  it['str.equipment_plan'] = planItem(['equipment'], 'equipment purchases', '', 'Add a growth plan');

  it['str.financing'] = st.financingStrategy ? live('Written down', `${String(st.financingStrategy).slice(0, 160)}${String(st.financingStrategy).length > 160 ? '…' : ''}${loans.length ? ` ${plural(loans.length, 'facility', 'facilities')} on file.` : ''}`, 'Your strategy notes', 'none', fixSettings('strategy', 'financingStrategy', 'Edit')) : blind('How growth gets paid for is not written down.', fixSettings('strategy', 'financingStrategy', 'Write it down'));
  it['str.competitors'] = comps.length ? live(`${plural(comps.length, 'competitor')} profiled`, comps.slice(0, 3).map((c) => c.name).join(', ') + '.', 'Your competitor notes', 'none', fixRegister('competitors', 'Add')) : blind('No competitor analysis is on file.', fixRegister('competitors', 'Add a competitor'));

  // ---- concentration ----
  const custs = customerRollup(model, scope).filter((c) => c.ytd > 0).sort((a, b) => b.ytd - a.ytd);
  const total = custs.reduce((t, c) => t + c.ytd, 0);
  const limit = toNum(s.concentrationPct) || 0.25;
  if (custs.length && total > 0) {
    const top3 = custs.slice(0, 3).reduce((t, c) => t + c.ytd, 0) / total;
    it['str.concentration'] = live(`Top customer ${pct(custs[0].ytd / total)}, top three ${pct(top3)}`, `${custs[0].name} is the largest of ${plural(custs.length, 'customer')} invoiced this year. Losing a customer above ${pct(limit)} of revenue is a risk worth planning for.`, 'QuickBooks sales by customer', custs[0].ytd / total > limit ? 'alert' : top3 > 0.6 ? 'watch' : 'good');
  } else {
    it['str.concentration'] = blind('Sales by customer could not be read.');
  }

  // ---- valuation ----
  const ebitda = toNum(st.ebitdaOverride);
  const lo = toNum(st.multipleLow) || 2.5;
  const hi = toNum(st.multipleHigh) || 4;
  it['str.valuation'] = ebitda ? partial(`${moneyShort(ebitda * lo)} to ${moneyShort(ebitda * hi)}`, `${money(ebitda)} of yearly profit before interest, tax and depreciation at ${lo} to ${hi} times. A rough owner’s estimate, not an appraisal: buyers also weigh how much the company depends on you and on a few customers.`, 'Your figures', 'none', fixSettings('strategy', 'ebitdaOverride', 'Update')) : blind('A valuation starts from yearly profit, which QuickBooks cannot supply until expenses are recorded. Enter the figure from your accountant’s year-end statements for a rough range.', fixSettings('strategy', 'ebitdaOverride', 'Enter yearly profit'));

  const text = (key, id, label) => {
    it[id] = st[key] ? live('Written down', `${String(st[key]).slice(0, 180)}${String(st[key]).length > 180 ? '…' : ''}`, 'Your strategy notes', 'none', fixSettings('strategy', key, 'Edit')) : blind(`${label} not written down.`, fixSettings('strategy', key, 'Write it down'));
  };
  text('exitStrategy', 'str.exit', 'Your exit strategy is');
  text('personalGoals', 'str.personal_goals', 'Your personal financial goals are');
  const horizons = ['vision1', 'vision3', 'vision5'].filter((k) => st[k]);
  it['str.horizons'] = horizons.length ? (horizons.length === 3 ? live : partial)(`${horizons.length} of 3 horizons written`, `1 year: ${st.vision1 ? String(st.vision1).slice(0, 80) : 'not written'}.`, 'Your strategy notes', horizons.length < 3 ? 'watch' : 'good', fixSettings('strategy', 'vision1', 'Edit')) : blind('Where the company should be in 1, 3 and 5 years is not written down.', fixSettings('strategy', 'vision1', 'Write it down'));

  const items = finalizeItems('str', it);
  const minions = [...itemMinions('str', items)];
  for (const t of pace) if (t.projected !== null) minions.push(minion(`str.pace:${t.key}`, 'str', 'Target pacer', `${COMPANIES[t.key].name} revenue target`, t.projected < t.target * 0.85 ? 'alert' : t.projected < t.target * 0.95 ? 'watch' : 'clear', `${money(t.ytd)} of ${money(t.target)} with ${pct(yearShare)} of the year gone; on pace for ${money(t.projected)}.`, { weight: 46, amount: t.target - t.projected }));
  for (const p of plans.filter((x) => x.status !== 'done' && x.status !== 'dropped')) {
    const d = p.targetDate ? daysBetween(now, p.targetDate) : null;
    minions.push(minion(`str.plan:${p.id}`, 'str', 'Plan keeper', p.name, d !== null && d < 0 ? 'watch' : 'clear', d === null ? `Status: ${p.status || 'idea'}. No target date.` : d < 0 ? `Target date ${shortDate(p.targetDate, now)} has passed; status ${p.status || 'idea'}.` : `Target ${shortDate(p.targetDate, now)}; status ${p.status || 'idea'}.`, { weight: 18, amount: toNum(p.investment) }));
  }
  for (const c of companiesIn(model, scope)) {
    if (!c.loaded.pnl || c.revenuePrevYtd === null || !c.revenuePrevYtd) continue;
    const ch = (c.revenueYtd - c.revenuePrevYtd) / c.revenuePrevYtd;
    minions.push(minion(`str.growth:${c.key}`, 'str', 'Growth tracker', `${c.name} year over year`, ch < -0.1 ? 'watch' : 'clear', `${money(c.revenueYtd)} invoiced this year against ${money(c.revenuePrevYtd)} by the same date last year (${ch >= 0 ? '+' : ''}${pct(ch)}).`, { weight: 28 }));
  }

  const headline = [{ label: 'Revenue target pace', value: pace.length && pace.every((t) => t.share !== null) ? pct(pace.reduce((t, x) => t + x.ytd, 0) / pace.reduce((t, x) => t + x.target, 0)) : null, blind: !pace.length, hint: pace.length ? `${pct(yearShare)} of the year gone` : 'no target set', go: { sheet: 'str' } }];
  return { items, headline, minions, data: { pace, yearShare, plans, custs: custs.slice(0, 8), total, ebitda, lo, hi, strategy: st, rev } };
}

export default { key: 'str', compute };
