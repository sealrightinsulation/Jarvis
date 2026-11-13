// The minion fleet.
//
// A minion is one narrow watch: one rule looking at one thing (an invoice, a job, a truck, a
// policy, a single line of the owner's checklist). Every refresh, each domain hands the engine
// the watches it wants posted; the engine seats up to FLEET_SIZE of them by priority and reports
// what they found. Nothing here is simulated: a seat is only "working" when a real check ran
// against real data, and a watch with nothing to look at reports "blind" instead of guessing.
//
// MinionSpec (what a domain returns):
//   id        stable unique id, e.g. "csh.overdue:inv:1042"
//   division  domain key ('fin', 'job', ...)
//   role      what kind of watch this is, e.g. "Overdue invoice chaser"
//   target    what it is watching, e.g. "INV-1042 · Fehr Residence"
//   status    'alert' | 'watch' | 'clear' | 'blind'
//   finding   one sentence in plain language: what it sees right now
//   action    optional {label, go: {sheet, register?, anchor?}}: the one thing the owner can do
//   weight    optional 0-100: how much the owner should care (money at risk, urgency)
//   amount    optional dollars at stake (used for sorting and the briefing)

export const FLEET_SIZE = 1200;

const STATUS_RANK = { alert: 0, watch: 1, blind: 2, clear: 3 };

/** Sort so the things that most need the owner come first. */
export function compareMinions(a, b) {
  const ra = STATUS_RANK[a.status] ?? 9;
  const rb = STATUS_RANK[b.status] ?? 9;
  if (ra !== rb) return ra - rb;
  const wa = a.weight ?? 0;
  const wb = b.weight ?? 0;
  if (wa !== wb) return wb - wa;
  const aa = Math.abs(a.amount ?? 0);
  const ab = Math.abs(b.amount ?? 0);
  if (aa !== ab) return ab - aa;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Seat the fleet.
 * @param {MinionSpec[]} specs every watch every domain wants posted
 * @param {string[]} divisions domain keys in sheet order
 * @returns {Fleet}
 */
export function seatFleet(specs, divisions, size = FLEET_SIZE) {
  // De-duplicate by id (first wins) and drop malformed specs rather than crash a refresh.
  const seen = new Set();
  const valid = [];
  for (const s of specs) {
    if (!s || !s.id || !s.division || seen.has(s.id)) continue;
    seen.add(s.id);
    valid.push({ ...s, status: STATUS_RANK[s.status] === undefined ? 'blind' : s.status });
  }

  // Seating priority: anything that needs attention first, then by weight. Clear watches fill
  // what is left. When more watches are wanted than seats exist, the lowest-priority ones wait.
  const ordered = [...valid].sort(compareMinions);
  const seated = ordered.slice(0, size);
  const waiting = ordered.length - seated.length;

  const byDivision = {};
  for (const d of divisions) byDivision[d] = [];
  for (const m of seated) (byDivision[m.division] || (byDivision[m.division] = [])).push(m);

  const count = (list) => {
    const c = { alert: 0, watch: 0, clear: 0, blind: 0 };
    for (const m of list) c[m.status] += 1;
    return c;
  };

  const totals = count(seated);
  const divisionStats = {};
  for (const d of Object.keys(byDivision)) divisionStats[d] = { ...count(byDivision[d]), seated: byDivision[d].length };

  return {
    size,
    seated,
    seatedCount: seated.length,
    idle: Math.max(0, size - seated.length),
    waiting,
    totals,
    byDivision,
    divisionStats,
    attention: seated.filter((m) => m.status === 'alert' || m.status === 'watch'),
    blind: seated.filter((m) => m.status === 'blind'),
  };
}

/** Helper for domains: build a spec with less typing. */
export function minion(id, division, role, target, status, finding, extra = {}) {
  return { id, division, role, target, status, finding, ...extra };
}

/**
 * Every checklist item gets one watch of its own, so a blind spot is always somebody's job.
 * @param {string} division domain key
 * @param {Array<{id, label, coverage, health, display, detail, fix}>} items results for this domain
 */
export function itemMinions(division, items) {
  return items.map((it) => {
    const status = it.coverage === 'blind' ? 'blind' : it.health === 'alert' ? 'alert' : it.health === 'watch' || it.coverage === 'partial' ? 'watch' : 'clear';
    const finding =
      it.coverage === 'blind'
        ? `Cannot see this yet. ${it.detail || ''}`.trim()
        : `${it.display || 'Tracked'}${it.detail ? `. ${it.detail}` : ''}`;
    return {
      id: `${it.id}#item`,
      division,
      role: 'Checklist keeper',
      target: it.label,
      status,
      finding,
      action: it.fix ? { label: it.fix.label, go: it.fix.go } : undefined,
      weight: it.coverage === 'blind' ? 20 : it.health === 'alert' ? 60 : 30,
    };
  });
}

/**
 * @typedef {Object} MinionSpec
 * @property {string} id
 * @property {string} division
 * @property {string} role
 * @property {string} target
 * @property {'alert'|'watch'|'clear'|'blind'} status
 * @property {string} finding
 * @property {{label: string, go?: Object}} [action]
 * @property {number} [weight]
 * @property {number} [amount]
 *
 * @typedef {Object} Fleet
 * @property {number} size
 * @property {MinionSpec[]} seated
 * @property {number} seatedCount
 * @property {number} idle
 * @property {number} waiting
 * @property {{alert:number, watch:number, clear:number, blind:number}} totals
 * @property {Object<string, MinionSpec[]>} byDivision
 * @property {Object<string, Object>} divisionStats
 * @property {MinionSpec[]} attention
 * @property {MinionSpec[]} blind
 */
