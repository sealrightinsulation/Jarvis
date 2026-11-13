// Runs the page's real source specs against the synthetic connector answers (no browser needed).
import { baseSpecs, expandSpecs, assertReadOnly } from '../../src/sources/specs.js';
import { SERVERS } from '../../src/platform/manifest.js';
import { respond, TODAY } from '../fixtures/synthetic.js';
import { buildModel } from '../../src/model/build.js';
import { settingsDefaults } from '../../src/registers/schemas.js';

export const NOW = new Date(2026, 10, 13);

function run(spec, opts) {
  assertReadOnly(spec);
  try {
    if (!spec.paged) return { status: 'ok', payload: respond(SERVERS[spec.connector], spec.tool, spec.input, opts), storedAt: 1, spec };
    const items = [];
    let cursor = null;
    let pages = 0;
    let total = null;
    for (;;) {
      const p = respond(SERVERS[spec.connector], spec.tool, cursor ? { ...spec.input, cursor } : spec.input, opts);
      items.push(...(p.items || []));
      pages += 1;
      if (typeof p.total_count === 'number') total = p.total_count;
      cursor = p.next_cursor || null;
      if (!cursor || pages >= (spec.paged.maxPages || 10)) break;
    }
    return { status: 'ok', payload: { items, pages, truncated: false, total_count: total }, storedAt: 1, spec };
  } catch (e) {
    return { status: 'error', error: { code: e.code || 'upstream_error', text: 'failed', fix: 'retry' }, spec };
  }
}

/** Load everything the page would load. opts.fail = {[server]: code} simulates an outage. */
export function loadSynthetic(opts = {}) {
  const done = {};
  for (const s of baseSpecs(NOW)) done[s.key] = run(s, opts);
  for (let i = 0; i < 3; i += 1) {
    const more = expandSpecs(done, NOW).filter((s) => !done[s.key]);
    if (!more.length) break;
    for (const s of more) done[s.key] = run(s, opts);
  }
  return done;
}

export function syntheticModel(opts) {
  return buildModel(loadSynthetic(opts), NOW);
}

/** A DomainContext over the synthetic model. */
export function ctxFor(scope = 'all', overrides = {}) {
  const model = overrides.model || syntheticModel(overrides.loadOpts);
  return {
    now: NOW,
    today: TODAY,
    scope,
    model,
    registers: overrides.registers || {},
    settings: { main: { ...settingsDefaults(), ...(overrides.main || {}) }, strategy: { ...settingsDefaults(), ...(overrides.strategy || {}) }, profile: overrides.profile || {} },
  };
}
