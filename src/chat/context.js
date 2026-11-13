// What Ask Jarvis is told, and the tools it can use to look things up in the page.
// Claude is memory-less between calls, so every question carries the rules and a digest of
// the current numbers. Tools return small plain data and never reach outside the page.

import { DOMAINS, DOMAIN_BY_KEY } from '../catalog/catalog.js';
import { REGISTER_BY_KEY, REGISTERS } from '../registers/schemas.js';
import { money } from '../app/format.js';

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

export function rules(profile = {}) {
  return [
    'You are Jarvis, the private business assistant of the owner of two Ontario construction companies: Advanced Builds Inc (pole barns, barndominiums, custom homes; uses JobTread and QuickBooks) and Seal Right Insulations Inc (spray foam insulation; QuickBooks only).',
    'You answer ONLY from the data in this message and from the lookup tools. Never invent a number, a name or a date. If something is not in the data, say plainly that you cannot see it and say what would need to be recorded for you to see it.',
    'Known limits you must respect: neither QuickBooks file has expenses recorded, so profit, margins on the books and tax owing are NOT knowable from QuickBooks; book "cash" is not real; real cash comes from the bank feed or from balances the owner typed in. Job costs come from JobTread and exclude labour.',
    'Money is Canadian dollars. Be direct and brief: lead with the answer, then the two or three facts behind it, then what to do next. Plain words, no jargon, no bullet-point walls, no flattery.',
    'You are not a lawyer or an accountant. For legal or tax decisions say so in one sentence and still give the practical view.',
    'When the owner asks you to remember or record something that belongs in one of his lists (team, equipment, loans, fixed commitments, insurance, agreements, issues, customer notes, suppliers, inventory, tenders, competitors, marketing, growth plans), use the propose_record tool. It only prepares a draft the owner must confirm on screen; tell him it is ready to review.',
    profile.ownerName ? `Call the owner ${profile.ownerName}.` : '',
    profile.aboutOwner ? `About the owner: ${clip(profile.aboutOwner, 1200)}` : '',
    profile.aboutAb ? `About Advanced Builds: ${clip(profile.aboutAb, 1200)}` : '',
    profile.aboutSr ? `About Seal Right: ${clip(profile.aboutSr, 1200)}` : '',
    profile.priorities ? `What matters most to him right now: ${clip(profile.priorities, 800)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A compact, readable snapshot of every sheet. Target: a few KB. */
export function digest(state) {
  const { results, fleet, coverage, scope } = state;
  if (!results || !results.fin) return 'No data has loaded yet.';
  const lines = [`TODAY: ${state.model ? state.model.today : ''}. SCOPE ON SCREEN: ${scope === 'all' ? 'both companies' : scope === 'ab' ? 'Advanced Builds' : 'Seal Right'}.`, `COVERAGE: Jarvis can see ${coverage.overall.live} items fully, ${coverage.overall.partial} partly and ${coverage.overall.blind} not at all, out of ${coverage.overall.total}.`, ''];
  for (const d of DOMAINS) {
    const r = results[d.key];
    if (!r) continue;
    lines.push(`## ${d.sheet} ${d.title}`);
    for (const it of r.items) {
      lines.push(`- ${it.label}: ${it.coverage === 'blind' ? 'NOT VISIBLE' : it.display}${it.health !== 'none' ? ` [${it.health}]` : ''}. ${clip(it.detail, 260)}`);
    }
    lines.push('');
  }
  if (fleet) {
    lines.push('## What needs attention (from the minion fleet, most urgent first)');
    for (const m of fleet.attention.filter((x) => x.role !== 'Checklist keeper').slice(0, 30)) lines.push(`- [${m.status}] ${m.role} on ${clip(m.target, 70)}: ${clip(m.finding, 200)}`);
  }
  return lines.join('\n');
}

const find = (list, q, fields) => {
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return list;
  return list.filter((x) => fields.some((f) => String(x[f] || '').toLowerCase().includes(needle)));
};

/**
 * Page tools for Claude. `getState` returns the live store state; `propose` queues a draft
 * record for the owner to confirm (it never writes by itself).
 */
export function buildTools(getState, propose) {
  const R = () => getState().results || {};
  return [
    {
      name: 'list_jobs',
      description: 'JobTread jobs for Advanced Builds with contract, budget, projected margin, cost spent, invoiced and unpaid bills. Optional text filter on job or customer name. Returns up to 25 rows.',
      inputSchema: { type: 'object', properties: { search: { type: 'string' }, stage: { type: 'string', enum: ['active', 'quoted', 'estimating', 'lead', 'lost'] } } },
      execute: (input) => {
        const jobs = (R().job && R().job.data.jobs) || [];
        return find(jobs, input.search, ['name', 'customer'])
          .filter((j) => !input.stage || j.stage === String(input.stage))
          .slice(0, 25)
          .map((j) => ({ name: j.name, customer: j.customer, stage: j.stage, contract: j.contract, budgetCost: j.projectedCost, projectedMargin: j.projectedMargin, spent: j.actual, invoiced: j.invoiced, billsUnpaid: j.billsUnpaid, billsOverdue: j.billsOverdue, scheduleDone: j.progress, plannedFinish: j.endDate }));
      },
    },
    {
      name: 'list_invoices_owed',
      description: 'Unpaid customer invoices from QuickBooks for both companies: customer, invoice number, due date, days overdue and balance. Optional customer filter.',
      inputSchema: { type: 'object', properties: { customer: { type: 'string' }, overdue_only: { type: 'boolean' } } },
      execute: (input) => {
        const inv = (R().csh && R().csh.data.ar.invoices) || [];
        return find(inv, input.customer, ['customer'])
          .filter((i) => !input.overdue_only || i.daysOverdue > 0)
          .slice(0, 40)
          .map((i) => ({ customer: i.customer, company: i.company === 'ab' ? 'Advanced Builds' : 'Seal Right', invoice: i.number, due: i.dueDate, daysOverdue: i.daysOverdue, balance: i.balance }));
      },
    },
    {
      name: 'list_supplier_bills',
      description: 'Unpaid supplier bills from JobTread (Advanced Builds): supplier, job, due date, days past due, balance. Optional supplier filter.',
      inputSchema: { type: 'object', properties: { supplier: { type: 'string' } } },
      execute: (input) => {
        const bills = (R().csh && R().csh.data.ap.bills) || [];
        return find(bills, input.supplier, ['account']).slice(0, 40).map((b) => ({ supplier: b.account, job: b.job, due: b.dueDate, daysPastDue: b.daysOverdue, balance: b.balance }));
      },
    },
    {
      name: 'list_open_quotes',
      description: 'Quotes awaiting an answer (JobTread proposals and QuickBooks estimates): customer, title, value before HST, date sent, days out, company.',
      inputSchema: { type: 'object', properties: { customer: { type: 'string' } } },
      execute: (input) => {
        const q = (R().sal && R().sal.data.quotes) || [];
        return find(q, input.customer, ['customer', 'title']).slice(0, 40).map((x) => ({ customer: x.customer, title: x.title, value: x.value, sent: x.date, daysOut: x.ageDays, company: x.company === 'ab' ? 'Advanced Builds' : 'Seal Right', system: x.system }));
      },
    },
    {
      name: 'list_customers',
      description: 'Customers with revenue this year and last, what they owe now, average days to pay and share paid late. Optional name filter. Sorted by this year revenue.',
      inputSchema: { type: 'object', properties: { search: { type: 'string' } } },
      execute: (input) => {
        const rows = (R().cus && R().cus.data.rows) || [];
        return find(rows, input.search, ['name'])
          .sort((a, b) => b.ytd - a.ytd)
          .slice(0, 30)
          .map((c) => ({ name: c.name, company: c.company === 'ab' ? 'Advanced Builds' : 'Seal Right', revenueThisYear: c.ytd, revenueLastYear: c.prevFull, owesNow: c.open, overdue: c.overdue, avgDaysToPay: c.avgDaysToPay, shareLate: c.lateShare }));
      },
    },
    {
      name: 'cash_forecast',
      description: 'The 13-week cash forecast: starting balance, each week with money in, money out, ending balance and its largest items, plus the assumptions used.',
      execute: () => {
        const f = R().csh && R().csh.data.forecast;
        if (!f) return { error: 'Forecast not available' };
        return { start: f.start, startKnown: f.startKnown, lowPoint: f.low, notes: f.notes, weeks: f.weeks.map((w) => ({ weekOf: w.from, in: w.inflow, out: w.outflow, balance: w.balance, largest: w.items.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 4).map((i) => `${i.label} ${money(i.amount)}`) })) };
      },
    },
    {
      name: 'bank_activity',
      description: 'Bank-feed activity this year for the connected account: money in and out by month with transfers removed, money out by type, repeating payments detected, and bounced (NSF) items.',
      execute: () => {
        const b = R().fin && R().fin.data.bank;
        if (!b) return { error: 'No bank feed is connected for the scope on screen.' };
        return { cashBalance: b.cashBalance, cardOwing: b.cardOwing, uncategorizedTransactions: b.pendingReview, byMonth: b.flows.months.map((m) => ({ month: m, in: b.flows.byMonth[m].in, out: b.flows.byMonth[m].out })), outByType: b.flows.totals.byKind, repeating: b.recurring.map((r) => ({ payee: r.payee, amount: r.amount, cadence: r.cadence, next: r.nextDate })), bounced: b.nsf };
      },
    },
    {
      name: 'list_findings',
      description: 'What the minion fleet currently flags. Filter by sheet (fin, job, ppl, sal, ops, csh, cus, eqp, lgl, pur, org, str, wkr) and/or status (alert, watch, blind). Returns up to 40.',
      inputSchema: { type: 'object', properties: { sheet: { type: 'string' }, status: { type: 'string', enum: ['alert', 'watch', 'blind', 'clear'] } } },
      execute: (input) => {
        const fleet = getState().fleet;
        if (!fleet) return [];
        return fleet.seated
          .filter((m) => (!input.sheet || m.division === String(input.sheet)) && (!input.status || m.status === String(input.status)))
          .slice(0, 40)
          .map((m) => ({ sheet: (DOMAIN_BY_KEY[m.division] || {}).title, role: m.role, about: m.target, status: m.status, finding: m.finding }));
      },
    },
    {
      name: 'read_my_records',
      description: `The owner's own lists kept in Jarvis. list is one of: ${REGISTERS.filter((r) => !r.hidden).map((r) => r.key).join(', ')}. Returns up to 40 rows.`,
      inputSchema: { type: 'object', properties: { list: { type: 'string' } }, required: ['list'] },
      execute: (input) => {
        const key = String(input.list);
        if (!REGISTER_BY_KEY[key]) throw new Error(`Unknown list "${key}".`);
        return ((getState().registers || {})[key] || []).slice(0, 40);
      },
    },
    {
      name: 'propose_record',
      description: `Prepare a new entry for one of the owner's lists so he can review and save it. Does NOT save anything. list is one of: ${REGISTERS.filter((r) => !r.hidden).map((r) => r.key).join(', ')}. data uses that list's field keys. Call read_my_records first if unsure of the fields in use.`,
      inputSchema: { type: 'object', properties: { list: { type: 'string' }, data: { type: 'object' } }, required: ['list', 'data'] },
      execute: (input) => {
        const key = String(input.list);
        const schema = REGISTER_BY_KEY[key];
        if (!schema || schema.hidden) throw new Error(`Unknown list "${key}".`);
        const allowed = new Set(schema.fields.map((f) => f.key));
        const data = {};
        for (const [k, v] of Object.entries(input.data || {})) if (allowed.has(k)) data[k] = v;
        if (!Object.keys(data).length) throw new Error(`No valid fields. Valid fields for ${key}: ${[...allowed].join(', ')}`);
        propose(key, data);
        return { ok: true, message: `Draft ${schema.singular} is on screen for the owner to review and save.`, fieldsUsed: Object.keys(data), validFields: [...allowed] };
      },
    },
  ];
}
