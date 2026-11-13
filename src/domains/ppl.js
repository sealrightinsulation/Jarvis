// A-03 People: who is performing, who is not, and who can run a crew without you.
// No connected system knows your team, so this sheet runs on the roster and weekly scorecards.

import { live, partial, blind, fixRegister, fixSettings, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, pct, plural, toNum, round2, isoWeekId, addDays } from '../app/format.js';
import { inScope } from '../registers/schemas.js';
import { jtIn } from '../model/derive.js';

const RATINGS = ['productivity', 'quality', 'attitude', 'safety'];

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const people = (registers.people || []).filter((r) => inScope(r, scope) && r.active !== false);
  const cards = registers.scorecards || [];
  const burden = toNum((settings.main || {}).burdenPct) || 0;
  const jt = jtIn(model, scope);
  const weeks = [0, 1, 2, 3].map((i) => isoWeekId(addDays(now, -7 * i)));
  const thisWeek = weeks[0];
  const lastWeek = weeks[1];
  const it = {};

  const rows = people.map((p) => {
    const mine = cards.filter((c) => c.person === p.id && weeks.includes(c.week));
    const avg = (k) => {
      const v = mine.map((c) => toNum(c[k])).filter((x) => x !== null);
      return v.length ? round2(v.reduce((t, x) => t + x, 0) / v.length) : null;
    };
    const scores = Object.fromEntries(RATINGS.map((k) => [k, avg(k)]));
    const rated = RATINGS.map((k) => scores[k]).filter((x) => x !== null);
    const overall = rated.length ? round2(rated.reduce((t, x) => t + x, 0) / rated.length) : null;
    const hours = round2(mine.reduce((t, c) => t + (toNum(c.hours) || 0), 0));
    const absent = mine.reduce((t, c) => t + (toNum(c.daysAbsent) || 0), 0);
    const revenue = round2(mine.reduce((t, c) => t + (toNum(c.revenueProduced) || 0), 0));
    const rate = toNum(p.hourlyRate);
    const cost = rate !== null && hours ? round2(hours * rate * (1 + burden)) : null;
    // "Consistently" = scored below 3 overall in at least three of the last four weeks.
    const lowWeeks = mine.filter((c) => {
      const r = RATINGS.map((k) => toNum(c[k])).filter((x) => x !== null);
      return r.length && r.reduce((t, x) => t + x, 0) / r.length < 3;
    }).length;
    return { ...p, cards: mine.length, scores, overall, hours, absent, revenue, cost, valueRatio: cost && revenue ? round2(revenue / cost) : null, lowWeeks, scoredThisWeek: mine.some((c) => c.week === thisWeek), scoredLastWeek: mine.some((c) => c.week === lastWeek) };
  });
  const scored = rows.filter((r) => r.cards > 0);
  const noRoster = blind('No team is on file. JobTread has one user (you), and QuickBooks Payroll cannot be read for Canadian companies, so nothing here can be filled in automatically.', fixRegister('people', 'Add your team'));
  const noCards = (what) => (people.length ? blind(`${plural(people.length, 'person', 'people')} on the roster but no scorecards in the last four weeks. ${what}`, fixRegister('scorecards', 'Score this week')) : noRoster);

  it['ppl.attendance'] = scored.length ? live(`${scored.reduce((t, r) => t + r.absent, 0)} days absent or late in 4 weeks`, scored.filter((r) => r.absent > 0).map((r) => `${r.name}: ${r.absent}`).join(', ') || 'Nobody missed a day.', 'Your scorecards', scored.some((r) => r.absent >= 3) ? 'watch' : 'good') : noCards('Attendance comes from the weekly scorecard.');
  const jtHours = jt && jt.time ? jt.time.hours : 0;
  it['ppl.hours'] = scored.length ? live(`${round2(scored.reduce((t, r) => t + r.hours, 0))} hours in 4 weeks`, scored.map((r) => `${r.name}: ${r.hours}`).join(', ') + '.', 'Your scorecards', 'none') : noCards(`JobTread has ${jtHours} hours logged all year, so time is not coming from there either.`);
  for (const k of RATINGS) {
    const id = `ppl.${k}`;
    const vals = scored.filter((r) => r.scores[k] !== null);
    it[id] = vals.length ? live(`${(vals.reduce((t, r) => t + r.scores[k], 0) / vals.length).toFixed(1)} of 5 team average`, vals.filter((r) => r.scores[k] < 3).length ? `Below 3: ${vals.filter((r) => r.scores[k] < 3).map((r) => `${r.name} (${r.scores[k]})`).join(', ')}.` : 'Nobody is below 3.', 'Your scorecards', vals.some((r) => r.scores[k] < 3) ? 'watch' : 'good') : noCards('Each week, give every person a 1 to 5.');
  }
  const described = people.filter((p) => p.strengths || p.weaknesses);
  it['ppl.strengths'] = people.length ? (described.length ? (described.length === people.length ? live : partial)(`Written down for ${described.length} of ${people.length}`, 'From the roster.', 'Your team roster', 'none', fixRegister('people', 'Update')) : blind('Nobody’s strengths or weaknesses are written down.', fixRegister('people', 'Describe each person'))) : noRoster;
  const valued = rows.filter((r) => r.valueRatio !== null);
  it['ppl.wage_vs_value'] = valued.length ? live(`${plural(valued.length, 'person', 'people')} measured`, valued.sort((a, b) => a.valueRatio - b.valueRatio).map((r) => `${r.name}: ${money(r.revenue)} produced for ${money(r.cost)} of wages (${r.valueRatio}x)`).join('; ') + '.', 'Your scorecards and roster', valued.some((r) => r.valueRatio < 2) ? 'watch' : 'good') : people.length ? blind('Needs each person’s wage on the roster, and hours plus revenue produced on the weekly scorecard.', fixRegister('scorecards', 'Score this week')) : noRoster;
  const indep = people.filter((p) => p.independent === 'yes');
  it['ppl.independent'] = people.length ? (people.some((p) => p.independent) ? live(`${indep.length} of ${people.length} can work alone`, indep.map((p) => p.name).join(', ') || 'Nobody is marked able to work independently yet.', 'Your team roster', indep.length ? 'good' : 'watch', fixRegister('people', 'Update')) : blind('Nobody has been marked either way.', fixRegister('people', 'Mark each person'))) : noRoster;
  const sup = people.filter((p) => p.supervisorReady === 'ready' || p.supervisorReady === 'developing');
  it['ppl.supervisor'] = people.length ? (people.some((p) => p.supervisorReady) ? live(`${plural(sup.length, 'supervisor candidate')}`, sup.map((p) => `${p.name} (${p.supervisorReady === 'ready' ? 'ready now' : '6-12 months'})`).join(', ') || 'Nobody is marked as supervisor material.', 'Your team roster', sup.length ? 'good' : 'watch', fixRegister('people', 'Update')) : blind('Nobody has been assessed for supervisor potential.', fixRegister('people', 'Mark each person'))) : noRoster;
  const low = rows.filter((r) => r.lowWeeks >= 3);
  it['ppl.underperforming'] = scored.length ? live(low.length ? `${plural(low.length, 'person', 'people')} below 3 for three weeks or more` : 'Nobody consistently below 3', low.map((r) => `${r.name} (${r.overall} average)`).join(', ') || `Based on ${plural(scored.length, 'person', 'people')} with scorecards in the last four weeks.`, 'Your scorecards', low.length ? 'alert' : 'good') : noCards('Underperformance only shows up after a few weeks of scores.');

  const items = finalizeItems('ppl', it);
  const minions = [...itemMinions('ppl', items)];
  for (const r of rows) {
    minions.push(minion(`ppl.card:${r.id}`, 'ppl', 'Scorecard keeper', r.name, r.scoredLastWeek || r.scoredThisWeek ? 'clear' : 'blind', r.scoredLastWeek || r.scoredThisWeek ? `Scored ${r.scoredThisWeek ? 'this week' : 'last week'}.` : 'No scorecard for this week or last.', { weight: 22, action: fixRegister('scorecards', 'Score now') }));
    if (r.overall !== null) minions.push(minion(`ppl.perf:${r.id}`, 'ppl', 'Performance watcher', r.name, r.lowWeeks >= 3 ? 'alert' : r.overall < 3 ? 'watch' : 'clear', `${r.overall} of 5 over ${plural(r.cards, 'week')}: productivity ${r.scores.productivity ?? 'n/a'}, quality ${r.scores.quality ?? 'n/a'}, attitude ${r.scores.attitude ?? 'n/a'}, safety ${r.scores.safety ?? 'n/a'}.`, { weight: 48 }));
    if (r.scores.safety !== null && r.scores.safety < 3) minions.push(minion(`ppl.safety:${r.id}`, 'ppl', 'Safety watcher', r.name, 'alert', `Safety scored ${r.scores.safety} of 5 over the last four weeks.`, { weight: 78 }));
    if (r.valueRatio !== null) minions.push(minion(`ppl.value:${r.id}`, 'ppl', 'Wage-to-value checker', r.name, r.valueRatio < 2 ? 'watch' : 'clear', `Produced ${money(r.revenue)} for ${money(r.cost)} of loaded wages (${r.valueRatio}x).`, { weight: 26 }));
    if (toNum(r.hourlyRate) === null) minions.push(minion(`ppl.wage:${r.id}`, 'ppl', 'Roster completer', r.name, 'blind', 'No wage on file, so cost and value cannot be worked out.', { weight: 12, action: fixRegister('people', 'Add wage') }));
  }

  const headline = [{ label: 'Team on file', value: people.length ? String(people.length) : null, blind: !people.length, hint: people.length ? `${scored.length} scored in 4 weeks` : 'add your roster', health: low.length ? 'alert' : 'none', go: { sheet: 'ppl' } }];
  return { items, headline, minions, data: { rows, weeks, thisWeek, low, people: people.length, burden, jtUsers: jt ? jt.users : null, jtTime: jt ? jt.time : null } };
}

export default { key: 'ppl', compute };
