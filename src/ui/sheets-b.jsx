// Sheets A-03 People, A-08 Equipment, A-09 Legal, A-10 Purchasing, A-11 Structure,
// A-12 Strategy, A-13 Weekly review.

import { useState } from 'preact/hooks';
import { SheetFrame } from './frame.jsx';
import { Panel, Tiles, Tile, Table, KV, Pill, Button, Empty, Meter, StatusIcon, Banner } from './kit.jsx';
import { SegBar, Ranked } from './charts.jsx';
import { RegisterPanel } from '../registers/ui.jsx';
import { money, moneyShort, pct, plural, shortDate, toNum, isoDate } from '../app/format.js';
import { COMPANIES } from '../registers/schemas.js';
import { PURPOSE_LABEL } from '../model/bank.js';
import { DUTIES } from '../domains/org.js';
import { newId } from '../platform/db.js';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const reg = (state, actions) => ({ registers: state.registers, scope: state.scope, actions, canEdit: state.boot.canEdit, ready: state.registersReady, now: new Date(state.now) });
const score = (v) => (v === null || v === undefined ? '—' : <Pill status={v < 3 ? 'alert' : v < 4 ? 'watch' : 'good'} icon={false}>{v}</Pill>);

// ---------------------------------------------------------------- A-03 People

export function PplSheet({ result, state, actions }) {
  const d = result.data;
  return (
    <SheetFrame domainKey="ppl" result={result} state={state} actions={actions} tools={d.people > 0 && <Button kind="primary" icon="plus" onClick={() => actions.openRegister('scorecards', { preset: { week: d.thisWeek } })}>Score someone for {d.thisWeek}</Button>}>
      {d.people === 0 && (
        <Banner kind="info">
          No connected system knows your team: JobTread has {d.jtUsers ? plural(d.jtUsers.length, 'user') : 'one user'} and {d.jtTime ? `${d.jtTime.hours} hours` : 'no hours'} logged this year, and QuickBooks Payroll cannot be read for Canadian companies. Add each person once, then score them weekly. It takes about a minute per person.
        </Banner>
      )}
      <Tiles>
        <Tile label="On the roster" value={d.people ? String(d.people) : null} blind={!d.people} />
        <Tile label="Scored this week" value={d.people ? `${d.rows.filter((r) => r.scoredThisWeek).length} of ${d.people}` : null} blind={!d.people} />
        <Tile label="Consistently below 3" value={d.people ? String(d.low.length) : null} blind={!d.people} status={d.low.length ? 'alert' : undefined} />
        <Tile label="Can work alone" value={d.people ? String(d.rows.filter((r) => r.independent === 'yes').length) : null} blind={!d.people} />
      </Tiles>
      {d.rows.length > 0 && (
        <Panel title="The team, last four weeks" note="Scores are 1 to 5 averages from your weekly scorecards" flush>
          <Table
            rowKey={(r) => r.id}
            pageSize={20}
            columns={[
              { key: 'name', label: 'Person', render: (r) => (<>{r.name}<span class="tbl__sub">{r.role || 'no role'}{r.company && COMPANIES[r.company] ? ` · ${COMPANIES[r.company].name}` : ''}</span></>) },
              { key: 'hours', label: 'Hours', align: 'r', render: (r) => r.hours || '—' },
              { key: 'absent', label: 'Absent', align: 'r', render: (r) => (r.cards ? r.absent : '—') },
              { key: 'productivity', label: 'Output', align: 'r', sort: (r) => r.scores.productivity, render: (r) => score(r.scores.productivity) },
              { key: 'quality', label: 'Quality', align: 'r', sort: (r) => r.scores.quality, render: (r) => score(r.scores.quality) },
              { key: 'attitude', label: 'Attitude', align: 'r', sort: (r) => r.scores.attitude, render: (r) => score(r.scores.attitude) },
              { key: 'safety', label: 'Safety', align: 'r', sort: (r) => r.scores.safety, render: (r) => score(r.scores.safety) },
              { key: 'valueRatio', label: 'Earns vs costs', align: 'r', render: (r) => (r.valueRatio !== null ? `${r.valueRatio}x` : '—') },
              { key: 'supervisorReady', label: 'Supervisor', render: (r) => (r.supervisorReady === 'ready' ? 'Ready' : r.supervisorReady === 'developing' ? '6-12 mo' : '—') },
            ]}
            rows={d.rows}
            onRow={(r) => actions.openRegister('people', { id: r.id })}
          />
        </Panel>
      )}
      <RegisterPanel regKey="people" {...reg(state, actions)} />
      <RegisterPanel regKey="scorecards" pageSize={10} {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-08 Equipment and vehicles

export function EqpSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  return (
    <SheetFrame domainKey="eqp" result={result} state={state} actions={actions}>
      <Tiles>
        <Tile label="Assets on file" value={d.assets.length ? String(d.assets.length) : null} blind={!d.assets.length} />
        <Tile label="Payments per month" value={d.assets.length ? moneyShort(d.assets.reduce((t, a) => t + (toNum(a.monthlyPayment) || 0), 0)) : d.detected.length ? moneyShort(d.detected.reduce((t, r) => t + r.monthly, 0)) : null} blind={!d.assets.length && !d.detected.length} hint={!d.assets.length && d.detected.length ? 'seen in the bank feed' : ''} />
        <Tile label="Down right now" value={d.assets.length ? String(d.assets.filter((a) => a.status === 'down').length) : null} blind={!d.assets.length} status={d.assets.some((a) => a.status === 'down') ? 'watch' : undefined} />
        <Tile label="Repairs this year" value={d.repairs.length ? moneyShort(d.assets.reduce((t, a) => t + a.repairsYtd, 0)) : null} blind={!d.repairs.length} />
        <Tile label="Rented this year" value={d.rental ? moneyShort(d.rental) : null} blind={!d.rental} hint={d.rental ? 'equipment rental, from the bank feed' : ''} />
      </Tiles>
      {d.detected.length > 0 && d.assets.every((a) => !toNum(a.monthlyPayment)) && (
        <Panel title="Equipment financing Jarvis found in the bank feed" note="Not yet matched to an asset">
          <KV rows={[...d.detected.map((r) => [`${r.payee} · ${r.cadence} · next ${shortDate(r.nextDate, now)}`, money(r.amount)]), ['Per month', money(d.detected.reduce((t, r) => t + r.monthly, 0)), { total: true }]]} />
          <p class="muted" style={{ fontSize: 'var(--t-sm)' }}>Add the truck, rig or trailer each of these pays for, with its payment and end date, and Jarvis will track the payoff.</p>
        </Panel>
      )}
      {d.assets.length > 0 && (
        <Panel title="Each asset at a glance" flush>
          <Table
            rowKey={(a) => a.id}
            pageSize={15}
            columns={[
              { key: 'name', label: 'Asset', render: (a) => (<>{a.name}<span class="tbl__sub">{a.ownership || 'ownership not set'}{a.status === 'down' ? ' · DOWN' : ''}</span></>) },
              { key: 'monthlyPayment', label: 'Payment', align: 'r', render: (a) => (toNum(a.monthlyPayment) ? money(a.monthlyPayment) : '—') },
              { key: 'bookValue', label: 'Book value', align: 'r', render: (a) => (a.bookValue !== null ? money(a.bookValue) : '—') },
              { key: 'serviceDue', label: 'Service', align: 'r', render: (a) => (a.serviceDue === null ? '—' : a.serviceDue < 0 ? <Pill status="alert">{-a.serviceDue} d late</Pill> : a.serviceDue <= 14 ? <Pill status="watch">in {a.serviceDue} d</Pill> : shortDate(a.nextServiceDate, now)) },
              { key: 'insuranceDue', label: 'Insurance', align: 'r', render: (a) => (a.insuranceDue === null ? '—' : a.insuranceDue < 0 ? <Pill status="alert">expired</Pill> : a.insuranceDue <= 30 ? <Pill status="watch">{a.insuranceDue} d left</Pill> : shortDate(a.insuranceExpiry, now)) },
              { key: 'utilization', label: 'In use', align: 'r', render: (a) => (a.utilization !== null ? pct(a.utilization) : '—') },
              { key: 'repairsYtd', label: 'Repairs', align: 'r', render: (a) => (a.repairsYtd ? money(a.repairsYtd) : '—') },
              { key: 'replaceYear', label: 'Replace', align: 'r', render: (a) => a.replaceYear || '—' },
            ]}
            rows={d.assets}
            onRow={(a) => actions.openRegister('equipment', { id: a.id })}
          />
        </Panel>
      )}
      <RegisterPanel regKey="equipment" {...reg(state, actions)} />
      <RegisterPanel regKey="maintenance" {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-09 Legal and compliance

export function LglSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const dated = d.policies.filter((p) => p.days !== null).sort((a, b) => a.days - b.days);
  return (
    <SheetFrame domainKey="lgl" result={result} state={state} actions={actions}>
      <Banner kind="info">Jarvis keeps the register and watches the dates. It does not know what your contracts or the law require: for anything with real money attached, have a lawyer read it before you sign.</Banner>
      <Tiles>
        <Tile label="Policies and certificates" value={d.policies.length ? String(d.policies.length) : null} blind={!d.policies.length} />
        <Tile label="Expired" value={d.policies.length ? String(dated.filter((p) => p.days < 0).length) : null} blind={!d.policies.length} status={dated.some((p) => p.days < 0) ? 'alert' : undefined} />
        <Tile label="Renewing within 60 days" value={d.policies.length ? String(dated.filter((p) => p.days >= 0 && p.days <= 60).length) : null} blind={!d.policies.length} status={dated.some((p) => p.days >= 0 && p.days <= 60) ? 'watch' : undefined} />
        <Tile label="Agreements on file" value={d.contracts.length ? String(d.contracts.length) : null} blind={!d.contracts.length} hint={`${d.signedJt} approved proposals in JobTread`} />
        <Tile label="Open disputes" value={String(d.disputes.length)} status={d.disputes.length ? 'alert' : undefined} />
      </Tiles>
      {dated.length > 0 && (
        <Panel title="What expires next" flush>
          <Table
            rowKey={(p) => p.id}
            columns={[
              { key: 'name', label: 'Item', render: (p) => (<>{p.name}<span class="tbl__sub">{p.provider || ''}</span></>) },
              { key: 'expiry', label: 'Expires', render: (p) => shortDate(p.expiry, now) },
              { key: 'days', label: 'Days left', align: 'r', render: (p) => (p.days < 0 ? <Pill status="alert">expired {-p.days} d ago</Pill> : p.days <= 60 ? <Pill status="watch">{p.days}</Pill> : p.days) },
              { key: 'coverage', label: 'Coverage', align: 'r', render: (p) => (toNum(p.coverage) ? money(p.coverage) : '—') },
            ]}
            rows={dated}
            onRow={(p) => actions.openRegister('policies', { id: p.id })}
          />
        </Panel>
      )}
      <RegisterPanel regKey="policies" {...reg(state, actions)} />
      <RegisterPanel regKey="contracts" {...reg(state, actions)} />
      <RegisterPanel regKey="issues" title="Disputes and claims" filter={(r) => r.kind === 'dispute' || r.kind === 'warranty'} {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-10 Purchasing and suppliers

export function PurSheet({ result, state, actions }) {
  const d = result.data;
  const purposes = d.bankPurpose ? Object.entries(d.bankPurpose).filter(([k]) => k !== 'unknown' && k !== 'tax' && k !== 'financing').sort((a, b) => b[1] - a[1]) : [];
  return (
    <SheetFrame domainKey="pur" result={result} state={state} actions={actions} tools={<Button icon="edit" onClick={() => actions.openSettings('main', 'limitCrew')}>Set purchasing approval limits</Button>}>
      <Tiles>
        <Tile label="Supplier spend on record" value={d.loaded ? moneyShort(d.spend) : null} blind={!d.loaded} hint="JobTread bills, Advanced Builds" />
        <Tile label="Suppliers" value={d.loaded ? String(d.rows.length) : null} blind={!d.loaded} hint={d.loaded ? `${d.rows.filter((v) => v.terms).length} with terms on file` : ''} />
        <Tile label="Owed to suppliers" value={d.loaded ? moneyShort(d.rows.reduce((t, v) => t + v.unpaid, 0)) : null} blind={!d.loaded} status={d.rows.some((v) => v.overdue > 0) ? 'alert' : undefined} hint={d.loaded ? `${money(d.rows.reduce((t, v) => t + v.overdue, 0))} past due` : ''} />
        <Tile label="Paid by cheque or e-transfer" value={d.unknownOut !== null ? moneyShort(d.unknownOut) : null} blind={d.unknownOut === null} hint="purpose not recorded" />
      </Tiles>
      <div class="grid grid--2">
        <Panel title="Where the money goes, by supplier" note="From JobTread bills">
          {d.rows.length ? <Ranked title="Spend by supplier" rows={d.rows.map((v) => ({ label: v.name, value: v.billed, note: d.spend ? pct(v.billed / d.spend) : '' }))} /> : <Empty title="No supplier bills readable">Seal Right purchases exist only as uncategorized bank and card transactions.</Empty>}
        </Panel>
        <Panel title="Card and debit spending, by what it bought" note="From bank descriptions, this year">
          {purposes.length ? <SegBar title="Card and debit spending by purpose" parts={purposes.map(([k, v], i) => ({ label: PURPOSE_LABEL[k] || k, value: v, color: SERIES[i % SERIES.length] }))} /> : <Empty title="No bank feed in view" />}
          {d.unknownOut ? <p class="muted" style={{ fontSize: 'var(--t-sm)', maxWidth: '70ch' }}>{money(d.unknownOut)} more left by cheque and e-transfer. The bank records the amount and the date but not what it bought, so Jarvis cannot say whether that was materials, subcontractors or wages.</p> : null}
        </Panel>
      </div>
      {d.rows.length > 0 && (
        <Panel title="Suppliers" flush>
          <Table
            rowKey={(v) => v.id || v.name}
            pageSize={12}
            columns={[
              { key: 'name', label: 'Supplier' },
              { key: 'billed', label: 'Billed', align: 'r', render: (v) => money(v.billed) },
              { key: 'unpaid', label: 'Unpaid', align: 'r', render: (v) => (v.unpaid ? money(v.unpaid) : '—') },
              { key: 'overdue', label: 'Past due', align: 'r', render: (v) => (v.overdue ? <Pill status={v.overdue > 20000 ? 'alert' : 'watch'}>{money(v.overdue)}</Pill> : '—') },
              { key: 'bills', label: 'Bills', align: 'r' },
              { key: 'billsWithoutPo', label: 'No PO', align: 'r' },
              { key: 'terms', label: 'Terms on file', sort: (v) => (v.terms ? 1 : 0), render: (v) => (v.terms ? v.terms.terms || 'yes' : <button type="button" class="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); actions.openRegister('suppliers', { preset: { name: v.name, company: 'ab' } }); }}>Add</button>) },
            ]}
            rows={d.rows}
            initialSort={{ key: 'billed', dir: -1 }}
          />
        </Panel>
      )}
      <div class="grid grid--2">
        <RegisterPanel regKey="suppliers" {...reg(state, actions)} />
        <RegisterPanel regKey="inventory" {...reg(state, actions)} />
      </div>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-11 Structure and leadership

export function OrgSheet({ result, state, actions }) {
  const d = result.data;
  const roots = d.roles.filter((r) => !r.reportsTo || !d.roles.some((x) => x.id === r.reportsTo));
  const tree = (role, depth, seen) => {
    if (seen.has(role.id) || depth > 6) return null;
    const next = new Set(seen).add(role.id);
    return (
      <li key={role.id} class="stack" style={{ gap: '4px' }}>
        <button type="button" class="btn btn--ghost" style={{ justifyContent: 'flex-start', marginLeft: `${depth * 22}px`, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => actions.openRegister('roles', { id: role.id })}>
          <StatusIcon status={role.holderLabel ? 'good' : 'watch'} label={role.holderLabel ? 'Filled' : 'Open seat'} />
          <span><strong style={{ color: 'var(--ink)' }}>{role.title}</strong> <span class="muted">{role.holderLabel || 'open seat'}{role.backupLabel ? ` · backup ${role.backupLabel}` : ''}</span></span>
        </button>
        <ul class="stack" style={{ gap: '4px' }}>{d.roles.filter((r) => r.reportsTo === role.id).map((r) => tree(r, depth + 1, next))}</ul>
      </li>
    );
  };
  return (
    <SheetFrame domainKey="org" result={result} state={state} actions={actions}>
      <Tiles>
        <Tile label="Roles defined" value={d.roles.length ? String(d.roles.length) : null} blind={!d.roles.length} />
        <Tile label="Duties that depend on you" value={`${d.ownerDuties} of ${DUTIES.length}`} status={d.ownerDuties > 4 ? 'watch' : 'good'} hint="unassigned, or assigned only to the owner" />
        <Tile label="Roles with a backup" value={d.roles.length ? `${d.roles.filter((r) => r.backupLabel).length} of ${d.roles.length}` : null} blind={!d.roles.length} />
      </Tiles>
      <div class="grid grid--2">
        <Panel title="Who reports to whom">
          {d.roles.length ? <ul class="stack" style={{ gap: '4px' }}>{roots.map((r) => tree(r, 0, new Set()))}</ul> : <Empty title="No org chart yet">Define each role, who holds it and who it reports to. Start with yourself, then whoever runs the crews.</Empty>}
        </Panel>
        <Panel title="Who owns each duty" note="Anything unassigned lands on you">
          <ul class="stack" style={{ gap: '8px', fontSize: 'var(--t-sm)' }}>
            {DUTIES.map(([duty, id, label]) => {
              const item = result.items.find((i) => i.id === id);
              const owned = item && item.coverage !== 'blind';
              return (
                <li key={duty} class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
                  <StatusIcon status={!owned ? 'blind' : item.health === 'good' ? 'good' : 'watch'} />
                  <span class="grow"><strong>{label}</strong><br /><span class="muted">{owned ? `${item.display}. ${item.detail}` : 'Nobody assigned'}</span></span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <RegisterPanel regKey="roles" pageSize={12} {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-12 Growth and strategy

export function StrSheet({ result, state, actions }) {
  const d = result.data;
  const st = d.strategy || {};
  const texts = [['vision1', 'In 1 year'], ['vision3', 'In 3 years'], ['vision5', 'In 5 years'], ['financingStrategy', 'Financing strategy'], ['exitStrategy', 'Exit strategy'], ['personalGoals', 'Personal financial goals']];
  return (
    <SheetFrame domainKey="str" result={result} state={state} actions={actions} tools={<><Button icon="target" onClick={() => actions.openSettings('main', 'revenueTargetAb')}>Set targets</Button><Button icon="edit" onClick={() => actions.openSettings('strategy')}>Edit strategy notes</Button></>}>
      <div class="grid grid--2">
        <Panel title="Revenue against target" note={`${pct(d.yearShare)} of the year gone`}>
          {d.pace.length ? (
            <div class="stack">
              {d.pace.map((t) => (
                <div class="stack" key={t.key} style={{ gap: '4px' }}>
                  <div class="row row--between"><strong>{COMPANIES[t.key].name}</strong><span class="tnum">{t.ytd !== null ? `${money(t.ytd)} of ${money(t.target)}` : 'revenue not readable'}</span></div>
                  <Meter value={t.ytd || 0} max={t.target} status={t.projected !== null && t.projected < t.target * 0.95 ? 'watch' : 'good'} label={`${COMPANIES[t.key].name} revenue against target`} />
                  {t.projected !== null && <span class="muted" style={{ fontSize: 'var(--t-xs)' }}>On pace to finish near {money(t.projected)}.</span>}
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No revenue target set" action={<Button kind="primary" onClick={() => actions.openSettings('main', 'revenueTargetAb')}>Set a target</Button>}>
              {d.rev.loaded ? `${money(d.rev.ytd)} invoiced so far this year; ${money(d.rev.prevFull)} last year.` : ''}
            </Empty>
          )}
        </Panel>
        <Panel title="How concentrated revenue is" note="Share of this year's invoicing">
          {d.custs.length ? <Ranked title="Revenue share by customer" rows={d.custs.map((c) => ({ label: c.name, value: c.ytd / d.total }))} format={(v) => pct(v)} /> : <Empty title="Sales by customer could not be read" />}
        </Panel>
      </div>
      <div class="grid grid--2">
        <Panel title="A rough valuation" note="Owner's estimate, not an appraisal">
          {d.ebitda ? (
            <KV rows={[['Yearly profit before interest, tax and depreciation', money(d.ebitda)], [`At ${d.lo} times`, money(d.ebitda * d.lo)], [`At ${d.hi} times`, money(d.ebitda * d.hi)]]} />
          ) : (
            <Empty title="Needs your yearly profit" action={<Button onClick={() => actions.openSettings('strategy', 'ebitdaOverride')}>Enter it</Button>}>QuickBooks cannot supply profit until expenses are recorded. Use the figure from your accountant's last year-end statements.</Empty>
          )}
        </Panel>
        <Panel title="Where the company is going">
          <dl class="stack" style={{ gap: '10px', fontSize: 'var(--t-sm)' }}>
            {texts.map(([k, label]) => (
              <div key={k} class="stack" style={{ gap: '2px' }}>
                <dt class="field__label">{label}</dt>
                <dd style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{st[k] ? String(st[k]) : <button type="button" class="btn btn--ghost btn--sm" onClick={() => actions.openSettings('strategy', k)}>Write it down</button>}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <RegisterPanel regKey="initiatives" pageSize={10} {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-13 Weekly review

export function WkrSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  // Ticks show at once and are confirmed by storage a moment later.
  const [ticked, setTicked] = useState({});
  const current = d.current || { checks: {}, notes: {}, decisions: [] };
  const canEdit = state.boot.canEdit && state.registersReady;
  const save = async (patch) => {
    setBusy(true);
    const next = { checks: current.checks || {}, notes: current.notes || {}, decisions: current.decisions || [], closedOn: current.closedOn || null, snapshot: current.snapshot || null, ...patch };
    const res = await actions.saveWeekly(d.weekId, next);
    setBusy(false);
    return res;
  };
  const decisions = Array.isArray(current.decisions) ? current.decisions : [];
  return (
    <SheetFrame domainKey="wkr" result={result} state={state} actions={actions}>
      <Panel title={`Review for ${d.weekId}`} note={d.closed ? `Closed ${shortDate(current.closedOn, now)}` : `${d.done} of ${d.steps.length} steps walked`} actions={<Button kind={d.closed ? undefined : 'primary'} disabled={!canEdit || busy} onClick={() => save(d.closed ? { closedOn: null } : { closedOn: isoDate(now), snapshot: actions.snapshot() })}>{d.closed ? 'Reopen' : 'Close the week'}</Button>}>
        <Meter value={d.closed ? d.steps.length : d.done} max={d.steps.length} status={d.closed ? 'good' : undefined} label="Review progress" />
        {!state.registersReady && <Banner kind="info">Your saved reviews are still loading.</Banner>}
        <ol class="stack" style={{ gap: 'var(--sp-4)' }}>
          {d.steps.map((s, i) => (
            <li key={s.key} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--rule)' }}>
              <label class="check" style={{ alignItems: 'flex-start', paddingTop: '2px' }}>
                <input type="checkbox" id={`wk-${s.key}`} checked={ticked[s.key] ?? s.checked} disabled={!canEdit} onChange={async (e) => {
                  const v = e.currentTarget.checked;
                  setTicked((t) => ({ ...t, [s.key]: v }));
                  const res = await save({ checks: { ...(current.checks || {}), ...ticked, [s.key]: v } });
                  if (res && res.ok === false) setTicked((t) => { const n = { ...t }; delete n[s.key]; return n; });
                }} />
                <span class="sr-only">Mark {s.title} reviewed</span>
              </label>
              <div class="stack" style={{ gap: '6px' }}>
                <div class="row row--between">
                  <span><span class="mono muted">{String(i + 1).padStart(2, '0')}</span> <strong>{s.title}.</strong> {s.question}</span>
                  <Button small kind="ghost" icon="chevron" onClick={() => actions.go({ sheet: s.sheet })}>Open sheet</Button>
                </div>
                <dl class="kv" style={{ maxWidth: '36rem' }}>
                  {s.facts.map((f, k) => [<dt key={`a${k}`}>{f.label}</dt>, <dd key={`b${k}`}>{f.value}</dd>])}
                </dl>
                <textarea class="input" id={`wk-note-${s.key}`} placeholder="A line on what you saw or decided (optional)" style={{ minHeight: '38px', maxWidth: '48rem' }} defaultValue={s.note} disabled={!canEdit} onBlur={(e) => { if (e.currentTarget.value !== s.note) save({ notes: { ...(current.notes || {}), [s.key]: e.currentTarget.value } }); }} />
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      <div class="grid grid--2">
        <Panel title="Decisions and follow-ups" note="Carried forward until ticked off">
          <form class="row" onSubmit={async (e) => { e.preventDefault(); if (!decision.trim()) return; await save({ decisions: [...decisions, { id: newId('d'), text: decision.trim(), done: false }] }); setDecision(''); }}>
            <input class="input grow" id="wk-decision" placeholder="e.g. Call the truss supplier about the overdue bill" value={decision} onInput={(e) => setDecision(e.currentTarget.value)} disabled={!canEdit} />
            <Button type="submit" icon="plus" disabled={!canEdit || busy || !decision.trim()}>Add</Button>
          </form>
          <ul class="stack" style={{ gap: '6px' }}>
            {decisions.map((x) => (
              <li key={x.id}><label class="check"><input type="checkbox" checked={!!x.done} disabled={!canEdit || busy} onChange={(e) => save({ decisions: decisions.map((y) => (y.id === x.id ? { ...y, done: e.currentTarget.checked } : y)) })} /><span style={x.done ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{x.text}</span></label></li>
            ))}
            {d.openDecisions.filter((x) => x.week !== d.weekId).map((x) => (
              <li key={`${x.week}${x.id}`}><label class="check"><input type="checkbox" checked={false} disabled={!canEdit || busy} onChange={() => actions.closeDecision(x.week, x.id)} /><span>{x.text} <span class="mono muted">from {x.week}</span></span></label></li>
            ))}
            {!decisions.length && !d.openDecisions.length && <li class="muted" style={{ fontSize: 'var(--t-sm)' }}>Nothing open.</li>}
          </ul>
        </Panel>
        <Panel title="Past weeks" note={`${d.streakDone} of the last 8 reviewed`} flush>
          <Table
            rowKey={(r) => r.id}
            columns={[
              { key: 'id', label: 'Week' },
              { key: 'closedOn', label: 'Closed', render: (r) => (r.closedOn ? shortDate(r.closedOn, now) : <span class="muted">open</span>) },
              { key: 'cash', label: 'Cash', align: 'r', sort: (r) => r.snapshot && r.snapshot.cash, render: (r) => (r.snapshot && r.snapshot.cash !== null && r.snapshot.cash !== undefined ? money(r.snapshot.cash) : '—') },
              { key: 'owed', label: 'Owed to you', align: 'r', sort: (r) => r.snapshot && r.snapshot.owed, render: (r) => (r.snapshot && r.snapshot.owed !== null && r.snapshot.owed !== undefined ? money(r.snapshot.owed) : '—') },
              { key: 'quotes', label: 'Open quotes', align: 'r', sort: (r) => r.snapshot && r.snapshot.quotes, render: (r) => (r.snapshot && r.snapshot.quotes !== null && r.snapshot.quotes !== undefined ? money(r.snapshot.quotes) : '—') },
            ]}
            rows={d.history}
            empty={<div class="panel__bd"><Empty title="No reviews yet">Close this week and it becomes the baseline next week is compared with.</Empty></div>}
          />
        </Panel>
      </div>
    </SheetFrame>
  );
}
