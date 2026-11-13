// A-05 Operations: what is being built this week, by whom, and what is slipping.
// JobTread carries the schedule; almost nothing else about the field is recorded yet.

import { live, partial, blind, fixRegister, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, pct, plural, toNum, shortDate, daysBetween, isoDate, addDays } from '../app/format.js';
import { inScope } from '../registers/schemas.js';
import { jtIn } from '../model/derive.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const jt = jtIn(model, scope);
  const gap = toNum((settings.main || {}).logGapDays) || 3;
  const it = {};
  const people = (registers.people || []).filter((r) => inScope(r, scope) && r.active !== false);
  const equipment = (registers.equipment || []).filter((r) => inScope(r, scope) && r.status !== 'retired');
  const inventory = (registers.inventory || []).filter((r) => inScope(r, scope));
  const repairs = (registers.maintenance || []).filter((r) => inScope(r, scope));
  const issues = (registers.issues || []).filter((r) => inScope(r, scope));
  const today = isoDate(now);
  const in14 = isoDate(addDays(now, 14));

  const active = jt && jt.loaded.jobs ? jt.jobs.filter((j) => j.stage === 'active') : [];
  const tasks = jt && jt.tasks ? jt.tasks.filter((t) => !t.isGroup && !t.isToDo) : null;
  const overdue = tasks ? tasks.filter((t) => t.daysLate > 0) : [];
  const upcoming = tasks ? tasks.filter((t) => !t.done && t.startDate && t.startDate <= in14 && (t.endDate || t.startDate) >= today) : [];
  const assigned = tasks ? tasks.filter((t) => t.assignees.length) : [];

  // ---- active jobs ----
  if (jt && jt.loaded.jobs) {
    it['ops.active_jobs'] = partial(`${plural(active.length, 'signed job')} in JobTread`, `${active.map((j) => j.name).slice(0, 5).join(', ') || 'None'}${active.length > 5 ? ` and ${active.length - 5} more` : ''}. Seal Right crews and jobs are not scheduled anywhere Jarvis can read.`, 'JobTread', 'none');
  } else {
    it['ops.active_jobs'] = blind(scope === 'sr' ? 'Seal Right has no job schedule in any connected system.' : 'JobTread could not be read.');
  }

  // ---- crews ----
  const crews = [...new Set(people.map((p) => p.crew).filter(Boolean))];
  if (assigned.length) {
    it['ops.crews'] = partial(`${plural(assigned.length, 'task')} assigned`, `${tasks.length - assigned.length} scheduled tasks have nobody assigned in JobTread.`, 'JobTread schedule', 'watch');
  } else if (crews.length) {
    it['ops.crews'] = partial(`${plural(crews.length, 'crew')} on your roster`, `${crews.join(', ')}. JobTread tasks are not assigned to anyone, so which crew is on which job is not recorded.`, 'Your team roster', 'watch', fixRegister('people', 'Update roster'));
  } else {
    it['ops.crews'] = blind(`JobTread has one user (you) and ${tasks ? `none of its ${tasks.length} scheduled tasks are` : 'no tasks'} assigned to anyone. Add your team here, then assign tasks in JobTread.`, fixRegister('people', 'Add your team'));
  }

  // ---- production, logs ----
  const logs = jt && jt.logs ? jt.logs : null;
  const cutoff = isoDate(addDays(now, -gap));
  const reporting = active.filter((j) => j.lastLogDate && j.lastLogDate >= cutoff);
  it['ops.production'] = blind('No daily production (board feet sprayed, square feet framed, units installed) is recorded anywhere. A daily log with one number per crew would cover it.', { label: 'How to start', go: { ask: 'What is the simplest way for my crews to report daily production numbers so Jarvis can track them?' } });
  if (logs) {
    it['ops.daily_reporting'] = partial(
      `${reporting.length} of ${active.length} signed jobs reported in the last ${gap} days`,
      `${plural(logs.length, 'daily log')} in JobTread over the last 120 days${logs.length ? `, the latest on ${shortDate(logs.map((l) => l.date).sort().pop(), now)}` : ''}.`,
      'JobTread daily logs',
      active.length && reporting.length === 0 ? 'alert' : reporting.length < active.length ? 'watch' : 'good',
    );
  } else {
    it['ops.daily_reporting'] = blind('Daily logs could not be read.');
  }

  // ---- delays, conflicts, timelines ----
  if (tasks) {
    const jobsLate = [...new Set(overdue.map((t) => t.job).filter(Boolean))];
    it['ops.delays'] = live(overdue.length ? `${plural(overdue.length, 'task')} past ${overdue.length === 1 ? 'its' : 'their'} end date` : 'Nothing behind schedule', overdue.length ? `On ${jobsLate.slice(0, 4).join(', ')}. Latest: ${overdue.slice().sort((a, b) => b.daysLate - a.daysLate)[0].name}, ${overdue.slice().sort((a, b) => b.daysLate - a.daysLate)[0].daysLate} days late.` : 'Every scheduled task is done or not yet due.', 'JobTread schedule', overdue.length > 5 ? 'alert' : overdue.length ? 'watch' : 'good');
    // A conflict is the same assignee on two jobs on the same day.
    const clashes = [];
    for (let a = 0; a < assigned.length; a += 1) {
      for (let b = a + 1; b < assigned.length; b += 1) {
        const x = assigned[a];
        const y = assigned[b];
        if (x.jobId === y.jobId || x.done || y.done) continue;
        if (!x.startDate || !y.startDate) continue;
        const shared = x.assignees.filter((n) => y.assignees.includes(n));
        if (shared.length && x.startDate <= (y.endDate || y.startDate) && y.startDate <= (x.endDate || x.startDate)) clashes.push({ who: shared[0], a: x, b: y });
      }
    }
    it['ops.conflicts'] = assigned.length ? live(clashes.length ? `${plural(clashes.length, 'double booking')}` : 'No double bookings', clashes.length ? clashes.slice(0, 2).map((c) => `${c.who}: ${c.a.job} and ${c.b.job}`).join('; ') + '.' : 'Nobody is assigned to two jobs on the same day.', 'JobTread schedule', clashes.length ? 'watch' : 'good') : blind('Conflicts cannot be detected because no task has anyone assigned.', fixRegister('people', 'Add your team'));
    const withEnd = active.filter((j) => j.endDate);
    it['ops.timelines'] = withEnd.length ? partial(`${withEnd.length} of ${active.length} signed jobs have an end date`, withEnd.map((j) => `${j.name}: ${shortDate(j.endDate, now)}${j.endDate < today && (j.progress === null || j.progress < 1) ? ' (passed)' : ''}`).join('; ') + '.', 'JobTread schedule', withEnd.some((j) => j.endDate < today && (j.progress === null || j.progress < 1)) ? 'watch' : 'none') : blind('No signed job has a schedule with an end date.');
  } else {
    const b = blind(scope === 'sr' ? 'Seal Right has no schedule in any connected system.' : 'The JobTread schedule could not be read.');
    it['ops.delays'] = b;
    it['ops.conflicts'] = b;
    it['ops.timelines'] = b;
  }

  // ---- equipment, inventory, breakdowns, rework ----
  if (equipment.length) {
    const down = equipment.filter((e) => e.status === 'down');
    it['ops.equipment_avail'] = live(`${equipment.length - down.length} of ${equipment.length} available`, down.length ? `Down: ${down.map((e) => e.name).join(', ')}.` : 'Nothing is in the shop.', 'Your equipment list', down.length ? 'watch' : 'good', fixRegister('equipment', 'Update'));
  } else {
    it['ops.equipment_avail'] = blind('No equipment is on file.', fixRegister('equipment', 'Add equipment'));
  }
  if (inventory.length) {
    const low = inventory.filter((m) => toNum(m.onHand) !== null && toNum(m.reorderLevel) !== null && toNum(m.onHand) <= toNum(m.reorderLevel));
    it['ops.inventory'] = live(low.length ? `${plural(low.length, 'material')} at or below reorder level` : `${plural(inventory.length, 'material')} in stock`, low.length ? low.map((m) => `${m.name}: ${m.onHand} ${m.unit || ''}`).join('; ') + '.' : 'Everything is above its reorder level.', 'Your inventory count', low.length ? 'watch' : 'good', fixRegister('inventory', 'Update count'));
  } else {
    it['ops.inventory'] = blind('No material inventory is counted.', fixRegister('inventory', 'Count your stock'));
  }
  const since90 = isoDate(addDays(now, -90));
  const breakdowns = repairs.filter((r) => r.kind === 'breakdown' && r.date >= since90);
  it['ops.breakdowns'] = repairs.length ? live(`${plural(breakdowns.length, 'breakdown')} in 90 days`, breakdowns.length ? `${breakdowns.reduce((t, r) => t + (toNum(r.downtimeDays) || 0), 0)} days out of service, ${money(breakdowns.reduce((t, r) => t + (toNum(r.cost) || 0), 0))} in repairs.` : 'None logged.', 'Your repair log', breakdowns.some((r) => r.resolved === false) ? 'watch' : 'none', fixRegister('maintenance', 'Log one')) : blind('Breakdowns are not logged.', fixRegister('maintenance', 'Log a breakdown'));
  const openRework = issues.filter((i) => i.kind === 'deficiency' && i.status !== 'closed');
  it['ops.rework'] = issues.some((i) => i.kind === 'deficiency') ? live(`${plural(openRework.length, 'open deficiency', 'open deficiencies')}`, openRework.length ? openRework.slice(0, 3).map((i) => `${i.title}${i.job ? ` (${i.job})` : ''}`).join('; ') + '.' : 'All logged deficiencies are closed.', 'Your issues log', openRework.length ? 'watch' : 'good', fixRegister('issues', 'Log one')) : blind('Rework and deficiencies are not logged. JobTread has no convention for them either.', fixRegister('issues', 'Log a deficiency'));

  // ---- supervision ----
  const sups = people.filter((p) => /super|foreman|lead|manager/i.test(p.role || ''));
  const cal = model.cal;
  const visits = cal ? cal.events.filter((e) => /site|walk|inspect|visit|meet/i.test(e.title)) : [];
  it['ops.supervision'] = sups.length ? partial(`${plural(sups.length, 'supervisor or lead')} on the roster`, `${sups.map((p) => p.name).join(', ')}.${cal ? ` ${plural(visits.length, 'site visit or meeting')} on your calendar in the next two weeks.` : ''} Which jobs each supervises is not recorded.`, 'Your team roster', 'none') : blind(`Nobody is recorded as supervising any site${cal && visits.length ? `, though your calendar shows ${plural(visits.length, 'site visit or meeting')} in the next two weeks` : ''}.`, fixRegister('people', 'Add supervisors'));

  const items = finalizeItems('ops', it);

  // ---- minions ----
  const minions = [...itemMinions('ops', items)];
  for (const j of active) {
    const late = overdue.filter((t) => t.jobId === j.id);
    const logAge = j.lastLogDate ? daysBetween(j.lastLogDate, now) : null;
    minions.push(minion(`ops.log:${j.id}`, 'ops', 'Daily log watcher', j.name, logAge === null ? 'blind' : logAge > gap * 3 ? 'alert' : logAge > gap ? 'watch' : 'clear', logAge === null ? 'No daily log in the last 120 days.' : `Last daily log ${logAge} day${logAge === 1 ? '' : 's'} ago.`, { weight: 35 }));
    minions.push(minion(`ops.sched:${j.id}`, 'ops', 'Schedule watcher', j.name, !j.endDate ? 'blind' : late.length > 3 ? 'alert' : late.length ? 'watch' : 'clear', !j.endDate ? 'No schedule in JobTread.' : late.length ? `${plural(late.length, 'task')} past due; planned finish ${shortDate(j.endDate, now)}.` : `On schedule; planned finish ${shortDate(j.endDate, now)}.`, { weight: 45 + late.length }));
    minions.push(minion(`ops.crew:${j.id}`, 'ops', 'Crew assignment checker', j.name, (tasks || []).some((t) => t.jobId === j.id && t.assignees.length) ? 'clear' : 'blind', (tasks || []).some((t) => t.jobId === j.id && t.assignees.length) ? 'Tasks have people assigned.' : 'Nobody is assigned to any task on this job.', { weight: 18 }));
  }
  for (const t of overdue.slice().sort((a, b) => b.daysLate - a.daysLate).slice(0, 60)) {
    minions.push(minion(`ops.task:${t.id}`, 'ops', 'Late task chaser', `${t.name} · ${t.job || t.customer}`, t.daysLate > 14 ? 'alert' : 'watch', `Was due ${shortDate(t.endDate, now)}, ${t.daysLate} days ago${t.progress ? `; ${pct(t.progress)} done` : ''}.`, { weight: Math.min(70, 30 + t.daysLate) }));
  }
  for (const t of upcoming.slice(0, 40)) minions.push(minion(`ops.next:${t.id}`, 'ops', 'Two-week lookahead', `${t.name} · ${t.job || t.customer}`, 'clear', `Starts ${shortDate(t.startDate, now)}${t.assignees.length ? `, ${t.assignees.join(', ')}` : ', nobody assigned'}.`, { weight: 6 }));
  for (const e of equipment.filter((x) => x.status === 'down')) minions.push(minion(`ops.down:${e.id}`, 'ops', 'Downtime tracker', e.name, 'watch', 'Marked down / in the shop.', { weight: 40, action: fixRegister('equipment', 'Update status') }));

  const headline = [
    { label: 'Tasks behind schedule', value: tasks ? String(overdue.length) : null, blind: !tasks, hint: tasks ? `${upcoming.length} starting in 2 weeks` : '', health: overdue.length > 5 ? 'alert' : overdue.length ? 'watch' : 'good', go: { sheet: 'ops' } },
  ];
  return { items, headline, minions, data: { active, tasks, overdue, upcoming, logs, gap, calendar: cal, people, equipment, loaded: !!(jt && jt.loaded.jobs), users: jt ? jt.users : null } };
}

export default { key: 'ops', compute };
