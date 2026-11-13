// Sheets A-01 Financial health, A-06 Cash, A-02 Jobs, A-04 Sales, A-05 Operations, A-07 Customers.

import { SheetFrame } from './frame.jsx';
import { Panel, Tiles, Tile, Table, KV, Pill, Button, Empty, Banner, Meter, StatusIcon } from './kit.jsx';
import { Columns, Lines, SegBar, Ranked } from './charts.jsx';
import { RegisterPanel } from '../registers/ui.jsx';
import { money, moneyShort, pct, plural, shortDate, dayLabel, monthLabel, toNum, round2 } from '../app/format.js';
import { COMPANIES } from '../registers/schemas.js';
import { KIND_LABEL, PURPOSE_LABEL } from '../model/bank.js';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const reg = (state, actions) => ({ registers: state.registers, scope: state.scope, actions, canEdit: state.boot.canEdit, ready: state.registersReady, now: new Date(state.now) });

// ---------------------------------------------------------------- A-01 Financial health

export function FinSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const rev = d.rev;
  const months = d.months12 || [];
  const cos = Object.keys(rev.byCompany || {});
  const kinds = d.bankYtd ? Object.entries(d.bankYtd.byKind).sort((a, b) => b[1] - a[1]) : [];
  return (
    <SheetFrame domainKey="fin" result={result} state={state} actions={actions} tools={<Button icon="edit" onClick={() => actions.openSettings('main')}>Numbers Jarvis needs from you</Button>}>
      <Tiles>
        <Tile label="Revenue this year" value={moneyShort(rev.ytd)} blind={!rev.loaded} hint={rev.loaded ? `${money(rev.thisMonth)} this month` : ''} />
        <Tile label="Last 12 full months" value={moneyShort(rev.ttm)} blind={!rev.loaded} hint={rev.loaded && rev.prevFull ? `${money(rev.prevFull)} last calendar year` : ''} />
        <Tile label="Owed to you" value={moneyShort(d.ar.total)} blind={!d.ar.loaded} status={d.ar.overdueTotal > 0 ? 'watch' : 'good'} hint={d.ar.loaded ? `${money(d.ar.overdueTotal)} overdue` : ''} onClick={() => actions.go({ sheet: 'csh' })} />
        <Tile label="Unpaid supplier bills" value={moneyShort(d.ap.total)} blind={!d.ap.loaded} status={d.ap.overdueTotal > 0 ? 'alert' : undefined} hint={d.ap.loaded ? `${money(d.ap.overdueTotal)} past due` : 'not tracked'} onClick={() => actions.go({ sheet: 'pur' })} />
        <Tile label="Cash in the bank" value={moneyShort(d.cash.amount)} blind={!d.cash.known} hint={d.cash.known ? (d.cash.complete ? 'all accounts' : 'the one visible account') : 'no bank connected'} onClick={() => actions.go({ sheet: 'csh' })} />
        <Tile label="Safe to spend" value={d.safe !== null && d.safe > 0 ? moneyShort(d.safe) : 'Nothing'} blind={d.safe === null} status={d.safe !== null && d.safe <= 0 ? 'alert' : undefined} hint={d.safe !== null ? `after ${money(d.next30)} going out in 30 days` : ''} />
      </Tiles>

      <Panel title="Invoiced revenue by month" note="Before HST. The current month is still filling in.">
        {rev.loaded ? (
          <Columns
            title="Invoiced revenue by month"
            labels={months.map((m) => monthLabel(m, true))}
            series={cos.length > 1 ? cos.map((k, i) => ({ label: COMPANIES[k].name, color: SERIES[i], values: months.map((m) => rev.byCompany[k][m] || 0) })) : [{ label: 'Revenue', color: SERIES[0], values: months.map((m) => rev.total[m] || 0) }]}
            partialLast
          />
        ) : (
          <Empty title="QuickBooks has not answered yet">Revenue appears here as soon as QuickBooks can be read.</Empty>
        )}
      </Panel>

      <div class="grid grid--2">
        <Panel id="books" title="State of the books" note="Why profit and cash cannot be read from QuickBooks today">
          {d.companies.length ? (
            <div class="stack">
              {d.companies.map((c) => {
                const feedCount = c.feeds.length;
                const pending = c.feeds.reduce((t, f) => t + f.pendingCount, 0);
                const everReconciled = c.recon.some((r) => r.lastDate);
                return (
                  <div class="stack" key={c.key} style={{ gap: '6px' }}>
                    <strong>{c.name}</strong>
                    <ul class="stack" style={{ gap: '4px', fontSize: 'var(--t-sm)' }}>
                      <li class="row"><StatusIcon status={c.hasCosts ? 'good' : 'alert'} /> <span class="grow">{c.hasCosts ? 'Expenses are being recorded.' : 'No expenses recorded, so "profit" equals revenue.'}</span></li>
                      <li class="row"><StatusIcon status={feedCount ? 'good' : 'blind'} /> <span class="grow">{feedCount ? `${plural(feedCount, 'bank or card account')} connected.` : 'No bank account connected to this file.'}</span></li>
                      {feedCount > 0 && <li class="row"><StatusIcon status={pending > 50 ? 'alert' : pending ? 'watch' : 'good'} /> <span class="grow">{pending ? `${plural(pending, 'bank transaction')} downloaded but never categorized.` : 'Every downloaded transaction is categorized.'}</span></li>}
                      <li class="row"><StatusIcon status={everReconciled ? 'good' : 'alert'} /> <span class="grow">{everReconciled ? 'At least one account has been reconciled.' : 'No account has ever been reconciled to a bank statement.'}</span></li>
                      {c.bs && c.bs.undeposited > 1000 && <li class="row"><StatusIcon status="watch" /> <span class="grow">{money(c.bs.undeposited)} of customer payments sit in Undeposited Funds.</span></li>}
                      {c.bs && <li class="row"><StatusIcon status="watch" /> <span class="grow">Book "cash" of {money(c.bs.bookCash + c.bs.undeposited)} and HST payable of {money(c.bs.hstPayable)} are running totals, not real balances.</span></li>}
                    </ul>
                  </div>
                );
              })}
              <details class="more">
                <summary>The order to fix it in</summary>
                <ol class="stack" style={{ gap: '6px', fontSize: 'var(--t-sm)', listStyle: 'decimal', paddingLeft: '1.2rem', maxWidth: '70ch' }}>
                  <li>Connect every business bank account and credit card to its QuickBooks file (Banking, then Link account). Advanced Builds has none connected.</li>
                  <li>Categorize the backlog in QuickBooks under Banking, then For review. Start with the biggest recurring payees and add a bank rule for each so it stays done.</li>
                  <li>Record transfers between the two companies and to yourself as transfers, not income or expense, so owner and inter-company money stops inflating both sides.</li>
                  <li>Add loans, leases and credit cards as liability accounts so payments split into principal and interest.</li>
                  <li>File HST through the QuickBooks sales tax centre so the payable balance means something.</li>
                  <li>Reconcile each account monthly. Once two months reconcile, Jarvis switches to the books for profit automatically.</li>
                </ol>
              </details>
            </div>
          ) : (
            <Empty title="QuickBooks has not answered yet" />
          )}
        </Panel>

        <Panel title="Where the bank account's money went this year" note={d.bank ? 'After removing transfers, card payments and reversals' : undefined}>
          {d.bankYtd ? (
            <div class="stack">
              <KV rows={[['Money in', money(d.bankYtd.in)], ['Money out', money(d.bankYtd.out)], ['Left by cheque or e-transfer with no purpose recorded', money(d.bankYtd.unknownOut)]]} />
              <SegBar title="Money out by type" parts={kinds.slice(0, 8).map(([k, v], i) => ({ label: KIND_LABEL[k] || k, value: v, color: SERIES[i % SERIES.length] }))} />
              <p class="muted" style={{ fontSize: 'var(--t-xs)', maxWidth: '70ch' }}>Sorted from the bank's own descriptions, not QuickBooks' guesses. This one account moves far more than Seal Right invoices, so it is carrying money for more than one purpose.</p>
            </div>
          ) : (
            <Empty title="No bank feed in view">Spending can only be seen where a bank account is connected to QuickBooks. Today that is one Seal Right chequing account and one card.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="What goes out every month" note={d.commit.lines.length ? `${money(d.commit.total)} a month from what you have entered` : 'Nothing entered yet'}>
        <div class="grid grid--2">
          <div class="stack">
            <strong>Entered by you</strong>
            {d.commit.lines.length ? <KV rows={[...d.commit.lines.map((l) => [l.label, money(l.monthly)]), ['Total', money(d.commit.total), { total: true }]]} /> : <span class="muted" style={{ fontSize: 'var(--t-sm)' }}>Payroll, rent, insurance, loan and equipment payments belong here. Break-even, safe-to-spend and the forecast all rest on them.</span>}
          </div>
          <div class="stack">
            <strong>Repeating payments Jarvis found in the bank feed</strong>
            {d.detected.length ? (
              <Table
                pageSize={8}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'payee', label: 'Paid to' },
                  { key: 'amount', label: 'Amount', align: 'r', render: (r) => money(r.amount) },
                  { key: 'cadence', label: 'How often' },
                  { key: 'nextDate', label: 'Next', render: (r) => shortDate(r.nextDate, now) },
                ]}
                rows={d.detected}
                foot={['Per month', money(d.detectedMonthly), '', '']}
              />
            ) : (
              <span class="muted" style={{ fontSize: 'var(--t-sm)' }}>None found{d.bank ? '' : ' (no bank feed in view)'}.</span>
            )}
          </div>
        </div>
      </Panel>
      <div class="grid grid--2">
        <RegisterPanel regKey="obligations" {...reg(state, actions)} />
        <RegisterPanel regKey="loans" {...reg(state, actions)} />
      </div>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-06 Cash management

export function CshSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const f = d.forecast;
  const s = state.settings.main || {};
  const reserve = toNum(s.reserveTarget);
  const labels = f.weeks.map((w) => dayLabel(w.from));
  const series = [{ label: 'Known items only', color: SERIES[0], values: f.weeks.map((w) => w.balance), area: true }];
  if (f.pace) series.push({ label: 'If the last 8 weeks repeat', color: SERIES[1], values: f.pace.balances });
  const flows = d.bank ? d.bank.flows : null;
  return (
    <SheetFrame domainKey="csh" result={result} state={state} actions={actions} tools={<><Button icon="edit" onClick={() => actions.openSettings('main', 'cashAb')}>Update bank balances and payroll</Button></>}>
      <Tiles>
        <Tile label="Cash in the bank" value={moneyShort(d.cash.amount)} blind={!d.cash.known} hint={d.cash.known ? (d.cash.complete ? 'all accounts' : 'the one visible account') : 'no bank connected'} />
        <Tile label="Owed to you" value={moneyShort(d.ar.total)} blind={!d.ar.loaded} hint={d.ar.loaded ? plural(d.ar.invoices.length, 'unpaid invoice') : ''} />
        <Tile label="Overdue" value={moneyShort(d.ar.overdueTotal)} blind={!d.ar.loaded} status={d.ar.overdueTotal > 0 ? 'watch' : 'good'} hint={d.ar.overdue.length ? `oldest ${d.ar.overdue[0].daysOverdue} days` : 'nothing late'} />
        <Tile label="Supplier bills unpaid" value={moneyShort(d.ap.total)} blind={!d.ap.loaded} status={d.ap.overdueTotal > 0 ? 'alert' : undefined} hint={d.ap.loaded ? `${money(d.ap.overdueTotal)} past due` : 'not tracked'} />
        <Tile label="13-week low point" value={moneyShort(f.low.balance)} blind={!f.startKnown} status={f.startKnown && f.low.balance < 0 ? 'alert' : undefined} hint={f.startKnown ? `week of ${shortDate(f.low.from, now)}` : 'needs a bank balance'} />
      </Tiles>

      <Panel title="Thirteen weeks ahead" note={f.startKnown ? `Starts from ${money(f.start)} in the bank` : 'Shown as change from today: no bank balance is known'}>
        <Lines title="Projected bank balance by week" labels={labels} series={series} refLines={reserve !== null ? [{ value: reserve, label: `Your minimum (${moneyShort(reserve)})` }] : []} />
        <ul class="stack" style={{ gap: '4px', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', maxWidth: '85ch' }}>
          {f.notes.map((n) => (
            <li key={n} class="row" style={{ alignItems: 'baseline', flexWrap: 'nowrap' }}><span class="mono muted">note</span><span class="grow">{n}</span></li>
          ))}
          {f.pace && <li class="row" style={{ alignItems: 'baseline', flexWrap: 'nowrap' }}><span class="mono muted">note</span><span class="grow">The second line assumes {money(f.pace.inPerWeek)} in and {money(f.pace.outPerWeek)} out each week, the bank account's average from {shortDate(f.pace.from, now)} to {shortDate(f.pace.to, now)}, transfers removed.</span></li>}
        </ul>
        <details class="more">
          <summary>Week by week, with what is in each</summary>
          <Table
            pageSize={13}
            rowKey={(w) => w.from}
            columns={[
              { key: 'from', label: 'Week of', render: (w) => shortDate(w.from, now), sort: (w) => w.from },
              { key: 'inflow', label: 'In', align: 'r', render: (w) => money(w.inflow) },
              { key: 'outflow', label: 'Out', align: 'r', render: (w) => money(w.outflow) },
              { key: 'balance', label: 'Balance', align: 'r', render: (w) => money(w.balance) },
              { key: 'items', label: 'Largest items', sort: false, render: (w) => w.items.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 3).map((i) => `${i.label} ${money(i.amount)}`).join(' · ') || '—' },
            ]}
            rows={f.weeks}
          />
        </details>
      </Panel>

      <div class="grid grid--2">
        <Panel title="Who owes you" note={d.ar.loaded ? `${money(d.ar.total)} across ${plural(d.ar.invoices.length, 'invoice')}` : undefined} flush>
          {d.ar.loaded ? (
            <>
              {d.ar.total > 0 && (
                <div class="panel__bd" style={{ paddingTop: 0 }}>
                  <SegBar title="Receivables by age" parts={[{ label: 'Not yet due', value: d.ar.buckets.current, color: 'var(--seq-2)' }, { label: '1-30 days late', value: d.ar.buckets.d1_30, color: 'var(--seq-3)' }, { label: '31-60', value: d.ar.buckets.d31_60, color: 'var(--seq-4)' }, { label: '61-90', value: d.ar.buckets.d61_90, color: 'var(--seq-5)' }, { label: 'Over 90', value: d.ar.buckets.d90, color: 'var(--crit)' }]} />
                </div>
              )}
              <Table
                rowKey={(i) => `${i.company}${i.id}`}
                columns={[
                  { key: 'customer', label: 'Customer', render: (i) => (<>{i.customer}<span class="tbl__sub">{COMPANIES[i.company].name} · invoice {i.number || i.id}</span></>) },
                  { key: 'dueDate', label: 'Due', render: (i) => shortDate(i.dueDate, now) },
                  { key: 'daysOverdue', label: 'Days late', align: 'r', render: (i) => (i.daysOverdue > 0 ? <Pill status={i.daysOverdue > 30 ? 'alert' : 'watch'}>{i.daysOverdue}</Pill> : '—') },
                  { key: 'balance', label: 'Owing', align: 'r', render: (i) => money(i.balance) },
                ]}
                rows={d.ar.invoices}
                initialSort={{ key: 'daysOverdue', dir: -1 }}
                empty={<div class="panel__bd"><span class="muted">Nobody owes you anything right now.</span></div>}
              />
            </>
          ) : (
            <div class="panel__bd"><Empty title="Invoices could not be read" /></div>
          )}
        </Panel>

        <Panel title="Supplier bills to pay" note={d.ap.loaded ? `${money(d.ap.total)} in JobTread` : 'Advanced Builds only'} flush>
          {d.ap.loaded ? (
            <Table
              rowKey={(b) => b.id}
              columns={[
                { key: 'account', label: 'Supplier', render: (b) => (<>{b.account}<span class="tbl__sub">{b.job}</span></>) },
                { key: 'dueDate', label: 'Due', render: (b) => shortDate(b.dueDate, now) },
                { key: 'daysOverdue', label: 'Days late', align: 'r', render: (b) => (b.daysOverdue > 0 ? <Pill status={b.daysOverdue > 30 ? 'alert' : 'watch'}>{b.daysOverdue}</Pill> : '—') },
                { key: 'balance', label: 'Owing', align: 'r', render: (b) => money(b.balance) },
              ]}
              rows={d.ap.bills}
              initialSort={{ key: 'daysOverdue', dir: -1 }}
              empty={<div class="panel__bd"><span class="muted">No unpaid bills in JobTread.</span></div>}
            />
          ) : (
            <div class="panel__bd"><Empty title="No supplier bills on record">QuickBooks holds none for either company; JobTread bills cover Advanced Builds jobs.</Empty></div>
          )}
        </Panel>
      </div>

      {flows && flows.months.length > 0 && (
        <Panel title="Through the bank account, month by month" note="Transfers, card payments and reversals removed">
          <Columns title="Bank money in and out by month" labels={flows.months.map((m) => monthLabel(m, true))} series={[{ label: 'Money in', color: SERIES[2], values: flows.months.map((m) => flows.byMonth[m].in) }, { label: 'Money out', color: SERIES[1], values: flows.months.map((m) => flows.byMonth[m].out) }]} partialLast />
          {d.bank.nsf.length > 0 && <Banner kind="warn">{plural(d.bank.nsf.length, 'payment')} bounced (NSF) this year, most recently {shortDate(d.bank.nsf[d.bank.nsf.length - 1].date, now)} for {money(d.bank.nsf[d.bank.nsf.length - 1].amount)}.</Banner>}
        </Panel>
      )}

      {d.jobs.length > 0 && (
        <Panel title="Cash to finish signed work" note="What each job still has to pay out against what it still has to bring in" flush>
          <Table
            rowKey={(j) => j.id}
            columns={[
              { key: 'name', label: 'Job' },
              { key: 'toPay', label: 'Still to pay', align: 'r', render: (j) => money(j.toPay) },
              { key: 'toCollect', label: 'Still to collect', align: 'r', render: (j) => money(j.toCollect) },
              { key: 'gap', label: 'Shortfall', align: 'r', render: (j) => (j.gap > 0 ? <Pill status="alert">{money(j.gap)}</Pill> : 'covered') },
            ]}
            rows={d.jobs}
            onRow={(j) => actions.go({ sheet: 'job', job: j.id })}
          />
        </Panel>
      )}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-02 Job profitability

const STAGE = { active: 'Signed', quoted: 'Quoted', estimating: 'Estimating', lead: 'Lead', lost: 'Lost' };

export function JobSheet({ result, state, actions }) {
  const d = result.data;
  const sum = (list, f) => round2(list.reduce((t, j) => t + (f(j) || 0), 0));
  if (!d.loaded) {
    return (
      <SheetFrame domainKey="job" result={result} state={state} actions={actions}>
        <Empty title={d.srOnly ? 'Seal Right jobs are not costed anywhere' : 'JobTread has not answered'}>
          {d.srOnly ? 'QuickBooks has each Seal Right invoice, but nothing records the foam, labour hours or fuel that went into the job. To see profit per job, quote and cost Seal Right jobs in JobTread the way Advanced Builds jobs are, or record board feet and crew hours per invoice.' : 'Job costing appears here once JobTread can be read.'}
        </Empty>
      </SheetFrame>
    );
  }
  const rows = d.jobs.filter((j) => j.stage === 'active' || j.hasBudget || j.stage === 'quoted');
  return (
    <SheetFrame domainKey="job" result={result} state={state} actions={actions}>
      <Tiles>
        <Tile label="Signed work" value={moneyShort(sum(d.active, (j) => j.contract))} hint={plural(d.active.length, 'job')} />
        <Tile label="Projected margin" value={d.budgeted.length ? moneyShort(sum(d.budgeted, (j) => j.projectedMargin)) : null} blind={!d.budgeted.length} status={d.budgeted.some((j) => j.projectedMargin < 0) ? 'alert' : undefined} hint={d.budgeted.length ? `on ${plural(d.budgeted.length, 'budgeted job')}` : 'no budgets'} />
        <Tile label="Cost recorded so far" value={moneyShort(sum(d.active, (j) => j.actual))} hint="supplier bills only, no labour" />
        <Tile label="Still to invoice" value={moneyShort(sum(d.active, (j) => Math.max(0, j.contract - j.invoiced)))} hint="on signed jobs" />
        <Tile label="Bills unpaid on jobs" value={moneyShort(sum(d.active, (j) => j.billsUnpaid))} status={sum(d.active, (j) => j.billsOverdue) > 0 ? 'alert' : undefined} hint={`${money(sum(d.active, (j) => j.billsOverdue))} past due`} />
      </Tiles>
      {d.docsShort.length > 0 && <Banner kind="warn">JobTread returned fewer documents than it says exist for: {d.docsShort.join(', ')}. Totals on this sheet may be understated.</Banner>}
      <Panel title="Every job with a contract, budget or quote" note={`${d.exampleHidden ? `${plural(d.exampleHidden, 'JobTread example job')} hidden · ` : ''}select a row for the detail`} flush>
        <Table
          rowKey={(j) => j.id}
          pageSize={15}
          columns={[
            { key: 'name', label: 'Job', render: (j) => (<>{j.name}<span class="tbl__sub">{j.customer}{j.number ? ` · #${j.number}` : ''}</span></>) },
            { key: 'stage', label: 'Stage', render: (j) => STAGE[j.stage] },
            { key: 'contract', label: 'Contract', align: 'r', render: (j) => (j.contract ? money(j.contract) : j.quoted ? <span class="muted">{money(j.quoted)} quoted</span> : '—'), sort: (j) => j.contract || j.quoted },
            { key: 'projectedCost', label: 'Budget cost', align: 'r', render: (j) => (j.projectedCost !== null ? money(j.projectedCost) : '—') },
            { key: 'projectedMarginPct', label: 'Margin', align: 'r', render: (j) => (j.hasBudget ? <Pill status={j.projectedMargin < 0 ? 'alert' : j.health === 'watch' ? 'watch' : 'good'}>{pct(j.projectedMarginPct)}</Pill> : <span class="muted">no budget</span>) },
            { key: 'actual', label: 'Spent', align: 'r', render: (j) => (j.actual !== null ? money(j.actual) : '—') },
            { key: 'invoiced', label: 'Invoiced', align: 'r', render: (j) => (j.invoiced ? money(j.invoiced) : '—') },
            { key: 'billsUnpaid', label: 'Bills unpaid', align: 'r', render: (j) => (j.billsUnpaid ? money(j.billsUnpaid) : '—') },
          ]}
          rows={rows}
          initialSort={{ key: 'contract', dir: -1 }}
          onRow={(j) => actions.go({ sheet: 'job', job: j.id })}
          empty={<div class="panel__bd"><Empty title="No jobs with a contract or budget yet" /></div>}
        />
      </Panel>
      <Panel title="What is missing from job cost" note="Why actual profit is still an estimate">
        <ul class="stack" style={{ gap: '6px', fontSize: 'var(--t-sm)', maxWidth: '80ch' }}>
          <li class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}><StatusIcon status="blind" /><span class="grow"><strong>Labour.</strong> {d.time ? `${d.time.hours} hours` : 'No hours'} logged in JobTread all year. Until crews clock in against a job, labour is invisible and every margin here is overstated.</span></li>
          <li class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}><StatusIcon status="blind" /><span class="grow"><strong>Cost types.</strong> Bills are recorded by supplier, not split into materials, subcontractors, equipment or fuel.</span></li>
          <li class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}><StatusIcon status="blind" /><span class="grow"><strong>Seal Right.</strong> No Seal Right job has a quote-to-cost record in any system.</span></li>
        </ul>
      </Panel>
    </SheetFrame>
  );
}

/** Drawer body for one job. */
export function JobDetail({ job, minions, actions }) {
  const rows = [
    ['Customer', job.customer || '—'],
    ['Stage', STAGE[job.stage]],
    ['Original contract', money(job.originalContract)],
    [`Approved after (${job.changeOrderCount})`, money(job.changeOrders)],
    ['Contract total', money(job.contract), { total: true }],
    ['Budgeted cost', job.projectedCost !== null ? money(job.projectedCost) : 'no budget'],
    ['Projected margin', job.hasBudget ? `${money(job.projectedMargin)} (${pct(job.projectedMarginPct)})` : '—'],
    ['Cost recorded so far', job.actual !== null ? money(job.actual) : 'none'],
    ['Budget spent', job.costProgress !== null ? pct(job.costProgress) : '—'],
    ['Schedule done', job.progress !== null ? pct(job.progress) : 'no schedule'],
    ['Left to spend', job.remainingCost !== null ? money(job.remainingCost) : '—'],
    ['Invoiced', money(job.invoiced)],
    ['Collected', money(job.collected)],
    ['Still to invoice', money(Math.max(0, job.contract - job.invoiced))],
    ['Supplier bills unpaid', money(job.billsUnpaid)],
    ['Of which past due', money(job.billsOverdue)],
  ];
  return (
    <div class="stack">
      <KV rows={rows} />
      {job.costProgress !== null && (
        <div class="stack" style={{ gap: '4px' }}>
          <span class="field__label">Budget spent</span>
          <Meter value={job.costProgress} status={job.health === 'alert' ? 'alert' : undefined} label="Budget spent" />
        </div>
      )}
      <strong>What the minions on this job report</strong>
      <ul class="stack" style={{ gap: '8px' }}>
        {minions.map((m) => (
          <li key={m.id} class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
            <StatusIcon status={m.status === 'clear' ? 'good' : m.status} />
            <span class="grow" style={{ fontSize: 'var(--t-sm)' }}><span class="mono muted">{m.role}</span><br />{m.finding}</span>
          </li>
        ))}
      </ul>
      <Button icon="ask" onClick={() => actions.ask(`Look at the job "${job.name}" and tell me plainly whether it is making or losing money, what worries you, and what I should do this week.`)}>Ask Jarvis about this job</Button>
    </div>
  );
}

// ---------------------------------------------------------------- A-04 Sales and pipeline

export function SalSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const o = d.outcomes;
  const total = round2(d.quotes.reduce((t, q) => t + q.value, 0));
  const stageParts = d.stages.filter((s) => s.stage !== 'lost').map((s, i) => ({ label: `${STAGE[s.stage]} (${s.jobs.length})`, value: s.jobs.length, color: ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'][i] }));
  return (
    <SheetFrame domainKey="sal" result={result} state={state} actions={actions}>
      <Tiles>
        <Tile label="Open quotes" value={moneyShort(total)} blind={!d.loaded} hint={d.loaded ? plural(d.quotes.length, 'quote') : ''} />
        <Tile label="No answer yet" value={String(d.staleQuotes.length)} blind={!d.loaded} status={d.staleQuotes.length ? 'watch' : 'good'} hint={`older than ${d.stale} days`} />
        <Tile label="Win rate this year" value={o.rate !== null ? pct(o.rate) : null} blind={o.rate === null} hint={o.rate !== null ? `${o.won} won of ${o.decided} decided` : 'too few decided'} />
        <Tile label="Signed, not yet billed" value={moneyShort(d.backlog.total)} blind={!d.backlog.loaded} hint={d.backlog.loaded ? plural(d.backlog.jobs.length, 'signed job') : 'no contract record'} />
        <Tile label="Next 3 months at current pace" value={d.forecast ? moneyShort(d.forecast.runOnly.m3) : null} blind={!d.forecast} hint={d.forecast ? `${money(d.forecast.monthlyRun)} a month average` : ''} />
      </Tiles>
      <Panel title="Quotes waiting for an answer" note="JobTread proposals and QuickBooks estimates, largest first" flush>
        <Table
          rowKey={(q) => q.id}
          pageSize={12}
          columns={[
            { key: 'customer', label: 'Customer', render: (q) => (<>{q.customer}<span class="tbl__sub">{q.title}</span></>) },
            { key: 'company', label: 'Company', render: (q) => COMPANIES[q.company].name },
            { key: 'system', label: 'Quoted in' },
            { key: 'date', label: 'Sent', render: (q) => shortDate(q.date, now) },
            { key: 'ageDays', label: 'Days out', align: 'r', render: (q) => (q.ageDays === null ? '—' : q.ageDays > d.stale ? <Pill status={q.ageDays > d.stale * 3 ? 'alert' : 'watch'}>{q.ageDays}</Pill> : q.ageDays) },
            { key: 'value', label: 'Value', align: 'r', render: (q) => money(q.value) },
          ]}
          rows={d.quotes}
          initialSort={{ key: 'value', dir: -1 }}
          empty={<div class="panel__bd"><Empty title={d.loaded ? 'No open quotes' : 'Quotes could not be read'} /></div>}
        />
      </Panel>
      <div class="grid grid--2">
        <Panel title="This year's quote outcomes">
          {d.loaded ? <KV rows={[['Won', `${o.won} · ${money(o.wonValue)}`], ['Lost', `${o.lost} · ${money(o.lostValue)}`], ['Expired with no answer', `${o.expired} · ${money(o.expiredValue)}`], ['Still open', `${o.pending} · ${money(o.pendingValue)}`], ['Win rate by count', o.rate !== null ? pct(o.rate) : 'too few to say', { total: true }]]} /> : <Empty title="Not available" />}
          {stageParts.length > 0 && <SegBar title="JobTread jobs by stage" format={(v) => String(v)} parts={stageParts} />}
        </Panel>
        <Panel title="Where the next revenue comes from">
          {d.forecast ? (
            <KV rows={[['Signed and not yet invoiced', d.forecast.backlog !== null ? money(d.forecast.backlog) : 'no record'], [`Open quotes at your ${d.forecast.winRate !== null ? pct(d.forecast.winRate) : ''} win rate`, d.forecast.weighted !== null ? money(d.forecast.weighted) : 'win rate not known'], ['Average month, last 12', money(d.forecast.monthlyRun)], ['Next 3 months at that pace', money(d.forecast.runOnly.m3)], ['Next 6 months', money(d.forecast.runOnly.m6)], ['Next 12 months', money(d.forecast.runOnly.m12)]]} />
          ) : (
            <Empty title="Needs revenue history" />
          )}
          <p class="muted" style={{ fontSize: 'var(--t-xs)' }}>A pace projection, not a forecast of signed work. Seal Right has no backlog record at all: its jobs appear only when invoiced.</p>
        </Panel>
      </div>
      <div class="grid grid--2">
        <RegisterPanel regKey="tenders" {...reg(state, actions)} />
        <RegisterPanel regKey="competitors" {...reg(state, actions)} />
      </div>
      <RegisterPanel regKey="marketing" {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-05 Operations

export function OpsSheet({ result, state, actions }) {
  const d = result.data;
  const now = new Date(state.now);
  const taskCols = (late) => [
    { key: 'name', label: 'Task', render: (t) => (<>{t.name}<span class="tbl__sub">{t.job || t.customer}</span></>) },
    { key: 'startDate', label: 'Starts', render: (t) => shortDate(t.startDate, now) },
    { key: 'endDate', label: 'Ends', render: (t) => shortDate(t.endDate, now) },
    late ? { key: 'daysLate', label: 'Days late', align: 'r', render: (t) => <Pill status={t.daysLate > 14 ? 'alert' : 'watch'}>{t.daysLate}</Pill> } : { key: 'assignees', label: 'Who', render: (t) => (t.assignees.length ? t.assignees.join(', ') : <span class="muted">nobody assigned</span>), sort: false },
  ];
  return (
    <SheetFrame domainKey="ops" result={result} state={state} actions={actions}>
      <Tiles>
        <Tile label="Signed jobs" value={String(d.active.length)} blind={!d.loaded} hint="in JobTread" />
        <Tile label="Tasks behind schedule" value={d.tasks ? String(d.overdue.length) : null} blind={!d.tasks} status={d.overdue.length > 5 ? 'alert' : d.overdue.length ? 'watch' : 'good'} />
        <Tile label="Starting in two weeks" value={d.tasks ? String(d.upcoming.length) : null} blind={!d.tasks} />
        <Tile label="Daily logs, last 120 days" value={d.logs ? String(d.logs.length) : null} blind={!d.logs} status={d.logs && d.active.length && d.logs.length < d.active.length ? 'watch' : undefined} />
        <Tile label="Team on file" value={d.people.length ? String(d.people.length) : null} blind={!d.people.length} hint={d.people.length ? '' : 'add your roster'} onClick={() => actions.go({ sheet: 'ppl' })} />
      </Tiles>
      <div class="grid grid--2">
        <Panel title="Behind schedule" note="Tasks past their end date and not finished" flush>
          <Table rowKey={(t) => t.id} columns={taskCols(true)} rows={d.overdue} initialSort={{ key: 'daysLate', dir: -1 }} empty={<div class="panel__bd"><span class="muted">{d.tasks ? 'Nothing is behind.' : 'The schedule could not be read.'}</span></div>} />
        </Panel>
        <Panel title="The next two weeks" flush>
          <Table rowKey={(t) => t.id} columns={taskCols(false)} rows={d.upcoming} initialSort={{ key: 'startDate', dir: 1 }} empty={<div class="panel__bd"><span class="muted">{d.tasks ? 'Nothing is scheduled to start.' : 'The schedule could not be read.'}</span></div>} />
        </Panel>
      </div>
      <div class="grid grid--2">
        <Panel title="Daily logs" note={`Flagged when a signed job goes ${d.gap} days without one`}>
          {d.logs && d.logs.length ? (
            <ul class="stack">
              {d.logs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6).map((l) => (
                <li key={l.id} class="stack" style={{ gap: '2px', fontSize: 'var(--t-sm)' }}>
                  <span class="mono muted">{shortDate(l.date, now)} · {l.job} · {l.user}</span>
                  <span>{l.notes}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No daily logs">A two-line log from each site every day is what makes delays, production and rework visible. JobTread's mobile app has a daily log on every job.</Empty>
          )}
        </Panel>
        <Panel title="On your calendar" note="The next two weeks">
          {d.calendar && d.calendar.events.length ? (
            <ul class="stack" style={{ gap: '6px', fontSize: 'var(--t-sm)' }}>
              {d.calendar.events.slice(0, 10).map((e) => (
                <li key={e.id + e.start} class="row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
                  <span class="mono muted nowrap">{shortDate(e.start, now)}{e.allDay ? '' : ` ${String(e.start).slice(11, 16)}`}</span>
                  <span class="grow">{e.title}{e.location ? <span class="muted"> · {e.location}</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={d.calendar ? 'Nothing on the calendar' : 'Calendar not connected'}>{d.calendar ? '' : 'Google Calendar needs to be reconnected in claude.ai Settings, then Connectors, before site visits and meetings can show here.'}</Empty>
          )}
        </Panel>
      </div>
      <RegisterPanel regKey="issues" title="Deficiencies and rework" filter={(r) => r.kind === 'deficiency' || r.kind === 'safety'} {...reg(state, actions)} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-07 Customers

export function CusSheet({ result, state, actions }) {
  const d = result.data;
  return (
    <SheetFrame domainKey="cus" result={result} state={state} actions={actions}>
      <div class="grid grid--2">
        <Panel title="Top customers by revenue this year" note={d.loaded ? `${money(d.total)} invoiced in total` : undefined}>
          {d.top10.length ? <Ranked title="Top customers by revenue" rows={d.top10.map((c) => ({ label: c.name, value: c.ytd, note: d.total ? pct(c.ytd / d.total) : '' }))} /> : <Empty title="Sales by customer could not be read" />}
        </Panel>
        <Panel title="Projected profit by customer" note="Only customers with a signed, budgeted JobTread job">
          {d.withMargin.length ? <Ranked title="Projected margin by customer" rows={d.withMargin.map((c) => ({ label: c.name, value: c.projectedMargin, color: c.projectedMargin < 0 ? 'var(--crit)' : 'var(--s3)' }))} /> : <Empty title="No budgeted jobs to rank">Profit by customer needs job costs. Revenue alone says who is biggest, not who is worth it.</Empty>}
        </Panel>
      </div>
      <Panel title="Every customer invoiced this year or last" flush>
        <Table
          rowKey={(c) => c.key}
          pageSize={12}
          columns={[
            { key: 'name', label: 'Customer', render: (c) => (<>{c.name}<span class="tbl__sub">{COMPANIES[c.company].name}{c.repeat ? ' · repeat' : ''}</span></>) },
            { key: 'ytd', label: 'This year', align: 'r', render: (c) => money(c.ytd) },
            { key: 'prevFull', label: 'Last year', align: 'r', render: (c) => money(c.prevFull) },
            { key: 'open', label: 'Owes now', align: 'r', render: (c) => (c.open ? (c.overdue ? <Pill status="watch">{money(c.open)}</Pill> : money(c.open)) : '—') },
            { key: 'avgDaysToPay', label: 'Pays in', align: 'r', render: (c) => (c.avgDaysToPay === null ? '—' : `${c.avgDaysToPay} days`) },
            { key: 'lateShare', label: 'Paid late', align: 'r', render: (c) => (c.lateShare === null ? '—' : pct(c.lateShare)) },
            { key: 'note', label: 'Your notes', sort: (c) => (c.note ? 1 : 0), render: (c) => (c.note ? <Pill status="good">on file</Pill> : <button type="button" class="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); actions.openRegister('customer_notes', { preset: { customer: c.name, company: c.company } }); }}>Add</button>) },
          ]}
          rows={d.rows.filter((c) => c.ytd > 0 || c.prevFull > 0 || c.open > 0)}
          initialSort={{ key: 'ytd', dir: -1 }}
          empty={<div class="panel__bd"><Empty title="No customers could be read" /></div>}
        />
      </Panel>
      {d.lapsed.length > 0 && (
        <Panel title="Invoiced last year, nothing this year" note="Worth a call">
          <Ranked title="Lapsed customers by last year's revenue" rows={d.lapsed.map((c) => ({ label: c.name, value: c.prevFull }))} color="var(--seq-2)" max={8} />
        </Panel>
      )}
      <div class="grid grid--2">
        <RegisterPanel regKey="customer_notes" {...reg(state, actions)} />
        <RegisterPanel regKey="issues" title="Complaints, warranty and disputes" filter={(r) => ['complaint', 'warranty', 'dispute', 'other'].includes(r.kind)} {...reg(state, actions)} />
      </div>
    </SheetFrame>
  );
}
