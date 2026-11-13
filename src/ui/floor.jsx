// The minion floor: 1,200 seats laid out by division like bays on a shop floor. A filled seat
// is one real watch with one finding; an empty seat is capacity with nothing to watch yet.

import { useState, useMemo } from 'preact/hooks';
import { DOMAINS, DOMAIN_BY_KEY } from '../catalog/catalog.js';
import { Panel, Button, Drawer, Findings, Seg, Pill, StatusIcon, KV } from './kit.jsx';
import { plural } from '../app/format.js';

const ORDER = { alert: 0, watch: 1, blind: 2, clear: 3 };
const WORD = { alert: 'needs action', watch: 'watching', blind: 'cannot see', clear: 'all clear' };

export function FleetSummary({ fleet }) {
  if (!fleet) return null;
  const t = fleet.totals;
  return (
    <div class="row" style={{ gap: 'var(--sp-2) var(--sp-4)', fontSize: 'var(--t-sm)' }}>
      <span><strong class="tnum">{fleet.seatedCount.toLocaleString('en-CA')}</strong> of {fleet.size.toLocaleString('en-CA')} posted</span>
      <span class="row" style={{ gap: '6px' }}><StatusIcon status="alert" size={12} /> {t.alert} need action</span>
      <span class="row" style={{ gap: '6px' }}><StatusIcon status="watch" size={12} /> {t.watch} watching</span>
      <span class="row" style={{ gap: '6px' }}><StatusIcon status="blind" size={12} /> {t.blind} cannot see</span>
      <span class="row" style={{ gap: '6px' }}><StatusIcon status="good" size={12} /> {t.clear} clear</span>
      <span class="muted">{fleet.idle.toLocaleString('en-CA')} standing by{fleet.waiting ? ` · ${fleet.waiting} waiting for a seat` : ''}</span>
    </div>
  );
}

export function Floor({ fleet, actions }) {
  const bays = useMemo(() => {
    if (!fleet) return [];
    return DOMAINS.map((d) => ({ d, seats: (fleet.byDivision[d.key] || []).slice().sort((a, b) => ORDER[a.status] - ORDER[b.status]) }));
  }, [fleet]);
  if (!fleet) return null;
  return (
    <Panel
      title="The minion floor"
      note="Every filled seat is one watch on one thing. Select a seat to see what it found."
      actions={<Button small icon="floor" onClick={() => actions.openFleet({})}>Open the roster</Button>}
    >
      <FleetSummary fleet={fleet} />
      <div class="floor">
        {bays.map(({ d, seats }) => (
          <div class="bay" key={d.key}>
            <div class="bay__label">
              {d.sheet}
              <strong>{d.title}</strong>
              {plural(seats.length, 'minion')}
            </div>
            <div class="seats">
              {seats.map((m) => (
                <button type="button" key={m.id} class={`seat seat--${m.status}`} aria-label={`${m.role}, ${m.target}: ${WORD[m.status]}`} title={`${m.role} · ${m.target}`} onClick={() => actions.openMinion(m)} />
              ))}
              {seats.length === 0 && <span class="muted" style={{ fontSize: 'var(--t-xs)' }}>Nobody posted here yet.</span>}
            </div>
          </div>
        ))}
        <div class="bay">
          <div class="bay__label">
            Bench
            <strong>Standing by</strong>
            {fleet.idle.toLocaleString('en-CA')} seats
          </div>
          <div class="seats" aria-hidden="true">
            {Array.from({ length: Math.min(fleet.idle, 1200) }, (_, i) => (
              <span key={i} class="seat seat--idle" />
            ))}
          </div>
        </div>
      </div>
      <p class="muted" style={{ fontSize: 'var(--t-xs)', maxWidth: '85ch' }}>
        Minions are rule-based watches that re-run every time Jarvis reads your systems. They do not guess: a watch with nothing to look at reports that it cannot see. Seats fill as your records grow (each invoice, quote, job, bill, person, truck, policy and supplier gets its own). The bench is real spare capacity, not hidden work.
      </p>
    </Panel>
  );
}

/** Drawer: one minion. */
export function MinionDrawer({ minion, actions, onClose }) {
  const d = DOMAIN_BY_KEY[minion.division];
  return (
    <Drawer title="Minion report" onClose={onClose}>
      <div class="row"><Pill status={minion.status === 'clear' ? 'good' : minion.status}>{WORD[minion.status]}</Pill><span class="mono muted">{d ? `${d.sheet} ${d.title}` : ''}</span></div>
      <KV rows={[['Role', minion.role], ['Watching', minion.target]]} />
      <p style={{ maxWidth: '60ch' }}>{minion.finding}</p>
      <div class="row">
        {minion.action && <Button kind="primary" onClick={() => { onClose(); actions.go(minion.action.go); }}>{minion.action.label}</Button>}
        {d && <Button onClick={() => { onClose(); actions.go({ sheet: minion.division }); }}>Open {d.title}</Button>}
        <Button icon="ask" onClick={() => actions.ask(`One of your watches reports this about "${minion.target}": ${minion.finding} What does it mean for me and what should I do?`)}>Ask Jarvis</Button>
      </div>
    </Drawer>
  );
}

/** Drawer: the whole roster with filters. */
export function FleetDrawer({ fleet, initial, actions, onClose }) {
  const [status, setStatus] = useState((initial && initial.status) || 'attention');
  const [division, setDivision] = useState((initial && initial.division) || 'all');
  const list = useMemo(() => {
    if (!fleet) return [];
    return fleet.seated.filter((m) => (division === 'all' || m.division === division) && (status === 'all' || (status === 'attention' ? m.status === 'alert' || m.status === 'watch' : m.status === status)));
  }, [fleet, status, division]);
  return (
    <Drawer title="Minion roster" onClose={onClose} wide>
      <FleetSummary fleet={fleet} />
      <div class="row">
        <Seg label="Status" value={status} onChange={setStatus} options={[{ value: 'attention', label: 'Needs you' }, { value: 'blind', label: 'Cannot see' }, { value: 'clear', label: 'Clear' }, { value: 'all', label: 'All' }]} />
        <div class="field" style={{ minWidth: '12rem' }}>
          <label for="fleet-division" class="sr-only">Sheet</label>
          <select id="fleet-division" class="input" value={division} onChange={(e) => setDivision(e.currentTarget.value)}>
            <option value="all">Every sheet</option>
            {DOMAINS.map((d) => (
              <option key={d.key} value={d.key}>{d.sheet} {d.title}</option>
            ))}
          </select>
        </div>
        <span class="muted">{list.length} shown</span>
      </div>
      <div class="panel">
        <Findings
          findings={list.slice(0, 200).map((m) => ({ id: m.id, status: m.status, title: m.target, detail: m.finding, who: `${m.role} · ${(DOMAIN_BY_KEY[m.division] || {}).title || ''}`, action: m.action }))}
          onAction={(f) => { onClose(); actions.go(f.action.go); }}
          empty={<div class="panel__bd"><span class="muted">No minions match.</span></div>}
        />
      </div>
      {list.length > 200 && <span class="muted">Showing the first 200. Narrow by sheet to see the rest.</span>}
    </Drawer>
  );
}
