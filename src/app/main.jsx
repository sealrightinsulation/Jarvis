// Jarvis: boot, load, compute, render.

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { DOMAINS, DOMAIN_BY_KEY } from '../catalog/catalog.js';
import { REGISTERS, settingsDefaults } from '../registers/schemas.js';
import { getState, setState, subscribe, toast, openDrawer, closeDrawer } from './store.js';
import { isoDate, ago } from './format.js';
import { buildBriefing } from './briefing.js';
import { cap, requestPermissions } from '../platform/claude.js';
import { permissionNames } from '../platform/manifest.js';
import { invalidate } from '../platform/mcp.js';
import { watchCollection, putDoc, removeDoc, getDoc, newId, explainDbError } from '../platform/db.js';
import { aiLimits } from '../platform/ai.js';
import { preloadVoice } from '../platform/voice.js';
import { loadAll } from '../sources/loader.js';
import { baseSpecs, expandSpecs, assertReadOnly } from '../sources/specs.js';
import { buildModel } from '../model/build.js';
import { computeAll } from '../domains/index.js';
import { snapshotOf } from '../domains/wkr.js';
import { jobView } from '../domains/job.js';
import { Button, Seg, Icon, Drawer } from '../ui/kit.jsx';
import { CommandSheet } from '../ui/command.jsx';
import { FinSheet, CshSheet, JobSheet, SalSheet, OpsSheet, CusSheet, JobDetail } from '../ui/sheets-a.jsx';
import { PplSheet, EqpSheet, LglSheet, PurSheet, OrgSheet, StrSheet, WkrSheet } from '../ui/sheets-b.jsx';
import { RegisterForm, SettingsForm } from '../registers/ui.jsx';
import { MinionDrawer, FleetDrawer } from '../ui/floor.jsx';
import { AskDrawer } from '../chat/ask.jsx';

const VERSION = '1.0.0';
const SHEETS = { fin: FinSheet, csh: CshSheet, job: JobSheet, sal: SalSheet, ops: OpsSheet, cus: CusSheet, ppl: PplSheet, eqp: EqpSheet, lgl: LglSheet, pur: PurSheet, org: OrgSheet, str: StrSheet, wkr: WkrSheet };
const SHEET_KEYS = new Set(['command', ...Object.keys(SHEETS)]);
const REFRESH_EVERY = 15 * 60 * 1000;

// ---------------------------------------------------------------- compute

let recomputeTimer = null;
function recompute(immediate) {
  clearTimeout(recomputeTimer);
  const run = () => {
    const s = getState();
    const nowDate = new Date(s.now);
    const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const model = buildModel(s.sources, today);
    const defaults = settingsDefaults();
    const ctx = { now: today, today: isoDate(today), scope: s.scope, model, registers: s.registers, settings: { main: { ...defaults, ...s.settings.main }, strategy: { ...defaults, ...s.settings.strategy }, profile: s.settings.profile || {} } };
    const out = computeAll(ctx);
    setState({ model, results: out.results, fleet: out.fleet, coverage: out.coverage });
  };
  if (immediate) run();
  else recomputeTimer = setTimeout(run, 120);
}

// ---------------------------------------------------------------- live data

let loadSeq = 0;
async function refresh(force = false) {
  const s0 = getState();
  if (s0.boot.mcp !== 'ready' || s0.loading) return;
  const seq = (loadSeq += 1);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  setState({ loading: true, now: now.getTime() });
  if (force) await invalidate();
  let specs;
  try {
    specs = baseSpecs(today).map(assertReadOnly);
  } catch (e) {
    console.error(e);
    setState({ loading: false });
    return;
  }
  await loadAll({
    specs,
    expand: (done) => expandSpecs(done, today).map(assertReadOnly),
    force,
    onUpdate: (key, st) => {
      if (seq !== loadSeq) return;
      const prev = getState().sources[key];
      // Keep the last good answer on screen while a re-read is in flight or fails transiently.
      const keep = prev && prev.status === 'ok' && (st.status === 'loading' || (st.status === 'error' && st.error && st.error.retryable));
      setState((s) => ({ sources: { ...s.sources, [key]: keep ? { ...prev, refreshing: st.status === 'loading' } : st } }));
      if (st.status !== 'loading') recompute(false);
    },
  });
  if (seq !== loadSeq) return;
  setState({ loading: false, lastRefresh: Date.now(), now: Date.now() });
  recompute(true);
  recordRun();
}

/** After each read: leave a small trace so problems can be diagnosed, and one snapshot a day. */
let lastTrace = 0;
async function recordRun() {
  const s = getState();
  if (!s.boot.canEdit || s.boot.db !== 'ready') return;
  if (Date.now() - lastTrace < 30 * 60 * 1000) return;
  if (!Object.values(s.sources).some((x) => x.status === 'ok')) return;
  lastTrace = Date.now();
  const sources = {};
  for (const [k, st] of Object.entries(s.sources)) {
    const p = st.payload;
    const rows = p && Array.isArray(p.items) ? p.items.length : p && Array.isArray(p.rows) ? p.rows.length : p && p.data ? Object.values(p.data).filter(Array.isArray).reduce((t, a) => t + a.length, 0) : null;
    sources[k.replace(/\./g, '_')] = st.status === 'ok' ? { ok: true, rows } : { ok: false, code: (st.error && st.error.code) || 'unknown' };
  }
  await putDoc('diagnostics', 'latest', { at: new Date().toISOString(), version: VERSION, scope: s.scope, sources, coverage: s.coverage ? s.coverage.overall : null, fleet: s.fleet ? { seated: s.fleet.seatedCount, ...s.fleet.totals } : null });
  if (s.scope === 'all' && s.results.fin) {
    const day = isoDate(new Date());
    const have = await getDoc('snapshots', day);
    if (!have) await putDoc('snapshots', day, { ...snapshotOf(s.results), alerts: s.fleet ? s.fleet.totals.alert : null, coverage: s.coverage ? s.coverage.overall.score : null });
  }
}

// ---------------------------------------------------------------- actions

const dbFail = (res) => ({ ok: false, message: explainDbError(res.code) });

const actions = {
  refresh,
  async connect() {
    await requestPermissions(permissionNames());
    refresh(true);
  },
  go(target) {
    if (!target) return;
    if (target.ask) return actions.ask(target.ask);
    if (target.register) return actions.openRegister(target.register, {});
    if (target.settings) return actions.openSettings(target.settings, target.field);
    if (target.sheet) {
      const sheet = SHEET_KEYS.has(target.sheet) ? target.sheet : 'command';
      closeDrawer();
      setSheet(sheet);
      if (target.job) openDrawer({ type: 'job', id: target.job });
      else if (target.anchor) setTimeout(() => { const el = document.getElementById(target.anchor); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }, 60);
      else window.scrollTo(0, 0);
    }
  },
  ask(seed) {
    openDrawer({ type: 'ask', seed: seed || null, n: Date.now() });
  },
  openRegister(regKey, opts) {
    openDrawer({ type: 'register', regKey, id: (opts && opts.id) || null, preset: (opts && opts.preset) || null });
  },
  openSettings(docId, field) {
    openDrawer({ type: 'settings', docId: docId || 'main', field: field || null });
  },
  openMinion(m) {
    openDrawer({ type: 'minion', minion: m });
  },
  openFleet(filter) {
    openDrawer({ type: 'fleet', filter: filter || {} });
  },
  async saveRecord(regKey, id, data) {
    const res = await putDoc(regKey, id || newId(regKey.slice(0, 3)), data);
    if (!res.ok) return dbFail(res);
    toast('Saved');
    return { ok: true };
  },
  async deleteRecord(regKey, id) {
    const res = await removeDoc(regKey, id);
    if (!res.ok) return dbFail(res);
    toast('Deleted');
    return { ok: true };
  },
  async saveSettings(docId, data) {
    const res = await putDoc('settings', docId, data);
    if (!res.ok) return dbFail(res);
    toast('Saved');
    return { ok: true };
  },
  async saveWeekly(weekId, data) {
    const res = await putDoc('weekly', weekId, data);
    if (!res.ok) toast(explainDbError(res.code), 5000);
    return res;
  },
  async closeDecision(weekId, decisionId) {
    const doc = (getState().registers.weekly || []).find((r) => r.id === weekId);
    if (!doc) return;
    const { id: _id, ...rest } = doc;
    const res = await putDoc('weekly', weekId, { ...rest, decisions: (rest.decisions || []).map((d) => (d.id === decisionId ? { ...d, done: true } : d)) });
    if (!res.ok) toast(explainDbError(res.code), 5000);
  },
  snapshot() {
    return snapshotOf(getState().results);
  },
};

function setSheet(sheet) {
  setState({ sheet });
  try {
    const want = sheet === 'command' ? '' : `#${sheet}`;
    if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
  } catch {
    /* hash routing is a convenience */
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  const fromHash = () => {
    const h = (location.hash || '').replace('#', '');
    if (SHEET_KEYS.has(h)) setState({ sheet: h });
    else if (!h) setState({ sheet: 'command' });
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  subscribe(() => {}); // keep the store warm before first paint
  recompute(true);

  preloadVoice().then((v) => setState((s) => ({ boot: { ...s.boot, speak: v.speak, listen: v.listen } })));
  aiLimits().then((l) => setState((s) => ({ boot: { ...s.boot, ai: l.available, aiTools: l.tools } })));

  // Who is looking: only the owner and editors can save.
  cap('user').then(async (user) => {
    if (!user) return;
    const [isOwner, canEdit] = await Promise.all([user.isOwner(), user.canEdit()]);
    setState((s) => ({ boot: { ...s.boot, isOwner, canEdit: isOwner || canEdit } }));
  });

  // Jarvis's own records.
  const db = await cap('db');
  if (!db) {
    setState((s) => ({ boot: { ...s.boot, db: 'absent', canEdit: false }, registersReady: true }));
  } else {
    setState((s) => ({ boot: { ...s.boot, db: 'ready' } }));
    const pending = new Set([...REGISTERS.map((r) => r.key), 'settings']);
    const settle = (name) => {
      pending.delete(name);
      if (!pending.size && !getState().registersReady) setState({ registersReady: true });
    };
    // If storage does not answer in ten seconds, stop showing "loading" and say so.
    setTimeout(() => {
      if (!getState().registersReady) setState((s) => ({ registersReady: true, registerErrors: { ...s.registerErrors, _slow: 'Your saved records are slow to load and may be out of date.' } }));
    }, 10000);
    for (const r of REGISTERS) {
      watchCollection(r.key, (rows) => { setState((s) => ({ registers: { ...s.registers, [r.key]: rows } })); settle(r.key); recompute(false); }, (code) => { setState((s) => ({ registerErrors: { ...s.registerErrors, [r.key]: code } })); settle(r.key); });
    }
    watchCollection('settings', (rows) => {
      const by = Object.fromEntries(rows.map((r) => { const { id, ...rest } = r; return [id, rest]; }));
      setState({ settings: { main: by.main || {}, strategy: by.strategy || {}, profile: by.profile || {} } });
      settle('settings');
      recompute(false);
    }, () => settle('settings'));
  }

  // Live connections.
  const mcp = await cap('mcp');
  if (!mcp) {
    setState((s) => ({ boot: { ...s.boot, mcp: 'absent' } }));
    return;
  }
  setState((s) => ({ boot: { ...s.boot, mcp: 'ready' } }));
  // One batched permission dialog for the connectors, then read.
  await requestPermissions(permissionNames());
  refresh(false);
  setInterval(() => {
    setState({ now: Date.now() });
    if (document.visibilityState === 'visible' && Date.now() - getState().lastRefresh > REFRESH_EVERY) refresh(false);
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - getState().lastRefresh > REFRESH_EVERY) refresh(false);
  });
}

// ---------------------------------------------------------------- shell

function IndexItem({ no, name, sheet, current, stats }) {
  return (
    <button type="button" class="index__item" aria-current={current ? 'page' : undefined} onClick={() => actions.go({ sheet })}>
      <span class="index__no">{no}</span>
      <span class="index__name">{name}</span>
      <span class="index__flag">
        {stats && stats.alert > 0 && <><span class="dot dot--alert" aria-hidden="true" /><span>{stats.alert}<span class="sr-only"> need action</span></span></>}
        {stats && !stats.alert && stats.watch > 0 && <><span class="dot dot--watch" aria-hidden="true" /><span>{stats.watch}<span class="sr-only"> to watch</span></span></>}
      </span>
    </button>
  );
}

function SheetIndex({ state, cls }) {
  const stats = state.fleet ? state.fleet.divisionStats : {};
  const realStats = (k) => {
    const mine = state.fleet ? (state.fleet.byDivision[k] || []).filter((m) => m.role !== 'Checklist keeper') : [];
    return { alert: mine.filter((m) => m.status === 'alert').length, watch: mine.filter((m) => m.status === 'watch').length };
  };
  void stats;
  return (
    <nav class={cls} aria-label="Sheets">
      <IndexItem no="A-00" name="Command" sheet="command" current={state.sheet === 'command'} />
      {DOMAINS.map((d) => (
        <IndexItem key={d.key} no={d.sheet} name={d.title} sheet={d.key} current={state.sheet === d.key} stats={realStats(d.key)} />
      ))}
    </nav>
  );
}

function Drawers({ state }) {
  const d = state.ui.drawer;
  if (!d) return null;
  const now = new Date(state.now);
  if (d.type === 'register') return <RegisterForm key={`${d.regKey}${d.id}`} regKey={d.regKey} id={d.id} preset={d.preset} registers={state.registers} onSave={actions.saveRecord} onDelete={actions.deleteRecord} onClose={closeDrawer} now={now} />;
  if (d.type === 'settings') return <SettingsForm key={d.docId} docId={d.docId} values={state.settings[d.docId]} focusField={d.field} onSave={actions.saveSettings} onClose={closeDrawer} />;
  if (d.type === 'minion') return <MinionDrawer minion={d.minion} actions={actions} onClose={closeDrawer} />;
  if (d.type === 'fleet') return <FleetDrawer fleet={state.fleet} initial={d.filter} actions={actions} onClose={closeDrawer} />;
  if (d.type === 'ask') return <AskDrawer key={d.n} state={state} actions={actions} seed={d.seed} onClose={closeDrawer} />;
  if (d.type === 'job') {
    const raw = state.model && state.model.jt ? state.model.jt.jobs.find((j) => j.id === d.id) : null;
    if (!raw) return <Drawer title="Job" onClose={closeDrawer}><span class="muted">That job is not in the data that loaded.</span></Drawer>;
    const job = jobView(raw, Number((state.settings.main || {}).grossMarginTarget) || null);
    const mine = state.fleet ? state.fleet.seated.filter((m) => m.id.endsWith(`:${job.id}`)) : [];
    return <Drawer title={job.name} onClose={closeDrawer} wide><JobDetail job={job} minions={mine} actions={actions} /></Drawer>;
  }
  return null;
}

function App() {
  const [state, set] = useState(getState());
  useEffect(() => subscribe(set), []);
  const Sheet = SHEETS[state.sheet];
  const briefing = buildBriefing({ results: state.results, fleet: state.fleet || { seated: [] }, coverage: state.coverage || { overall: { score: 0 } } }, { now: new Date(state.now), name: (state.settings.profile || {}).ownerName, anyLive: !!(state.model && state.model.anyLive), loading: state.loading || state.boot.mcp === 'pending' });
  const result = Sheet ? state.results[state.sheet] : null;
  return (
    <div class="app">
      <aside class="rail">
        <div class="brand">
          <span class="brand__mark">JARVIS</span>
          <span class="brand__sub">v{VERSION}</span>
        </div>
        <div>
          <div class="index__label">Sheet index</div>
          <SheetIndex state={state} cls="index" />
        </div>
        <div class="rail__foot">
          <button type="button" class="btn btn--ghost btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => actions.openSettings('main')}><Icon name="edit" size={13} /> Numbers Jarvis needs</button>
          <button type="button" class="btn btn--ghost btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => actions.openSettings('profile')}><Icon name="edit" size={13} /> About you and the businesses</button>
          <span>Reads QuickBooks and JobTread. Changes nothing in them.</span>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <Seg label="Company" value={state.scope} onChange={(v) => { setState({ scope: v }); recompute(true); }} options={[{ value: 'all', label: 'Both' }, { value: 'ab', label: 'Advanced Builds' }, { value: 'sr', label: 'Seal Right' }]} />
          <span class="topbar__spacer" />
          <span class="topbar__fresh" aria-live="polite">{state.loading ? 'Reading your systems…' : state.lastRefresh ? `Read ${ago(state.lastRefresh, state.now)}` : state.boot.mcp === 'absent' ? 'Not connected' : 'Starting…'}</span>
          <Button icon="refresh" onClick={() => refresh(true)} disabled={state.loading || state.boot.mcp !== 'ready'} aria-label="Read everything again">Refresh</Button>
          <Button kind="primary" icon="ask" onClick={() => actions.ask()}>Ask Jarvis</Button>
        </header>
        <SheetIndex state={state} cls="sheetnav" />
        <main class="content" id="sheet">
          {state.loading && !state.lastRefresh && <div class="banner banner--info" role="status">Reading QuickBooks and JobTread for the first time today. Figures fill in as each answer arrives, which can take a minute; anything marked "not visible" may simply not have loaded yet. If claude.ai asks, allow the connectors.</div>}
          {state.registerErrors._slow && <div class="banner banner--warn">{state.registerErrors._slow}</div>}
          {state.boot.db === 'absent' && <div class="banner banner--warn">Your own records (team, equipment, insurance, targets) cannot be saved in this view. Open Jarvis from claude.ai while signed in.</div>}
          {Sheet && result ? <Sheet result={result} state={state} actions={actions} /> : <CommandSheet state={state} actions={actions} briefing={briefing} />}
        </main>
      </div>
      <Drawers state={state} />
      {state.ui.toast && <div class="toast" role="status">{state.ui.toast}</div>}
    </div>
  );
}

const root = document.getElementById('jarvis-root');
if (root) {
  root.textContent = '';
  render(<App />, root);
  boot();
}
