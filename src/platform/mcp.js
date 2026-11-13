// Connector access. One place that knows how to call a connector tool, how to cache it,
// what each failure code means for the owner, and how to keep a burst of calls polite.

import { cap } from './claude.js';
import { SERVERS } from './manifest.js';

/** What the owner should see/do for each failure code. `fix` is the single action that helps. */
export function explainMcpError(err, connectorLabel) {
  const code = (err && err.code) || 'upstream_error';
  const name = connectorLabel || (err && err.server) || 'This connector';
  const base = { code, retryable: !!(err && err.retryable), raw: (err && err.message) || '' };
  switch (code) {
    case 'needs_reauth':
      return { ...base, kind: 'reconnect', text: `${name} needs to be reconnected.`, fix: `Reconnect ${name} in claude.ai Settings → Connectors, then press Refresh.` };
    case 'server_not_connected':
    case 'server_not_found':
      return { ...base, kind: 'missing', text: `${name} is not connected for this account.`, fix: `Add ${name} in claude.ai Settings → Connectors, then press Refresh.` };
    case 'selection_required':
      return { ...base, kind: 'choose', text: `You have more than one ${name} connector.`, fix: `Choose which ${name} connector this page should use when claude.ai asks, then press Refresh.` };
    case 'not_in_manifest':
    case 'consent_required':
    case 'approval_required':
      return { ...base, kind: 'consent', text: `${name} is not allowed for this page yet.`, fix: `Press Connect and allow ${name} when claude.ai asks.` };
    case 'blocked_by_policy':
      return { ...base, kind: 'policy', text: `Your organization blocks this ${name} tool for pages.`, fix: 'Ask your claude.ai admin to allow it, or use Jarvis without this section.' };
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return { ...base, kind: 'absent', text: 'Live connectors are not available in this view.', fix: 'Open Jarvis from claude.ai in a browser or the Claude desktop app.' };
    case 'rate_limited':
      return { ...base, kind: 'wait', text: `${name} is being called too often.`, fix: 'Wait a minute, then press Refresh.' };
    case 'server_unavailable':
      return { ...base, kind: 'wait', text: `${name} did not answer.`, fix: 'This is usually temporary. Press Refresh in a moment.' };
    case 'tool_error':
      return { ...base, kind: 'tool', text: `${name} answered with an error.`, fix: base.raw ? String(base.raw).slice(0, 240) : 'Press Refresh; if it keeps failing, the report may not exist for this company.' };
    case 'cancelled':
      return { ...base, kind: 'cancelled', text: 'The request was cancelled.', fix: 'Press Refresh.' };
    case 'user_changed':
      return { ...base, kind: 'absent', text: 'The signed-in account changed.', fix: 'Reload the page.' };
    default:
      return { ...base, kind: 'unknown', text: `${name} could not be read.`, fix: 'Press Refresh. If it keeps failing, reconnect the connector in claude.ai Settings → Connectors.' };
  }
}

const DENIAL_CODES = new Set(['needs_reauth', 'server_not_connected', 'server_not_found', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'consent_required', 'not_granted', 'selection_required']);
export const isDenial = (code) => DENIAL_CODES.has(code);

/** Run async jobs with a small concurrency limit so a refresh never floods a connector. */
export async function pool(jobs, limit = 4) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = await jobs[i]();
      } catch (e) {
        results[i] = { __error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call one read tool.
 * @param {'qbo'|'jt'|'gmail'|'gcal'} connector
 * @param {string} tool upstream tool name
 * @param {object} input
 * @param {{staleMs?: number, force?: boolean, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, payload: any, storedAt: number, cached: boolean} | {ok: false, error: {code: string, message: string, retryable?: boolean}}>}
 */
export async function readTool(connector, tool, input, opts = {}) {
  const mcp = await cap('mcp');
  if (!mcp) return { ok: false, error: { code: 'capability_disabled', message: 'mcp capability not available' } };
  const server = SERVERS[connector];
  const cache = { staleTime: opts.staleMs ?? 5 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000 };
  if (opts.force) cache.refresh = true;
  const options = opts.signal ? { cache, signal: opts.signal } : { cache };
  const attempt = async () => mcp.callTool(server, tool, input, options);
  let result;
  try {
    result = await attempt();
  } catch (e1) {
    const err = normalizeError(e1);
    if (err.retryable && !(opts.signal && opts.signal.aborted)) {
      // At most one retry per refresh, after a short randomized delay.
      await sleep(Math.min(err.retryAfterMs || 0, 15000) + 400 + Math.floor(Math.random() * 900));
      try {
        result = await attempt();
      } catch (e2) {
        return { ok: false, error: normalizeError(e2) };
      }
    } else {
      return { ok: false, error: err };
    }
  }
  const payload = result && result.payload !== undefined ? result.payload : extractPayload(result);
  const storedAt = result && result.cache && typeof result.cache.storedAt === 'number' ? result.cache.storedAt : Date.now();
  return { ok: true, payload, storedAt, cached: !!(result && result.cache) };
}

function normalizeError(e) {
  if (e && typeof e === 'object' && typeof e.code === 'string') {
    return { code: e.code, message: String(e.message || ''), retryable: e.retryable === true, retryAfterMs: e.retryAfterMs, server: e.server };
  }
  return { code: 'upstream_error', message: String((e && e.message) || e || 'unknown error') };
}

/** Fallback for runtimes that do not fill `payload`: structuredContent, else first text block parsed as JSON. */
export function extractPayload(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks.find((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (!text) return null;
  try {
    return JSON.parse(text.text);
  } catch {
    return text.text;
  }
}

/** Which declared connectors does this viewer have, and which tools? Never rejects. */
export async function listConnectors() {
  const mcp = await cap('mcp');
  if (!mcp) return null;
  try {
    const res = await mcp.listTools();
    const out = {};
    for (const key of Object.keys(SERVERS)) {
      const hit = (res.servers || []).find((s) => s.server === SERVERS[key]);
      out[key] = hit
        ? { present: true, authStatus: hit.authStatus || 'unknown', tools: (hit.tools || []).map((t) => t.name) }
        : { present: false, authStatus: 'unknown', tools: [] };
    }
    return out;
  } catch {
    return null;
  }
}

/** Drop cached reads for one connector (or all) so the next read executes fresh. */
export async function invalidate(connector) {
  const mcp = await cap('mcp');
  if (!mcp) return;
  try {
    await mcp.invalidate(connector ? SERVERS[connector] : undefined);
  } catch {
    /* nothing cached */
  }
}
