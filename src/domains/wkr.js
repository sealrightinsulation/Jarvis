// A-13 Weekly review: the once-a-week walk through the numbers that turns the other twelve
// sheets into a habit. Each step asks one question and puts the live facts beside it.
// A review is saved per ISO week in the `weekly` collection:
//   { checks: {stepKey: true}, notes: {stepKey: text}, decisions: [{id, text, done}],
//     closedOn: 'yyyy-mm-dd' | null, snapshot: {...headline numbers at close} }

import { live, partial, blind, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, plural, isoWeekId, addDays, shortDate, toNum } from '../app/format.js';

const fact = (label, value) => ({ label, value });
const m = (v) => (v === null || v === undefined ? 'not known' : money(v));

/** The ritual. `facts(r)` reads the other sheets' results; it must tolerate missing data. */
export const STEPS = [
  { key: 'cash', sheet: 'csh', title: 'Cash', question: 'Do we have the cash for the next two weeks?', facts: (r) => { const d = r.csh.data; return [fact('In the bank', m(d.cash.amount)), fact('Lowest point in 13 weeks', d.forecast.startKnown ? m(d.forecast.low.balance) : 'not known'), fact('Going out this week', m(d.forecast.weeks[0].outflow)), fact('Expected in this week', m(d.forecast.weeks[0].inflow))]; } },
  { key: 'collect', sheet: 'csh', title: 'Collections', question: 'Who owes us, and who gets a call today?', facts: (r) => { const a = r.csh.data.ar; return [fact('Owed to you', a.loaded ? money(a.total) : 'not known'), fact('Overdue', a.loaded ? money(a.overdueTotal) : 'not known'), ...a.overdue.slice(0, 3).map((i) => fact(i.customer, `${money(i.balance)}, ${i.daysOverdue} days`))]; } },
  { key: 'pay', sheet: 'pur', title: 'Payables', question: 'What has to be paid this week, and what can wait?', facts: (r) => { const p = r.csh.data.ap; return [fact('Unpaid supplier bills', p.loaded ? money(p.total) : 'not tracked'), fact('Past due', p.loaded ? money(p.overdueTotal) : 'not tracked'), ...p.overdue.slice(0, 3).map((b) => fact(b.account, `${money(b.balance)}, ${b.daysOverdue} days`))]; } },
  { key: 'sales', sheet: 'sal', title: 'Sales', question: 'Did every open quote get a follow-up? What did we win and lose?', facts: (r) => { const d = r.sal.data; return [fact('Open quotes', d.loaded ? `${d.quotes.length} worth ${money(d.quotes.reduce((t, q) => t + q.value, 0))}` : 'not known'), fact('Going stale', d.loaded ? String(d.staleQuotes.length) : 'not known'), fact('Won / lost this year', d.loaded ? `${d.outcomes.won} / ${d.outcomes.lost + d.outcomes.expired}` : 'not known'), fact('Signed, not yet billed', d.backlog.loaded ? money(d.backlog.total) : 'not known')]; } },
  { key: 'jobs', sheet: 'job', title: 'Job profit', question: 'Is every job making money? Which one worries me?', facts: (r) => { const d = r.job.data; if (!d.loaded) return [fact('Signed jobs', 'not tracked')]; const bad = d.jobs.filter((j) => j.health === 'alert'); return [fact('Signed jobs', String(d.active.length)), fact('With a budget', String(d.budgeted.length)), fact('In trouble', bad.length ? bad.map((j) => j.name).join(', ') : 'none flagged')]; } },
  { key: 'schedule', sheet: 'ops', title: 'Schedule', question: 'What slipped last week, and what starts in the next two?', facts: (r) => { const d = r.ops.data; return [fact('Tasks behind', d.tasks ? String(d.overdue.length) : 'not known'), fact('Starting in two weeks', d.tasks ? String(d.upcoming.length) : 'not known'), fact('Daily logs, last 120 days', d.logs ? String(d.logs.length) : 'not known')]; } },
  { key: 'people', sheet: 'ppl', title: 'People', question: 'Who did well? Who needs a conversation? Is everyone scored?', facts: (r) => { const d = r.ppl.data; return [fact('On the roster', String(d.people)), fact('Scored this week', String(d.rows.filter((x) => x.scoredThisWeek).length)), fact('Consistently below 3', d.low.length ? d.low.map((x) => x.name).join(', ') : 'nobody')]; } },
  { key: 'customers', sheet: 'cus', title: 'Customers', question: 'Which customer should hear from me personally this week?', facts: (r) => { const d = r.cus.data; return [fact('Largest this year', d.billed.length ? `${d.billed[0].name} (${money(d.billed[0].ytd)})` : 'not known'), fact('Open complaints and claims', String(d.issues.filter((i) => i.status !== 'closed').length)), fact('Past customers gone quiet', String(d.lapsed.length))]; } },
  { key: 'equipment', sheet: 'eqp', title: 'Equipment', question: 'Is anything down, due for service, or about to lose insurance?', facts: (r) => { const a = r.eqp.data.assets; return [fact('On file', String(a.length)), fact('Down', String(a.filter((x) => x.status === 'down').length)), fact('Service due in two weeks', String(a.filter((x) => x.serviceDue !== null && x.serviceDue <= 14).length))]; } },
  { key: 'compliance', sheet: 'lgl', title: 'Compliance', question: 'Is anything expiring in the next 60 days? Any dispute moving?', facts: (r) => { const d = r.lgl.data; return [fact('Policies on file', String(d.policies.length)), fact('Expiring or expired', String(d.policies.filter((p) => p.days !== null && p.days <= 60).length)), fact('Open disputes', String(d.disputes.length))]; } },
  { key: 'books', sheet: 'fin', title: 'Books', question: 'Are the books current enough to trust next week’s numbers?', facts: (r) => { const d = r.fin.data; return [fact('Bank transactions not yet categorized', d.bank ? String(d.bank.pendingReview) : 'no bank connected'), ...d.companies.map((c) => fact(`${c.name} expenses recorded`, c.hasCosts ? 'yes' : 'no'))]; } },
  { key: 'decide', sheet: 'str', title: 'Decisions', question: 'What am I deciding this week, and what am I handing to someone else?', facts: (r) => { const d = r.org.data; return [fact('Duties that still depend on you', `${d.ownerDuties} of 7`)]; } },
];

export function compute(ctx, results) {
  const { registers, now } = ctx;
  const reviews = registers.weekly || [];
  const weekId = isoWeekId(now);
  const current = reviews.find((r) => r.id === weekId) || null;
  const last8 = Array.from({ length: 8 }, (_, i) => isoWeekId(addDays(now, -7 * i)));
  const closed = reviews.filter((r) => r.closedOn);
  const streakDone = last8.filter((w) => closed.some((r) => r.id === w)).length;
  const checks = (current && current.checks) || {};
  const done = STEPS.filter((s) => checks[s.key]).length;
  const openDecisions = reviews.flatMap((r) => (Array.isArray(r.decisions) ? r.decisions : []).filter((d) => d && !d.done).map((d) => ({ ...d, week: r.id })));
  const go = { label: 'Open the review', go: { sheet: 'wkr' } };
  const it = {};

  if (current && current.closedOn) it['wkr.this_week'] = live(`Closed ${shortDate(current.closedOn, now)}`, `All ${STEPS.length} steps walked for ${weekId}.`, 'Your weekly reviews', 'good');
  else if (current && done) it['wkr.this_week'] = live(`${done} of ${STEPS.length} steps done`, `Review for ${weekId} is in progress.`, 'Your weekly reviews', 'watch', go);
  else if (reviews.length) it['wkr.this_week'] = live('Not started', `Nothing ticked yet for ${weekId}. It takes about twenty minutes.`, 'Your weekly reviews', now.getDay() >= 4 || now.getDay() === 0 ? 'alert' : 'watch', go);
  else it['wkr.this_week'] = blind('No weekly review has been recorded yet. The first one sets the baseline every later week is compared with.', { label: 'Start the first review', go: { sheet: 'wkr' } });

  it['wkr.streak'] = reviews.length ? live(`${streakDone} of the last 8 weeks reviewed`, closed.length ? `Last closed: ${closed.map((r) => r.id).sort().pop()}.` : 'No review has been closed yet.', 'Your weekly reviews', streakDone >= 6 ? 'good' : streakDone >= 3 ? 'watch' : 'alert', go) : blind('There is no review history yet.', go);
  it['wkr.decisions'] = reviews.length ? live(`${plural(openDecisions.length, 'open decision or follow-up', 'open decisions and follow-ups')}`, openDecisions.slice(0, 3).map((d) => `${d.text} (${d.week})`).join('; ') || 'Nothing carried over.', 'Your weekly reviews', openDecisions.length > 5 ? 'watch' : 'good', go) : blind('Decisions and follow-ups are captured during the weekly review.', go);

  const items = finalizeItems('wkr', it);
  const minions = [...itemMinions('wkr', items)];
  const closedNow = !!(current && current.closedOn);
  for (const s of STEPS) minions.push(minion(`wkr.step:${weekId}:${s.key}`, 'wkr', 'Review marshal', `${weekId} · ${s.title}`, checks[s.key] || closedNow ? 'clear' : 'watch', checks[s.key] || closedNow ? 'Reviewed this week.' : s.question, { weight: 20, action: go }));
  for (const d of openDecisions.slice(0, 40)) minions.push(minion(`wkr.decision:${d.week}:${d.id}`, 'wkr', 'Follow-up keeper', String(d.text).slice(0, 80), d.week !== weekId ? 'watch' : 'clear', `Raised in ${d.week} and not marked done.`, { weight: 26, action: go }));

  const steps = STEPS.map((s) => {
    let facts = [];
    try {
      facts = results ? s.facts(results) : [];
    } catch {
      facts = [fact('Live figures', 'not available right now')];
    }
    return { key: s.key, title: s.title, question: s.question, sheet: s.sheet, facts, checked: !!checks[s.key], note: (current && current.notes && current.notes[s.key]) || '' };
  });
  const headline = [{ label: 'Weekly review', value: closedNow ? 'Done' : `${done} of ${STEPS.length}`, hint: `${streakDone} of last 8 weeks reviewed`, health: closedNow ? 'good' : 'watch', go: { sheet: 'wkr' } }];
  return { items, headline, minions, data: { weekId, current, steps, done, closed: closedNow, history: reviews.slice().sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 12), openDecisions, streakDone } };
}

/** Numbers frozen into a review when it is closed, so next week can be compared with it. */
export function snapshotOf(results) {
  const g = (f, d = null) => {
    try {
      const v = f();
      return v === undefined ? d : v;
    } catch {
      return d;
    }
  };
  return {
    cash: g(() => results.csh.data.cash.amount),
    owed: g(() => results.csh.data.ar.total),
    overdue: g(() => results.csh.data.ar.overdueTotal),
    payables: g(() => results.csh.data.ap.total),
    quotes: g(() => results.sal.data.quotes.reduce((t, q) => t + q.value, 0)),
    backlog: g(() => results.sal.data.backlog.total),
    revenueYtd: g(() => results.fin.data.rev.ytd),
    forecastLow: g(() => results.csh.data.forecast.low.balance),
  };
}

export default { key: 'wkr', compute };
