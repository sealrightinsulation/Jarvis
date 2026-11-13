// JobTread payloads (Advanced Builds) -> jobs with their money, documents, schedule and logs.
//
// JobTread's own example records ("Example Customer", the Dallas "JobTread" location) are
// dropped everywhere so they never pollute a total.

import { toNum, round2, daysBetween, nameKey } from '../app/format.js';

const ok = (done, key) => (done[key] && done[key].status === 'ok' ? done[key].payload : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const n0 = (v) => round2(toNum(v) || 0);

const EXAMPLE_ACCOUNTS = new Set(['example customer', 'bootcamp', 'example vendor']);
export const isExampleAccount = (name) => EXAMPLE_ACCOUNTS.has(String(name || '').trim().toLowerCase());

function parseDocs(done) {
  const out = [];
  let loadedAny = false;
  const loaded = {};
  for (const type of ['customerOrder', 'customerInvoice', 'vendorBill', 'vendorOrder']) {
    const p = ok(done, `jt.docs.${type}`);
    loaded[type] = !!p;
    if (!p) continue;
    loadedAny = true;
    for (const d of arr(p.data && p.data.documents)) {
      if (!d || !d.id) continue;
      const account = (d.account && d.account.name) || '';
      if (isExampleAccount(account)) continue;
      out.push({
        id: String(d.id),
        type: d.type || type,
        name: d.name || '',
        number: d.number ?? null,
        subject: d.subject || '',
        status: d.status || 'draft',
        price: n0(d.price),
        priceWithTax: n0(d.priceWithTax),
        cost: n0(d.cost),
        tax: n0(d.tax),
        balance: n0(d.balance),
        amountPaid: n0(d.amountPaid),
        issueDate: d.issueDate || (d.createdAt ? String(d.createdAt).slice(0, 10) : null),
        dueDate: d.dueDate || null,
        createdAt: d.createdAt || null,
        closedAt: d.closedAt || null,
        account,
        accountId: d.account && d.account.id ? String(d.account.id) : null,
        job: (d.job && d.job.name) || '',
        jobId: d.job && d.job.id ? String(d.job.id) : null,
        jobNumber: (d.job && d.job.number) || '',
        refs: arr(d.referencedDocuments && d.referencedDocuments.nodes).map((r) => String(r.id)),
        isChangeOrder: /change\s*order/i.test(`${d.name || ''} ${d.subject || ''}`),
      });
    }
  }
  return { docs: out, loadedAny, loaded };
}

/** Expected document counts by type, to notice a truncated list. */
function parseDocCounts(done) {
  const p = ok(done, 'jt.docCounts');
  const out = {};
  for (const g of arr(p && p.data && (p.data.groups || p.data.byType))) {
    const t = g.type || g.name || g.id;
    if (t) out[t] = Number(g.count) || 0;
  }
  return out;
}

function parseBoard(done) {
  const rows = new Map();
  let loaded = false;
  for (const key of Object.keys(done)) {
    if (!key.startsWith('jt.board.')) continue;
    const p = ok(done, key);
    if (!p) continue;
    loaded = true;
    for (const j of arr(p.data && p.data.jobs)) if (j && j.id) rows.set(String(j.id), j);
  }
  return { rows, loaded };
}

function parseTasks(done, exampleJobIds, today) {
  const p = ok(done, 'jt.tasks');
  if (!p) return null;
  return arr(p.data && p.data.tasks)
    .filter((t) => t && t.id && !(t.job && exampleJobIds.has(String(t.job.id))) && !isExampleAccount(t.account && t.account.name))
    .map((t) => {
      const progress = toNum(t.progress);
      const done100 = progress !== null && progress >= 1;
      const late = t.endDate && !done100 ? Math.max(0, daysBetween(t.endDate, today) || 0) : 0;
      return {
        id: String(t.id),
        name: t.name || '',
        jobId: t.job && t.job.id ? String(t.job.id) : null,
        job: (t.job && t.job.name) || '',
        customer: (t.account && t.account.name) || '',
        startDate: t.startDate || null,
        endDate: t.endDate || null,
        progress,
        done: done100,
        isGroup: !!t.isGroup,
        isToDo: !!t.isToDo,
        parentId: t.parentTask && t.parentTask.id ? String(t.parentTask.id) : null,
        assignees: arr(t.assignedMemberships && t.assignedMemberships.nodes)
          .map((m) => (m && m.user && m.user.name) || (m && m.name) || '')
          .filter(Boolean),
        daysLate: late,
      };
    });
}

/**
 * @param {Object} done loader output
 * @param {Date} now
 * @returns {JobTreadView|null} null when JobTread did not answer at all
 */
export function normalizeJobTread(done, now) {
  const jobsP = ok(done, 'jt.jobs');
  const { docs, loadedAny: docsLoaded, loaded: docsLoadedByType } = parseDocs(done);
  if (!jobsP && !docsLoaded) return null;

  const rawJobs = arr(jobsP && jobsP.data && jobsP.data.jobs);
  const exampleJobIds = new Set();
  for (const j of rawJobs) {
    const acct = j && j.location && j.location.account && j.location.account.name;
    if (j && (isExampleAccount(acct) || (j.location && j.location.name === 'JobTread'))) exampleJobIds.add(String(j.id));
  }
  const board = parseBoard(done);
  const tasks = parseTasks(done, exampleJobIds, now);

  const docsByJob = new Map();
  for (const d of docs) {
    if (!d.jobId || exampleJobIds.has(d.jobId)) continue;
    if (!docsByJob.has(d.jobId)) docsByJob.set(d.jobId, []);
    docsByJob.get(d.jobId).push(d);
  }
  const tasksByJob = new Map();
  for (const t of tasks || []) {
    if (!t.jobId) continue;
    if (!tasksByJob.has(t.jobId)) tasksByJob.set(t.jobId, []);
    tasksByJob.get(t.jobId).push(t);
  }

  const logsP = ok(done, 'jt.logs');
  const logs = logsP
    ? arr(logsP.data && logsP.data.dailyLogs)
        .filter((l) => l && l.id && !(l.job && exampleJobIds.has(String(l.job.id))))
        .map((l) => ({ id: String(l.id), date: l.date || null, jobId: l.job && l.job.id ? String(l.job.id) : null, job: (l.job && l.job.name) || '', user: (l.user && l.user.name) || '', notes: String(l.notes || '').slice(0, 400) }))
    : null;
  const lastLogByJob = new Map();
  for (const l of logs || []) if (l.jobId && (!lastLogByJob.get(l.jobId) || l.date > lastLogByJob.get(l.jobId))) lastLogByJob.set(l.jobId, l.date);

  const jobs = rawJobs
    .filter((j) => j && j.id && !exampleJobIds.has(String(j.id)))
    .map((j) => {
      const id = String(j.id);
      const b = board.rows.get(id) || null;
      const dd = docsByJob.get(id) || [];
      const of = (type, ...statuses) => dd.filter((d) => d.type === type && (!statuses.length || statuses.includes(d.status)));
      const sum = (list, f) => round2(list.reduce((t, d) => t + (d[f] || 0), 0));
      const approvedOrders = of('customerOrder', 'approved').sort((a, x) => String(a.createdAt || '').localeCompare(String(x.createdAt || '')));
      const pendingOrders = of('customerOrder', 'pending');
      const draftOrders = of('customerOrder', 'draft');
      const deniedOrders = of('customerOrder', 'denied');
      const invoices = of('customerInvoice', 'approved', 'pending');
      const bills = of('vendorBill', 'approved', 'pending');
      const named = approvedOrders.filter((d) => d.isChangeOrder);
      // Change orders: documents named so; otherwise every approved order after the first.
      const changeOrders = named.length ? named : approvedOrders.slice(1);
      const original = approvedOrders.filter((d) => !changeOrders.includes(d));
      const stage = approvedOrders.length ? 'active' : pendingOrders.length ? 'quoted' : draftOrders.length ? 'estimating' : deniedOrders.length ? 'lost' : 'lead';
      const ts = (b && b.taskSummary) || {};
      const jt = tasksByJob.get(id) || [];
      const leaf = jt.filter((t) => !t.isGroup && !t.isToDo);
      const projectedCost = b ? toNum(b.projectedCost) : null;
      const projectedPrice = b ? toNum(b.projectedPrice) : null;
      const actualCost = b ? toNum(b.actualCost) : null;
      const billsCost = sum(bills, 'cost');
      return {
        id,
        name: j.name || `Job ${j.number || ''}`.trim(),
        number: j.number || '',
        customer: (j.location && j.location.account && j.location.account.name) || '',
        customerId: j.location && j.location.account && j.location.account.id ? String(j.location.account.id) : null,
        site: (j.location && j.location.name) || '',
        city: (j.location && j.location.city) || '',
        stage,
        hasBoard: !!b,
        projectedCost,
        projectedPrice,
        actualCost,
        // contract = what the customer has signed for (before tax)
        contract: sum(approvedOrders, 'price'),
        contractWithTax: sum(approvedOrders, 'priceWithTax'),
        originalContract: sum(original, 'price'),
        changeOrders: sum(changeOrders, 'price'),
        changeOrderCount: changeOrders.length,
        quoted: sum(pendingOrders, 'price'),
        quotedCost: sum(pendingOrders, 'cost'),
        quoteCount: pendingOrders.length,
        oldestQuoteDate: pendingOrders.map((d) => d.issueDate).filter(Boolean).sort()[0] || null,
        draftValue: sum(draftOrders, 'price'),
        lostValue: sum(deniedOrders, 'price'),
        invoiced: sum(invoices, 'price'),
        invoicedWithTax: sum(invoices, 'priceWithTax'),
        collected: sum(invoices, 'amountPaid'),
        arBalance: sum(invoices, 'balance'),
        billsCount: bills.length,
        billsCost,
        billsPaid: sum(bills, 'amountPaid'),
        billsUnpaid: sum(bills, 'balance'),
        billsOverdue: round2(bills.filter((d) => d.balance > 0 && d.dueDate && daysBetween(d.dueDate, now) > 0).reduce((t, d) => t + d.balance, 0)),
        progress: toNum(ts.progress),
        taskCounts: { completed: Number(ts.completed) || 0, started: Number(ts.started) || 0, unstarted: Number(ts.unstarted) || 0, overdue: Number(b && b.overdueTasks && b.overdueTasks.count) || 0 },
        startDate: ts.startDate || leaf.map((t) => t.startDate).filter(Boolean).sort()[0] || null,
        endDate: leaf.map((t) => t.endDate).filter(Boolean).sort().pop() || ts.endDate || null,
        lastLogDate: lastLogByJob.get(id) || null,
        docCount: dd.length,
      };
    });

  const paymentsP = ok(done, 'jt.payments');
  const payNodes = paymentsP && paymentsP.data && paymentsP.data.rawData && paymentsP.data.rawData.organization && paymentsP.data.rawData.organization.payments;
  const payments = paymentsP
    ? arr(payNodes && payNodes.nodes)
        .filter((p) => p && p.id && !isExampleAccount(p.account && p.account.name))
        .map((p) => ({ id: String(p.id), amount: n0(p.amount), type: p.type === 'debit' ? 'debit' : 'credit', date: p.paidAt ? String(p.paidAt).slice(0, 10) : null, account: (p.account && p.account.name) || '', accountId: p.account && p.account.id ? String(p.account.id) : null }))
    : null;

  const timeP = ok(done, 'jt.time');
  const time = timeP
    ? {
        entries: Number(timeP.data && timeP.data.totals && timeP.data.totals.entryCount) || 0,
        hours: round2((Number(timeP.data && timeP.data.totals && timeP.data.totals.totalMinutes) || 0) / 60),
        cost: n0(timeP.data && timeP.data.totals && timeP.data.totals.totalCost),
        byUser: arr(timeP.data && timeP.data.groups).map((g) => ({ name: g.label || '', entries: Number(g.entryCount) || 0, hours: round2((Number(g.totalMinutes) || 0) / 60), cost: n0(g.totalCost) })),
      }
    : null;

  const usersP = ok(done, 'jt.users');
  const users = usersP
    ? arr(usersP.data && usersP.data.memberships)
        .filter((m) => m && m.user)
        .map((m) => ({ id: String(m.user.id), name: m.user.name || '', role: (m.role && m.role.name) || '', type: (m.role && m.role.type) || '' }))
    : null;

  // Vendors, rolled up from bills.
  const vendors = new Map();
  for (const d of docs) {
    if (d.type !== 'vendorBill' && d.type !== 'vendorOrder') continue;
    if (d.status === 'draft' || d.status === 'denied') continue;
    const key = d.accountId || nameKey(d.account);
    const v = vendors.get(key) || { id: d.accountId, name: d.account || 'Unknown supplier', bills: 0, billed: 0, paid: 0, unpaid: 0, overdue: 0, pos: 0, billsWithoutPo: 0, jobs: new Set() };
    if (d.type === 'vendorOrder') v.pos += 1;
    else {
      v.bills += 1;
      v.billed = round2(v.billed + (d.cost || d.amountPaid + d.balance));
      v.paid = round2(v.paid + d.amountPaid);
      v.unpaid = round2(v.unpaid + d.balance);
      if (d.balance > 0 && d.dueDate && daysBetween(d.dueDate, now) > 0) v.overdue = round2(v.overdue + d.balance);
      if (!d.refs.length) v.billsWithoutPo += 1;
    }
    if (d.jobId) v.jobs.add(d.jobId);
    vendors.set(key, v);
  }

  const counts = parseDocCounts(done);
  const got = {};
  for (const type of ['customerOrder', 'customerInvoice', 'vendorBill', 'vendorOrder']) {
    const p = ok(done, `jt.docs.${type}`);
    got[type] = p ? arr(p.data && p.data.documents).length : null;
  }
  const short = Object.keys(counts).filter((t) => got[t] !== null && got[t] !== undefined && got[t] < counts[t]);

  return {
    loaded: { jobs: !!jobsP, board: board.loaded, docs: docsLoadedByType, payments: !!paymentsP, tasks: !!tasks, logs: !!logs, time: !!time, users: !!users },
    docsShort: short, // document types where the list came back shorter than JobTread's own count
    exampleJobsHidden: exampleJobIds.size,
    jobs,
    docs: docs.filter((d) => !d.jobId || !exampleJobIds.has(d.jobId)),
    payments,
    tasks,
    logs,
    time,
    users,
    vendors: [...vendors.values()].map((v) => ({ ...v, jobs: v.jobs.size })),
  };
}

/**
 * @typedef {Object} JobTreadView
 * @property {Object} loaded
 * @property {string[]} docsShort
 * @property {number} exampleJobsHidden
 * @property {Array} jobs
 * @property {Array} docs
 * @property {Array|null} payments
 * @property {Array|null} tasks
 * @property {Array|null} logs
 * @property {Object|null} time
 * @property {Array|null} users
 * @property {Array} vendors
 */
