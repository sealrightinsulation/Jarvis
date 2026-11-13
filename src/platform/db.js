// Jarvis's own memory: the artifact database. Holds everything no connected system knows
// (people scorecards, equipment, insurance, targets, weekly reviews ...). Top-level collections,
// one per register; documents are plain JSON objects.

import { cap } from './claude.js';

const subs = new Map(); // collection -> unsubscribe

/**
 * Subscribe once to a collection. `onRows(rows, meta)` gets [{id, ...data}] sorted by id.
 * `onError(code)` fires at most once if the subscription dies. Returns false when db is absent.
 */
export async function watchCollection(name, onRows, onError) {
  const db = await cap('db');
  if (!db) return false;
  if (subs.has(name)) return true;
  try {
    const unsub = db.collection(name).limit(1000).onSnapshot(
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...clone(d.data() || {}) }));
        onRows(rows, { fromCache: !!(snap.metadata && snap.metadata.fromCache) });
      },
      (err) => {
        subs.delete(name);
        if (onError) onError((err && err.code) || 'unavailable');
      },
    );
    subs.set(name, unsub);
    return true;
  } catch (e) {
    if (onError) onError((e && e.code) || 'unavailable');
    return false;
  }
}

export function stopWatching(name) {
  const u = subs.get(name);
  if (u) {
    try {
      u();
    } catch {
      /* already gone */
    }
    subs.delete(name);
  }
}

/** Create or replace one document. Resolves {ok, id, code?}. Never throws. */
export async function putDoc(collection, id, data) {
  const db = await cap('db');
  if (!db) return { ok: false, code: 'absent' };
  try {
    const col = db.collection(collection);
    const ref = id ? col.doc(id) : col.doc();
    await ref.set(stripUndefined(data));
    return { ok: true, id: ref.id };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'unavailable', message: e && e.message };
  }
}

export async function removeDoc(collection, id) {
  const db = await cap('db');
  if (!db) return { ok: false, code: 'absent' };
  try {
    await db.collection(collection).doc(id).delete();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'unavailable', message: e && e.message };
  }
}

export async function getDoc(collection, id) {
  const db = await cap('db');
  if (!db) return null;
  try {
    const snap = await db.collection(collection).doc(id).get();
    return snap.exists ? { id: snap.id, ...clone(snap.data() || {}) } : null;
  } catch {
    return null;
  }
}

/** Owner-facing copy for a failed write. */
export function explainDbError(code) {
  switch (code) {
    case 'absent':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return 'Saving is not available in this view. Open Jarvis from claude.ai while signed in.';
    case 'invalid_argument':
      return 'That could not be saved. You may only have view access to this page, or a field is too large.';
    case 'quota_exceeded':
      return "Jarvis's storage is full. Delete old records, then try again.";
    case 'resource_exhausted':
      return 'Too many saves at once. Wait a few seconds and try again.';
    case 'revoked':
      return 'Access to this page changed. Reload to continue.';
    default:
      return 'Could not reach storage. Check your connection and try again.';
  }
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v)));
}

/** Short, sortable, collision-resistant id for new records (no Date.now reliance for uniqueness). */
export function newId(prefix = 'r') {
  const rand = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
