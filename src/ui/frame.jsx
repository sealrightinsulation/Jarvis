// What every sheet shares: the title block, the minions' report for that division, and the
// owner's checklist with what Jarvis can and cannot see.

import { DOMAIN_BY_KEY } from '../catalog/catalog.js';
import { coverageOf } from '../domains/contract.js';
import { TitleBlock, Panel, Items, Findings, Banner, Pill, Button } from './kit.jsx';
import { ago, pct } from '../app/format.js';

const SOURCES = {
  fin: 'QuickBooks · bank feed · your inputs',
  job: 'JobTread',
  ppl: 'Your roster and scorecards',
  sal: 'JobTread · QuickBooks',
  ops: 'JobTread · your lists',
  csh: 'Bank feed · QuickBooks · JobTread',
  cus: 'QuickBooks · JobTread · your notes',
  eqp: 'Your equipment list · bank feed',
  lgl: 'Your compliance lists',
  pur: 'JobTread · your supplier list',
  org: 'Your roles list',
  str: 'QuickBooks · your strategy notes',
  wkr: 'All sheets',
};

export function SheetFrame({ domainKey, result, state, actions, children, tools }) {
  const d = DOMAIN_BY_KEY[domainKey];
  const cov = coverageOf(result.items);
  const fleet = state.fleet;
  const mine = fleet ? fleet.byDivision[domainKey] || [] : [];
  const attention = mine.filter((m) => m.status === 'alert' || m.status === 'watch').filter((m) => m.role !== 'Checklist keeper');
  const stats = fleet ? fleet.divisionStats[domainKey] : null;
  const scopeLabel = state.scope === 'all' ? 'Both companies' : state.scope === 'ab' ? 'Advanced Builds' : 'Seal Right';
  return (
    <>
      <TitleBlock
        no={d.sheet}
        title={d.title}
        lede={d.lede}
        meta={[
          ['Scope', scopeLabel],
          ['Read', state.model && state.model.loadedAt ? ago(state.model.loadedAt, state.now) : state.loading ? 'loading' : 'not yet'],
          ['Sees', `${cov.live + cov.partial} of ${cov.total}`],
          ['Source', SOURCES[domainKey]],
        ]}
      />
      {result.error && <Banner kind="crit">This sheet hit a problem working out its numbers ({result.error}). The rest of Jarvis is unaffected.</Banner>}
      {tools && <div class="row">{tools}</div>}
      {children}
      <Panel
        title="What the minions on this sheet report"
        note={stats ? `${stats.seated} posted · ${stats.alert} need action · ${stats.watch} to watch · ${stats.blind} blind` : undefined}
        flush
        actions={<Button small kind="ghost" icon="floor" onClick={() => actions.openFleet({ division: domainKey })}>See all {stats ? stats.seated : ''}</Button>}
      >
        <Findings
          findings={attention.map((m) => ({ id: m.id, status: m.status, title: m.target, detail: m.finding, who: m.role, action: m.action }))}
          onAction={(f) => actions.go(f.action.go)}
          limit={8}
          empty={<div class="panel__bd"><span class="muted">Nothing on this sheet needs you right now.</span></div>}
        />
      </Panel>
      <Panel title="What you said you should know" note={`${cov.live} live · ${cov.partial} partial · ${cov.blind} not visible yet (${pct(cov.score)} covered)`} flush>
        <Items items={result.items} onFix={(it) => actions.go(it.fix.go)} />
      </Panel>
    </>
  );
}

export const healthPill = (h, label) => (h && h !== 'none' ? <Pill status={h}>{label}</Pill> : null);
