// One small observable store for the whole page. State is replaced, never mutated in place,
// so components can compare by reference.

const listeners = new Set();

/** @type {JarvisState} */
let state = {
  now: Date.now(),
  boot: { mcp: 'pending', db: 'pending', ai: false, aiTools: 0, speak: false, listen: false, canEdit: true, isOwner: true },
  connectors: {
    qbo: { state: 'unknown' },
    jt: { state: 'unknown' },
    gcal: { state: 'unknown' },
  },
  sources: {}, // key -> {status: 'idle'|'loading'|'ok'|'error', payload?, storedAt?, error?}
  loading: false,
  lastRefresh: 0,
  model: null,
  registers: {}, // key -> rows[]
  registersReady: false,
  registerErrors: {},
  settings: { main: {}, strategy: {}, profile: {} },
  scope: 'all',
  sheet: 'command',
  results: {}, // domainKey -> DomainResult
  fleet: null,
  ui: { drawer: null, toast: null },
};

export const getState = () => state;

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next || next === state) return;
  state = { ...state, ...next };
  for (const l of listeners) {
    try {
      l(state);
    } catch (e) {
      console.error('listener failed', e);
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let toastTimer = null;
export function toast(text, ms = 3200) {
  setState((s) => ({ ui: { ...s.ui, toast: text } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState((s) => ({ ui: { ...s.ui, toast: null } })), ms);
}

export function openDrawer(drawer) {
  setState((s) => ({ ui: { ...s.ui, drawer } }));
}
export function closeDrawer() {
  setState((s) => ({ ui: { ...s.ui, drawer: null } }));
}

/**
 * @typedef {Object} JarvisState
 * @property {number} now
 * @property {Object} boot
 * @property {Object} connectors
 * @property {Object<string, {status: string, payload?: any, storedAt?: number, error?: any}>} sources
 * @property {boolean} loading
 * @property {number} lastRefresh
 * @property {any} model
 * @property {Object<string, any[]>} registers
 * @property {boolean} registersReady
 * @property {Object} registerErrors
 * @property {{main: Object, strategy: Object, profile: Object}} settings
 * @property {'all'|'ab'|'sr'} scope
 * @property {string} sheet
 * @property {Object} results
 * @property {any} fleet
 * @property {{drawer: any, toast: string|null}} ui
 */
