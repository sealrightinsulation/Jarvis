// Loads every live source the page needs, politely.
//
// A SourceSpec describes one read:
//   key        unique id, e.g. 'qbo.sr.pnl'
//   connector  'qbo' | 'jt' | 'gmail' | 'gcal'
//   company    'sr' | 'ab' | null
//   label      owner-facing name for the diagnostics list, e.g. 'Seal Right profit and loss'
//   tool       upstream tool name (must be declared in src/platform/manifest.js)
//   input      JSON arguments
//   staleMs    how long a cached answer counts as fresh (default 5 min)
//   paged      optional {itemsKey, nextKey, cursorParam, maxPages}: follow the cursor and
//              concatenate items; payload becomes {items, pages, truncated, total_count}
//   optional   true when failure should not count against the connector's health
//
// Some sources can only be built once another has loaded (bank-feed rows need the list of
// connected accounts; the JobTread job board needs the job ids). Those are produced by
// `expand(key, payload, env)` functions registered alongside the specs.

import { readTool, pool, explainMcpError, isDenial } from '../platform/mcp.js';
import { CONNECTOR_LABEL } from '../platform/manifest.js';

/**
 * @param {Object} opts
 * @param {Array} opts.specs           first-wave SourceSpecs
 * @param {Function} [opts.expand]     (loadedByKey) => SourceSpec[] second-wave specs (may be called repeatedly; must be idempotent by key)
 * @param {Function} opts.onUpdate     (key, sourceState) => void, called as each source starts/finishes
 * @param {boolean} [opts.force]       bypass the cache (the Refresh button)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object>} map key -> sourceState
 */
export async function loadAll({ specs, expand, onUpdate, force = false, signal }) {
  const done = {};
  const blocked = new Map(); // connector -> error, once a denial is seen we stop hammering it

  const runOne = async (spec) => {
    if (signal && signal.aborted) return;
    const denied = blocked.get(spec.connector);
    if (denied) {
      const st = { status: 'error', error: denied, spec };
      done[spec.key] = st;
      onUpdate(spec.key, st);
      return;
    }
    onUpdate(spec.key, { status: 'loading', spec });
    const res = spec.paged ? await readPaged(spec, force, signal) : await readTool(spec.connector, spec.tool, spec.input, { staleMs: spec.staleMs, force, signal });
    let st;
    if (res.ok) {
      st = { status: 'ok', payload: res.payload, storedAt: res.storedAt, spec };
    } else {
      const explained = explainMcpError(res.error, CONNECTOR_LABEL[spec.connector]);
      st = { status: 'error', error: explained, spec };
      if (isDenial(res.error.code) && !spec.optional) blocked.set(spec.connector, explained);
    }
    done[spec.key] = st;
    onUpdate(spec.key, st);
  };

  await pool(specs.map((s) => () => runOne(s)), 4);

  // Second (and third) wave: sources that depend on what has loaded so far.
  if (expand) {
    for (let round = 0; round < 3; round += 1) {
      const more = (expand(done) || []).filter((s) => s && !done[s.key]);
      if (!more.length) break;
      await pool(more.map((s) => () => runOne(s)), 4);
    }
  }
  return done;
}

async function readPaged(spec, force, signal) {
  const { itemsKey = 'items', nextKey = 'next_cursor', cursorParam = 'cursor', maxPages = 10 } = spec.paged;
  const items = [];
  let cursor = null;
  let pages = 0;
  let storedAt = 0;
  let total = null;
  let truncated = false;
  for (;;) {
    const input = cursor ? { ...spec.input, [cursorParam]: cursor } : spec.input;
    const res = await readTool(spec.connector, spec.tool, input, { staleMs: spec.staleMs, force, signal });
    if (!res.ok) {
      // A failure after the first page still leaves a useful partial answer.
      if (pages > 0) {
        truncated = true;
        break;
      }
      return res;
    }
    const p = res.payload || {};
    const got = Array.isArray(p[itemsKey]) ? p[itemsKey] : [];
    items.push(...got);
    pages += 1;
    storedAt = storedAt ? Math.min(storedAt, res.storedAt) : res.storedAt;
    if (typeof p.total_count === 'number') total = p.total_count;
    cursor = p[nextKey] || null;
    if (!cursor) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    if (signal && signal.aborted) {
      truncated = true;
      break;
    }
  }
  return { ok: true, payload: { [itemsKey]: items, pages, truncated, total_count: total }, storedAt };
}

/** Roll per-source states up into one state per connector for the status strip. */
export function connectorHealth(sources) {
  const out = {};
  for (const st of Object.values(sources)) {
    const c = st.spec && st.spec.connector;
    if (!c) continue;
    const o = out[c] || (out[c] = { ok: 0, error: 0, loading: 0, firstError: null, oldest: 0 });
    if (st.status === 'ok') {
      o.ok += 1;
      if (st.storedAt) o.oldest = o.oldest ? Math.min(o.oldest, st.storedAt) : st.storedAt;
    } else if (st.status === 'error') {
      if (!(st.spec && st.spec.optional)) {
        o.error += 1;
        if (!o.firstError) o.firstError = st.error;
      }
    } else if (st.status === 'loading') o.loading += 1;
  }
  for (const c of Object.keys(out)) {
    const o = out[c];
    o.state = o.loading ? 'loading' : o.error && !o.ok ? 'down' : o.error ? 'partial' : o.ok ? 'ok' : 'unknown';
  }
  return out;
}
