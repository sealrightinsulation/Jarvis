// A-00 Command: the briefing, the vital numbers, what needs the owner, what Jarvis is connected
// to, what it cannot see yet, and the minion floor.

import { useState, useEffect } from 'preact/hooks';
import { DOMAINS, DOMAIN_BY_KEY } from '../catalog/catalog.js';
import { TitleBlock, Panel, Tiles, Tile, Findings, Button, Banner, Meter, StatusIcon, Pill, Empty } from './kit.jsx';
import { Floor } from './floor.jsx';
import { ago, pct, plural } from '../app/format.js';
import { CONNECTOR_LABEL } from '../platform/manifest.js';
import { speak, stopSpeaking, canSpeak, onSpeakState } from '../platform/voice.js';
import { connectorHealth } from '../sources/loader.js';

const CONNECTOR_NOTE = { qbo: 'Revenue, invoices, estimates, HST and the bank feed for both companies', jt: 'Jobs, budgets, proposals, supplier bills and the schedule for Advanced Builds', gcal: 'Site visits and meetings for the next two weeks' };

function Connections({ state, actions }) {
  const health = connectorHealth(state.sources);
  const absent = state.boot.mcp === 'absent';
  return (
    <Panel title="What Jarvis is plugged into" note={state.lastRefresh ? `Last read ${ago(state.lastRefresh, state.now)}` : undefined} actions={<Button small icon="refresh" onClick={() => actions.refresh(true)} disabled={state.loading || absent}>{state.loading ? 'Reading…' : 'Read again'}</Button>}>
      {absent && <Banner kind="warn">Live connections are not available in this view. Open Jarvis from claude.ai in a browser or the Claude desktop app, signed in as the owner. Your own records below still work.</Banner>}
      <ul class="stack" style={{ gap: '10px' }}>
        {Object.keys(CONNECTOR_LABEL).map((k) => {
          const h = health[k];
          const st = absent ? 'blind' : !h ? (state.boot.mcp === 'pending' ? 'blind' : 'blind') : h.state === 'ok' ? 'good' : h.state === 'loading' ? 'info' : h.state === 'partial' ? 'watch' : 'alert';
          const failing = Object.values(state.sources).filter((s) => s.spec && s.spec.connector === k && s.status === 'error');
          return (
            <li key={k} class="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span style={{ paddingTop: '3px' }}><StatusIcon status={st} /></span>
              <div class="grow stack" style={{ gap: '2px' }}>
                <span><strong>{CONNECTOR_LABEL[k]}</strong> <span class="muted">{CONNECTOR_NOTE[k]}</span></span>
                <span style={{ fontSize: 'var(--t-sm)' }} class="muted">
                  {absent ? 'Not reachable from this view.' : !h ? (state.loading || state.boot.mcp === 'pending' ? 'Waiting to be read…' : 'Not read yet.') : h.state === 'loading' ? `Reading… ${h.ok} of ${h.ok + h.loading + h.error} done.` : h.state === 'ok' ? `${plural(h.ok, 'read')} succeeded.` : `${h.ok} reads succeeded, ${h.error} failed. ${h.firstError ? `${h.firstError.text} ${h.firstError.fix}` : ''}`}
                </span>
                {failing.length > 0 && (
                  <details class="more">
                    <summary>{plural(failing.length, 'read')} that did not come back</summary>
                    <ul class="stack" style={{ gap: '2px', fontSize: 'var(--t-xs)' }}>
                      {failing.slice(0, 12).map((s) => (
                        <li key={s.spec.key}>{s.spec.label}: {s.error.text} <span class="mono muted">{s.error.code}</span></li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {!absent && h && (h.state === 'down' || h.state === 'partial') && h.firstError && ['consent', 'reconnect', 'missing', 'choose'].includes(h.firstError.kind) && <Button small onClick={() => actions.connect()}>Connect</Button>}
            </li>
          );
        })}
      </ul>
      <p class="muted" style={{ fontSize: 'var(--t-xs)', maxWidth: '85ch' }}>Jarvis only reads. It cannot create, change, send or delete anything in QuickBooks, JobTread or your calendar. Payroll and loans are not readable for Canadian QuickBooks companies, and Gmail is not connected to this page.</p>
    </Panel>
  );
}

function Coverage({ state, actions }) {
  const cov = state.coverage;
  if (!cov) return null;
  const blind = DOMAINS.flatMap((d) => (state.results[d.key] ? state.results[d.key].items : [])).filter((i) => i.coverage === 'blind' && i.fix);
  // The entries that unlock the most: group blind items by the fix they share.
  const groups = new Map();
  for (const it of blind) {
    const key = JSON.stringify(it.fix.go || {});
    const g = groups.get(key) || { fix: it.fix, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.items.length - a.items.length).slice(0, 6);
  return (
    <Panel title="What Jarvis can and cannot see" note={`${cov.overall.live} live · ${cov.overall.partial} partial · ${cov.overall.blind} not visible, of the ${cov.overall.total} things you listed`}>
      <div class="grid grid--2">
        <div class="stack" style={{ gap: '8px' }}>
          {DOMAINS.map((d) => {
            const c = cov.byDomain[d.key];
            return (
              <button type="button" key={d.key} class="btn btn--ghost" style={{ display: 'grid', gridTemplateColumns: '3.2rem minmax(0, 11rem) minmax(0, 1fr) 3rem', gap: '10px', justifyContent: 'stretch', textAlign: 'left', padding: '2px 6px' }} onClick={() => actions.go({ sheet: d.key })}>
                <span class="mono muted">{d.sheet}</span>
                <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
                <Meter value={c.score} max={1} label={`${d.title} coverage`} />
                <span class="tnum muted" style={{ textAlign: 'right' }}>{pct(c.score)}</span>
              </button>
            );
          })}
        </div>
        <div class="stack">
          <strong>The entries that would open the most blind spots</strong>
          {top.length ? (
            <ul class="stack" style={{ gap: '8px' }}>
              {top.map((g) => (
                <li key={JSON.stringify(g.fix.go)} class="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span class="grow" style={{ fontSize: 'var(--t-sm)' }}>
                    <strong>{g.fix.label}</strong> <span class="muted">opens {plural(g.items.length, 'item')}:</span> {g.items.slice(0, 3).map((i) => i.label).join('; ')}{g.items.length > 3 ? '…' : ''}
                  </span>
                  <Button small onClick={() => actions.go(g.fix.go)}>Do it</Button>
                </li>
              ))}
            </ul>
          ) : (
            <span class="muted">Nothing left to fill in.</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function CommandSheet({ state, actions, briefing }) {
  const [speaking, setSpeaking] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  useEffect(() => onSpeakState((s) => setSpeaking(s !== 'idle')), []);
  const fleet = state.fleet;
  const tiles = ['csh', 'fin', 'job', 'sal', 'ops', 'cus'].flatMap((k) => (state.results[k] ? state.results[k].headline.map((h) => ({ ...h, key: `${k}${h.label}` })) : []));
  const attention = fleet ? fleet.attention.filter((m) => m.role !== 'Checklist keeper') : [];
  const scopeLabel = state.scope === 'all' ? 'Both companies' : state.scope === 'ab' ? 'Advanced Builds' : 'Seal Right';
  return (
    <>
      <TitleBlock no="A-00" title="Command" lede="What needs you, what is safe, and what Jarvis still cannot see." meta={[['Scope', scopeLabel], ['Read', state.model && state.model.loadedAt ? ago(state.model.loadedAt, state.now) : state.loading ? 'loading' : 'not yet'], ['Minions', fleet ? `${fleet.seatedCount} posted` : '—'], ['Sees', state.coverage ? pct(state.coverage.overall.score) : '—']]} />
      <section class="brief" aria-label="Briefing">
        <p class="brief__say">{briefing.headline}</p>
        {briefing.points.length > 0 && (
          <ul class="brief__points">
            {briefing.points.map((p) => (
              <li key={p.text}>
                <StatusIcon status={p.status === 'info' ? 'info' : p.status} />
                <span>{p.text} {p.go && <button type="button" class="btn btn--ghost btn--sm" onClick={() => actions.go(p.go)}>Open</button>}</span>
              </li>
            ))}
          </ul>
        )}
        <div class="row">
          <Button kind="primary" icon="ask" onClick={() => actions.ask()}>Ask Jarvis</Button>
          {canSpeak() && (speaking ? <Button icon="stop" onClick={() => stopSpeaking()}>Stop</Button> : <Button icon="speaker" onClick={async () => { setVoiceNote(''); const r = await speak(briefing.spoken); if (!r.ok && r.code !== 'stopped') setVoiceNote(r.hide ? 'Reading aloud is switched off for this page.' : 'Could not read the briefing aloud just now.'); }}>Read it to me</Button>)}
          <Button icon="calendar" onClick={() => actions.go({ sheet: 'wkr' })}>Weekly review</Button>
          {voiceNote && <span class="muted">{voiceNote}</span>}
        </div>
      </section>
      <Tiles>
        {tiles.slice(0, 10).map((t) => (
          <Tile key={t.key} label={t.label} value={t.value} hint={t.hint} blind={t.blind} status={t.health} onClick={t.go ? () => actions.go(t.go) : undefined} />
        ))}
        {tiles.length === 0 && <Tile label="Live numbers" blind hint={state.loading ? 'reading your systems' : 'nothing read yet'} />}
      </Tiles>
      <div class="grid grid--side">
        <Panel title="Needs you" note={attention.length ? `${attention.filter((m) => m.status === 'alert').length} to act on · ${attention.filter((m) => m.status === 'watch').length} to watch` : undefined} flush actions={<Button small kind="ghost" icon="floor" onClick={() => actions.openFleet({ status: 'attention' })}>See all</Button>}>
          <Findings
            findings={attention.map((m) => ({ id: m.id, status: m.status, title: m.target, detail: m.finding, who: `${m.role} · ${(DOMAIN_BY_KEY[m.division] || {}).title || ''}`, action: m.action || { label: 'Open sheet', go: { sheet: m.division } } }))}
            onAction={(f) => actions.go(f.action.go)}
            limit={10}
            empty={<div class="panel__bd">{state.loading ? <span class="muted">Reading your systems…</span> : <Empty title="Nothing flagged">Either all is well, or nothing has been read yet. Check the connections beside this.</Empty>}</div>}
          />
        </Panel>
        <Connections state={state} actions={actions} />
      </div>
      <Coverage state={state} actions={actions} />
      <Floor fleet={fleet} actions={actions} />
    </>
  );
}
