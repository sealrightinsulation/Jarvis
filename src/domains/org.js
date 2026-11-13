// A-11 Structure and leadership: who decides what, so the company does not depend on the owner
// being present. Entirely from the roles list.

import { live, partial, blind, fixRegister, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, plural, toNum } from '../app/format.js';
import { inScope } from '../registers/schemas.js';

export const DUTIES = [
  ['overtime', 'org.overtime', 'Approves overtime'],
  ['purchasing', 'org.purchases', 'Approves purchases'],
  ['crews', 'org.crews', 'Manages crews'],
  ['customer_issues', 'org.customer_issues', 'Handles customer issues'],
  ['scheduling', 'org.scheduling', 'Handles scheduling'],
  ['payroll', 'org.payroll', 'Handles payroll'],
  ['quality', 'org.quality', 'Quality control'],
];

export function compute(ctx) {
  const { registers, scope } = ctx;
  const roles = (registers.roles || []).filter((r) => inScope(r, scope));
  const people = registers.people || [];
  const nameOf = (id) => (people.find((p) => p.id === id) || {}).name || '';
  const view = roles.map((r) => ({ ...r, holderLabel: nameOf(r.holder) || r.holderName || '', backupLabel: nameOf(r.backup), parent: (roles.find((x) => x.id === r.reportsTo) || {}).title || '', dutyList: Array.isArray(r.duties) ? r.duties : [] }));
  const it = {};
  const none = (what) => blind(`No roles are defined.${what ? ` ${what}` : ' Until they are, every decision defaults to you.'}`, fixRegister('roles', 'Define a role'));
  const ownerOnly = (v) => /owner|jake/i.test(`${v.title} ${v.holderLabel}`);

  const filled = view.filter((r) => r.holderLabel);
  it['org.chart'] = view.length ? (filled.length === view.length ? live : partial)(`${plural(view.length, 'role')}, ${filled.length} filled`, view.filter((r) => !r.holderLabel).length ? `Open seats: ${view.filter((r) => !r.holderLabel).map((r) => r.title).join(', ')}.` : 'Every role has a name against it.', 'Your roles list', view.some((r) => !r.holderLabel) ? 'watch' : 'good', fixRegister('roles', 'Update')) : none('JobTread lists one user, you, so on paper every job in the company is yours.');
  const described = view.filter((r) => r.responsibilities);
  it['org.responsibilities'] = view.length ? (described.length === view.length ? live : partial)(`Written for ${described.length} of ${view.length} roles`, described.length < view.length ? `Missing: ${view.filter((r) => !r.responsibilities).map((r) => r.title).join(', ')}.` : 'Every role has its responsibilities written down.', 'Your roles list', described.length < view.length ? 'watch' : 'good', fixRegister('roles', 'Update')) : none('');
  const linked = view.filter((r) => r.parent);
  it['org.reporting'] = view.length ? (view.length > 1 && linked.length >= view.length - 1 ? live : partial)(`${linked.length} of ${view.length} roles have a reporting line`, view.length > 1 && linked.length < view.length - 1 ? `No line set for: ${view.filter((r) => !r.parent).map((r) => r.title).join(', ')}.` : 'Reporting lines are set.', 'Your roles list', 'none', fixRegister('roles', 'Update')) : none('');
  const empowered = view.filter((r) => r.decisions || toNum(r.spendLimit) !== null);
  it['org.authority'] = view.length ? (empowered.length ? live : partial)(`${plural(empowered.length, 'role')} with stated authority`, empowered.length ? empowered.map((r) => `${r.title}${toNum(r.spendLimit) !== null ? ` (spend to ${money(r.spendLimit)})` : ''}`).join('; ') + '.' : 'No role has decisions or a spending limit written down, so every decision still comes to you.', 'Your roles list', empowered.length ? 'good' : 'watch', fixRegister('roles', 'Update')) : none('');

  for (const [duty, id, label] of DUTIES) {
    const owners = view.filter((r) => r.dutyList.includes(duty) || (duty === 'overtime' && r.approvesOvertime));
    if (!view.length) it[id] = none('');
    else if (!owners.length) it[id] = blind(`No role is marked as "${label.toLowerCase()}". Until one is, it defaults to you.`, fixRegister('roles', 'Assign it'));
    else {
      const named = owners.filter((r) => r.holderLabel);
      const justOwner = owners.every(ownerOnly);
      it[id] = live(named.length ? named.map((r) => `${r.holderLabel} (${r.title})`).join(', ') : `${owners.map((r) => r.title).join(', ')} (seat open)`, justOwner ? 'This still sits with you.' : owners.some((r) => r.backupLabel) ? `Backup: ${owners.filter((r) => r.backupLabel).map((r) => r.backupLabel).join(', ')}.` : 'No backup named.', 'Your roles list', !named.length ? 'watch' : justOwner ? 'watch' : 'good', fixRegister('roles', 'Update'));
    }
  }
  const backed = view.filter((r) => r.backupLabel);
  it['org.succession'] = view.length ? (backed.length === view.length ? live : partial)(`${backed.length} of ${view.length} roles have a backup`, backed.length < view.length ? `No backup for: ${view.filter((r) => !r.backupLabel).map((r) => r.title).join(', ')}.` : 'Every role has a named backup.', 'Your roles list', backed.length < view.length ? 'watch' : 'good', fixRegister('roles', 'Name backups')) : none('');

  const items = finalizeItems('org', it);
  const minions = [...itemMinions('org', items)];
  for (const r of view) {
    minions.push(minion(`org.seat:${r.id}`, 'org', 'Seat checker', r.title, r.holderLabel ? 'clear' : 'watch', r.holderLabel ? `Held by ${r.holderLabel}.` : 'Nobody holds this role.', { weight: 30, action: fixRegister('roles', 'Fill it') }));
    minions.push(minion(`org.backup:${r.id}`, 'org', 'Succession checker', r.title, r.backupLabel ? 'clear' : 'blind', r.backupLabel ? `Backup: ${r.backupLabel}.` : 'No backup or successor named.', { weight: 16, action: fixRegister('roles', 'Name a backup') }));
  }
  const ownerDuties = DUTIES.filter(([duty]) => {
    const owners = view.filter((r) => r.dutyList.includes(duty) || (duty === 'overtime' && r.approvesOvertime));
    return !owners.length || owners.every(ownerOnly);
  }).length;
  const headline = [{ label: 'Duties that depend on you', value: `${ownerDuties} of ${DUTIES.length}`, hint: view.length ? `${plural(view.length, 'role')} defined` : 'no roles defined yet', health: ownerDuties > 4 ? 'watch' : 'good', go: { sheet: 'org' } }];
  return { items, headline, minions, data: { roles: view, ownerDuties } };
}

export default { key: 'org', compute };
