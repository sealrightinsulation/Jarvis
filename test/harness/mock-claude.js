// A stand-in for the claude.ai artifact runtime, for local previews and the e2e run only.
// It answers connector calls from the synthetic fixtures and keeps "database" documents in
// memory. It is never part of the published page.
//
// URL switches:  ?fail=jt | qbo | all   simulate a connector that is not connected
//                ?seed=1                start with example records in Jarvis's own lists
//                ?nomcp=1               simulate a view with no connector access at all

import { respond } from '../fixtures/synthetic.js';

const params = new URLSearchParams(location.search);
const failArg = params.get('fail');
const FAIL = {};
if (failArg === 'jt' || failArg === 'all') FAIL.Jobtread = 'server_not_connected';
if (failArg === 'qbo' || failArg === 'all') FAIL['Intuit QuickBooks Labs'] = 'needs_reauth';
if (failArg === 'all') FAIL['Google Calendar'] = 'needs_reauth';
if (!failArg) FAIL['Google Calendar'] = 'upstream_error'; // mirrors the real connector today

const calls = [];
const mcp = {
  async callTool(server, tool, input) {
    calls.push({ server, tool, input });
    await new Promise((r) => setTimeout(r, 5 + Math.floor(calls.length % 7)));
    try {
      const payload = respond(server, tool, input || {}, { fail: FAIL });
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, payload };
    } catch (e) {
      throw { code: e.code || 'upstream_error', message: e.message || 'failed', server };
    }
  },
  async listTools() {
    return { servers: [] };
  },
  async invalidate() {},
  watchTool() {
    return () => {};
  },
  async describeTool() {
    throw { code: 'bad_request', message: 'no schema in mock' };
  },
};

// ---- in-memory document store with live snapshots ----
const store = new Map(); // collection -> Map(id -> data)
const listeners = new Map(); // collection -> Set(fn)
const col = (name) => {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
};
const emit = (name) => {
  const docs = [...col(name).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, data]) => ({ id, exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } }));
  for (const fn of listeners.get(name) || []) fn({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
};
let seq = 0;
const collection = (name) => ({
  path: name,
  limit() {
    return this;
  },
  where() {
    return this;
  },
  orderBy() {
    return this;
  },
  onSnapshot(next) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(next);
    setTimeout(() => emit(name), 10);
    return () => listeners.get(name).delete(next);
  },
  doc(id) {
    const key = id || `mock_${(seq += 1)}`;
    return {
      id: key,
      path: `${name}/${key}`,
      async get() {
        const d = col(name).get(key);
        return { id: key, exists: !!d, data: () => d, metadata: {} };
      },
      async set(data) {
        col(name).set(key, JSON.parse(JSON.stringify(data)));
        emit(name);
      },
      async update(data) {
        col(name).set(key, { ...(col(name).get(key) || {}), ...data });
        emit(name);
      },
      async delete() {
        col(name).delete(key);
        emit(name);
      },
    };
  },
});
const db = { collection, doc: (path) => collection(path.split('/')[0]).doc(path.split('/')[1]) };

if (params.get('seed')) {
  const put = (c, id, data) => col(c).set(id, data);
  put('people', 'p1', { name: 'Dana Reyes', role: 'Lead installer', employment: 'employee', hourlyRate: 32, independent: 'yes', supervisorReady: 'ready', company: 'sr', active: true, crew: 'Foam 1', strengths: 'Runs the rig alone, clean work.' });
  put('people', 'p2', { name: 'Sam Okoro', role: 'Installer', employment: 'employee', hourlyRate: 24, company: 'sr', active: true, crew: 'Foam 1', independent: 'supervised' });
  for (const w of ['2026-W46', '2026-W45', '2026-W44']) {
    put('scorecards', `${w}a`, { week: w, person: 'p1', hours: 40, daysAbsent: 0, productivity: 5, quality: 4, attitude: 5, safety: 5, revenueProduced: 6000 });
    put('scorecards', `${w}b`, { week: w, person: 'p2', hours: 36, daysAbsent: 1, productivity: 2, quality: 2, attitude: 3, safety: 2, revenueProduced: 1500 });
  }
  put('equipment', 'e1', { name: 'Spray rig 1', kind: 'rig', company: 'sr', ownership: 'financed', purchaseDate: '2022-05-01', purchasePrice: 120000, usefulLifeYears: 8, salvageValue: 20000, monthlyPayment: 1500, status: 'available', nextServiceDate: '2026-11-10', insuranceExpiry: '2026-12-01', daysUsedLast30: 18 });
  put('policies', 'pol1', { name: 'Commercial general liability', kind: 'liability', provider: 'Harbour Mutual', coverage: 5000000, expiry: '2026-12-15', status: 'in_force', company: 'both' });
  put('policies', 'pol2', { name: 'WSIB clearance certificate', kind: 'wsib', expiry: '2026-11-01', company: 'both' });
  put('roles', 'r1', { title: 'Owner', holderName: 'Jake', duties: ['payroll', 'purchasing', 'customer_issues'] });
  put('roles', 'r2', { title: 'Site supervisor', holder: 'p1', reportsTo: 'r1', duties: ['crews', 'quality', 'scheduling'], spendLimit: 1000, approvesOvertime: true, backup: 'p2', responsibilities: 'Runs the foam crew day to day.' });
  put('obligations', 'o1', { name: 'Shop rent', category: 'rent', amount: 3000, frequency: 'monthly', nextDue: '2026-12-01', company: 'both' });
  put('settings', 'main', { grossMarginTarget: 0.3, payrollFrequency: 'biweekly', payrollNextDate: '2026-11-20', payrollAb: 20000, payrollSr: 6000, reserveTarget: 25000, cashAb: 60000, cashAbAsOf: '2026-11-13', revenueTargetAb: 2000000, revenueTargetSr: 400000 });
  put('settings', 'profile', { ownerName: 'Jake' });
  put('weekly', '2026-W45', { checks: {}, notes: {}, decisions: [{ id: 'd1', text: 'Call the truss supplier about the overdue bill', done: false }], closedOn: '2026-11-06', snapshot: { cash: 71000, owed: 52000, quotes: 610000 } });
}

const sample = async (input, options = {}) => {
  const last = Array.isArray(input) ? input[input.length - 1].content : String(input);
  let toolNote = '';
  if (options.tools && options.tools.length) {
    const t = options.tools.find((x) => x.name === 'list_invoices_owed');
    if (t) toolNote = ` (looked up ${(await t.execute({ overdue_only: true }, { signal: new AbortController().signal })).length} overdue invoices)`;
  }
  const text = `Mock answer to: "${last.slice(0, 80)}"${toolNote}. Start with the overdue supplier bills, then call the two customers who are late.`;
  if (options.onText) options.onText({ text, delta: text });
  return { text, truncated: false, modelTierApplied: 'default' };
};
sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
sample.json = async () => ({});

const spoken = [];
const stateHandlers = new Set();
const tts = {
  async speak(what) {
    spoken.push(what);
    stateHandlers.forEach((h) => h({ state: 'speaking' }));
    await new Promise((r) => setTimeout(r, 30));
    stateHandlers.forEach((h) => h({ state: 'idle', reason: 'completed' }));
    return { playedMs: 30 };
  },
  async stop() {},
  onState(h) {
    stateHandlers.add(h);
    return () => stateHandlers.delete(h);
  },
  active: () => false,
};

const user = { isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => 'u_mock', me: async () => ({ id: 'u_mock', name: 'Owner', isOwner: true, canEdit: true }) };
const permissions = { state: async () => 'granted', request: async () => ({}), manage: async () => {} };

const caps = { mcp: params.get('nomcp') ? null : mcp, db, sample, tts, user, permissions, dictation: null };
window.claude = { use: async (name) => (name in caps ? caps[name] : null) };
window.__mock = { calls, store, spoken };
