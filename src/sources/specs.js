// Every live read Jarvis makes, in one place. All of them are reads.
//
// QuickBooks is asked the same questions for both companies (realm_id is always explicit).
// JobTread belongs to Advanced Builds. Dates are explicit local dates: both QuickBooks files
// are set to Pacific time, so "today" macros would roll over three hours late in Ontario.

import { COMPANIES } from '../registers/schemas.js';
import { isoDate, addDays } from '../app/format.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * First-wave sources.
 * @param {Date} now local "today"
 * @returns {Array} SourceSpec[] (see loader.js)
 */
export function baseSpecs(now) {
  const today = isoDate(now);
  const y = now.getFullYear();
  const jan1 = `${y}-01-01`;
  const prevJan1 = `${y - 1}-01-01`;
  const prevDec31 = `${y - 1}-12-31`;
  const qStart = isoDate(new Date(y, Math.floor(now.getMonth() / 3) * 3, 1));
  const specs = [];

  for (const c of Object.values(COMPANIES)) {
    const realm_id = c.realm;
    const q = (name, label, tool, input, extra = {}) => specs.push({ key: `qbo.${c.key}.${name}`, connector: 'qbo', company: c.key, label: `${c.name}: ${label}`, tool, input: { realm_id, ...input }, staleMs: 10 * MIN, ...extra });

    q('pnl', 'revenue and costs by month', 'reports_profit_and_loss', { period: { start: prevJan1, end: today }, summarize_by: 'Month' });
    q('bs', 'balance sheet', 'reports_balance_sheet', { period: { as_of: today } });
    q('custYtd', 'sales by customer, this year', 'reports_run', { report: 'CustomerSales', period: { start: jan1, end: today }, compare: { prior_year: true } }, { optional: true });
    q('custPrev', 'sales by customer, last year', 'reports_run', { report: 'CustomerSales', period: { start: prevJan1, end: prevDec31 } }, { optional: true, staleMs: 6 * HOUR });
    q('openInv', 'unpaid invoices', 'transactions_search', { types: ['Invoice'], status: 'open', order_by: 'due_date', order: 'asc', limit: 200 }, { paged: { maxPages: 5 } });
    q('paidInv', 'invoices paid in the last 12 months', 'transactions_search', { types: ['Invoice'], paid_from: isoDate(addDays(now, -365)), paid_to: today, limit: 200 }, { paged: { maxPages: 6 }, optional: true, staleMs: HOUR });
    q('estimates', 'estimates', 'transactions_search', { types: ['Estimate'], date_from: prevJan1, limit: 200 }, { paged: { maxPages: 6 }, optional: true, staleMs: 30 * MIN });
    q('feeds', 'bank connections', 'bank_feed_list_connections', {});
    q('recon', 'reconciliation status', 'reconciliation_list_accounts', {}, { optional: true, staleMs: 6 * HOUR });
    q('taxYtd', 'HST this year', 'reports_run', { report: 'TaxSummary', period: { start: jan1, end: today }, filters: { agency_id: '1' } }, { optional: true, staleMs: HOUR });
    q('taxQtr', 'HST this quarter', 'reports_run', { report: 'TaxSummary', period: { start: qStart, end: today }, filters: { agency_id: '1' } }, { optional: true, staleMs: HOUR });
  }

  const jt = (name, label, tool, input, extra = {}) => specs.push({ key: `jt.${name}`, connector: 'jt', company: 'ab', label: `JobTread: ${label}`, tool, input: { ...input, format: 'json' }, staleMs: 10 * MIN, ...extra });
  jt('jobs', 'open jobs', 'jobtread_jobs', { action: 'search', status: 'open' });
  jt('docs.customerOrder', 'proposals and contracts', 'jobtread_documents', { action: 'list', documentType: 'customerOrder' });
  jt('docs.customerInvoice', 'invoices', 'jobtread_documents', { action: 'list', documentType: 'customerInvoice' });
  jt('docs.vendorBill', 'supplier bills', 'jobtread_documents', { action: 'list', documentType: 'vendorBill' });
  jt('docs.vendorOrder', 'purchase orders', 'jobtread_documents', { action: 'list', documentType: 'vendorOrder' }, { optional: true });
  jt('docCounts', 'document counts', 'jobtread_documents', { action: 'list', summaryOnly: true, groupBy: 'type' }, { optional: true });
  jt('payments', 'payments', 'jobtread_payments', { action: 'list', startDate: prevJan1, endDate: today }, { optional: true });
  jt('tasks', 'schedule', 'jobtread_tasks', { action: 'list', status: 'all', taskType: 'all' }, { optional: true, staleMs: 15 * MIN });
  jt('logs', 'daily logs', 'jobtread_daily_logs', { action: 'list', startDate: isoDate(addDays(now, -120)), endDate: today }, { optional: true, staleMs: 15 * MIN });
  jt('time', 'time tracking', 'jobtread_time_report', { startDate: jan1, endDate: today, groupBy: 'user' }, { optional: true, staleMs: 30 * MIN });
  jt('users', 'users', 'jobtread_get_users', {}, { optional: true, staleMs: 6 * HOUR });

  specs.push({
    key: 'gcal.week',
    connector: 'gcal',
    company: null,
    label: 'Calendar: the next two weeks',
    tool: 'list_events',
    input: { startTime: `${today}T00:00:00`, endTime: `${isoDate(addDays(now, 14))}T23:59:59`, orderBy: 'startTime', pageSize: 100 },
    staleMs: 15 * MIN,
    optional: true,
  });

  return specs;
}

/**
 * Second-wave sources that depend on the first wave:
 *  - bank-feed rows for every connected account (this year, reviewed or not)
 *  - the JobTread job board for every open job id (one call, up to 100 jobs)
 * Idempotent: the loader drops keys it already has.
 */
export function expandSpecs(done, now) {
  const out = [];
  const jan1 = `${now.getFullYear()}-01-01`;
  for (const c of Object.values(COMPANIES)) {
    const feeds = done[`qbo.${c.key}.feeds`];
    const items = feeds && feeds.status === 'ok' && feeds.payload && Array.isArray(feeds.payload.items) ? feeds.payload.items : [];
    for (const f of items) {
      const id = f && f.account && f.account.id;
      if (!id) continue;
      for (const state of ['Pending', 'Accepted']) {
        out.push({
          key: `qbo.${c.key}.feed.${id}.${state.toLowerCase()}`,
          connector: 'qbo',
          company: c.key,
          label: `${c.name}: ${f.account.name || 'bank account'} transactions (${state === 'Pending' ? 'not yet reviewed' : 'reviewed'})`,
          tool: 'bank_feed_list_transactions',
          input: { realm_id: c.realm, account_id: String(id), state, date_from: jan1, order: 'asc', limit: 200 },
          paged: { maxPages: 15 },
          staleMs: 2 * HOUR,
          optional: true,
          meta: { accountId: String(id), state },
        });
      }
    }
  }
  const jobs = done['jt.jobs'];
  if (jobs && jobs.status === 'ok') {
    const list = (jobs.payload && jobs.payload.data && Array.isArray(jobs.payload.data.jobs) ? jobs.payload.data.jobs : []).map((j) => j && j.id).filter(Boolean);
    // The comparison tool needs at least 2 ids and takes at most 100.
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      if (chunk.length < 2) continue;
      out.push({
        key: `jt.board.${i / 100}`,
        connector: 'jt',
        company: 'ab',
        label: 'JobTread: job costs and progress',
        tool: 'jobtread_multi_job_comparison',
        input: { jobIds: chunk, format: 'json' },
        staleMs: 10 * MIN,
      });
    }
  }
  return out;
}

/** Tools the page may call, with the only `action` values allowed for multi-action tools. */
export const READ_ACTIONS = {
  jobtread_jobs: ['search', 'get_active', 'get_details'],
  jobtread_documents: ['list', 'get_details', 'get_line_items'],
  jobtread_payments: ['list'],
  jobtread_tasks: ['list', 'get_details'],
  jobtread_daily_logs: ['list', 'get_details', 'summary'],
};

/** Refuse anything that is not a read before it leaves the page. */
export function assertReadOnly(spec) {
  const allowed = READ_ACTIONS[spec.tool];
  if (allowed && !allowed.includes(spec.input && spec.input.action)) {
    throw new Error(`Refusing non-read action "${spec.input && spec.input.action}" on ${spec.tool}`);
  }
  return spec;
}
