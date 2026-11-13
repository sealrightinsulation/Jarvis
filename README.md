# Jarvis

An owner's command deck for **Seal Right Insulations Inc** and **Advanced Builds Inc**.

Jarvis is one private page on claude.ai. Every time it opens it reads QuickBooks (both
companies) and JobTread live through the owner's own claude.ai connectors, works out the
numbers a CEO said he should always know, and says plainly which of them it cannot see yet.
It only reads: it cannot create, change, send or delete anything in those systems.

## What is on the page

| Sheet | What it answers |
|---|---|
| A-00 Command | The briefing, the vital numbers, what needs you, connections, blind spots, the minion floor |
| A-01 Financial health | Revenue, receivables, payables, cash, tax, debt, break-even, safe to spend |
| A-02 Job profitability | Contract vs budget vs cost for every JobTread job |
| A-03 People | Roster, weekly scorecards, who is underperforming, who can lead |
| A-04 Sales and pipeline | Open quotes from both systems, win rate, backlog, pace forecast |
| A-05 Operations | Schedule slips, the next two weeks, daily logs, calendar |
| A-06 Cash management | Cash today, who owes, bills due, the 13-week forecast |
| A-07 Customers | Top customers, payment habits, lapsed customers, relationship notes |
| A-08 Equipment and vehicles | Assets, payments, service and insurance dates, depreciation |
| A-09 Legal and compliance | Insurance, WSIB, agreements, disputes, expiry watches |
| A-10 Purchasing and suppliers | Spend by supplier, terms, purchase orders, approval limits |
| A-11 Structure and leadership | Roles, who owns each duty, succession |
| A-12 Growth and strategy | Targets, concentration risk, valuation range, 1/3/5-year notes |
| A-13 Weekly review | A twelve-step weekly walk through the numbers, saved week by week |

**Minions.** A minion is one rule watching one thing (an invoice, a quote, a job, a bill, a
truck, a policy, a line of the checklist). Each sheet posts its watches after every read and
the fleet seats up to 1,200 of them by priority. They are deterministic checks, not
simulated activity: a watch with nothing to look at reports that it cannot see. Empty seats
are spare capacity that fills as records are added.

**Ask Jarvis.** A chat that answers from the numbers on the page, with lookup tools into the
loaded data, optional dictation and read-aloud. It runs on the viewer's own Claude account
and can draft entries for the owner's lists, which are only saved after he reviews them.

## Where the numbers come from

- **QuickBooks Online** (both companies): invoiced revenue by month, balance sheet, sales by
  customer, unpaid and paid invoices, estimates, HST summary, bank-feed connections and
  rows, reconciliation status.
- **JobTread** (Advanced Builds): jobs, the job board (budget, cost, progress), proposals,
  invoices, supplier bills, payments, schedule, daily logs, time, users.
- **Google Calendar**: the next two weeks (optional).
- **Jarvis's own records**: everything no connected system knows, kept in the page's private
  database (owner and editors only): team and scorecards, roles, equipment and repairs,
  loans, fixed commitments, insurance and compliance, agreements, issues, customer notes,
  suppliers, inventory, tenders, competitors, marketing, growth plans, weekly reviews, and
  the settings (bank balances, payroll, tax dates, targets, thresholds, approval limits).

Jarvis never trusts a figure it cannot stand behind. Both QuickBooks files currently hold
invoices but no expenses, so book "profit", book "cash" and "HST payable" are not presented
as real; cash comes from the bank feed or a balance the owner types in, and spending is read
from bank descriptions.

## Layout

```
src/
  app/        boot, store, formatting, the briefing
  platform/   claude.ai runtime wrappers (connectors, storage, AI, voice) and the manifest
  sources/    every live read (all read-only) and the loader
  model/      payload normalizers, bank-feed classifier, shared calculations
  calc/       the 13-week cash forecast
  catalog/    the owner's checklist: 146 items across 13 sheets
  domains/    one module per sheet: answers, minions and data, as pure functions
  minions/    the fleet engine
  registers/  schemas and the generic table/form for Jarvis's own records
  ui/         design-system components, charts, the sheets, the floor
  chat/       Ask Jarvis
  styles/     design tokens and component styles
test/
  fixtures/   SYNTHETIC connector payloads (invented names and numbers)
  unit/       model, domain, forecast and fleet tests
  harness/    a mock claude.ai runtime for local previews
  e2e/        a browser run over every sheet, theme and failure mode
```

## Working on it

```
npm install
npm test            # unit tests on synthetic data
npm run build       # dist/jarvis.html (the page), dist/capabilities.json, dist/preview.html
npm run e2e         # needs Playwright with Chromium available
```

Open `dist/preview.html` to see the page against the mock runtime. Useful switches:
`?seed=1` (example records), `?fail=jt`, `?fail=qbo`, `?fail=all`, `?nomcp=1`.

To publish, the built `dist/jarvis.html` is published as a Claude Artifact with the
capabilities in `dist/capabilities.json` (connector tools, private database, AI, voice).

## Ground rules

- **No real business data in git.** Fixtures are synthetic. Captured payloads, exports and
  anything under `private/` are ignored.
- **Read-only.** `src/sources/specs.js` is the only place calls are defined, and
  `assertReadOnly` refuses any action that is not a read before it leaves the page.
- **Never guess.** A sheet that cannot work something out reports a blind spot with the one
  step that would close it.
