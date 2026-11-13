// Voice in and out. Both are optional: Safari, Firefox and the mobile apps have neither,
// so every control that depends on them hides itself when these resolve null.

import { cap } from './claude.js';

let tts = null;
let dictation = null;
let ready = null;

/** Resolve both namespaces up front: dictation.start() must be called synchronously from a click. */
export function preloadVoice() {
  if (!ready) {
    ready = Promise.all([cap('tts'), cap('dictation')]).then(([t, d]) => {
      tts = t;
      dictation = d;
      return { speak: !!t, listen: !!d };
    });
  }
  return ready;
}

export const canSpeak = () => !!tts;
export const canListen = () => !!dictation;

/** Split long text into lines the reader accepts (<= 1,800 chars each, at most 100). */
export function toLines(text) {
  const paras = String(text || '')
    .split(/\n{2,}|\n(?=[-•\d])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const lines = [];
  for (const p of paras) {
    if (p.length <= 1800) {
      lines.push(p);
      continue;
    }
    let rest = p;
    while (rest.length > 1800) {
      let cut = rest.lastIndexOf('. ', 1800);
      if (cut < 600) cut = 1800;
      lines.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) lines.push(rest);
  }
  return lines.slice(0, 100);
}

/**
 * Read text aloud. Must be reached from a click. Resolves {ok} or {ok:false, code, hide}.
 * `hide` means the control should disappear for this visit.
 */
export async function speak(text) {
  if (!tts) return { ok: false, code: 'unavailable', hide: true };
  const lines = toLines(text).map((t) => ({ text: t }));
  if (!lines.length) return { ok: false, code: 'invalid_argument', hide: false };
  try {
    await tts.speak(lines, { language: 'en' });
    return { ok: true };
  } catch (e) {
    const code = (e && e.code) || 'upstream_error';
    return { ok: false, code, hide: code === 'not_granted' || code === 'unavailable', reason: e && e.reason };
  }
}

export async function stopSpeaking() {
  if (!tts) return;
  try {
    await tts.stop();
  } catch {
    /* nothing playing */
  }
}

/** Subscribe to reader state ("idle" | "starting" | "speaking" | "paused"). Returns unsubscribe. */
export function onSpeakState(handler) {
  if (!tts) return () => {};
  try {
    return tts.onState((e) => handler(e.state, e.reason));
  } catch {
    return () => {};
  }
}

/**
 * Start dictation. Call SYNCHRONOUSLY from the click handler (nothing awaited before it).
 * Returns the start promise mapped to {ok} | {ok:false, code, hide}.
 */
export function startListening() {
  if (!dictation) return Promise.resolve({ ok: false, code: 'unavailable', hide: true });
  let p;
  try {
    p = dictation.start();
  } catch (e) {
    return Promise.resolve({ ok: false, code: 'upstream_error', hide: false });
  }
  return p.then(
    () => ({ ok: true }),
    (e) => {
      const code = (e && e.code) || 'upstream_error';
      return { ok: false, code, hide: code === 'not_granted' || code === 'unavailable' };
    },
  );
}

export async function stopListening() {
  if (!dictation) return;
  try {
    await dictation.stop();
  } catch {
    /* already idle */
  }
}

/** Wire dictation events. Returns one unsubscribe for all three. */
export function onDictation({ partial, final, state }) {
  if (!dictation) return () => {};
  const offs = [];
  try {
    if (partial) offs.push(dictation.onPartial((e) => partial(e.text)));
    if (final) offs.push(dictation.onFinal((e) => final(e.text)));
    if (state) offs.push(dictation.onState((e) => state(e.state, e.reason)));
  } catch {
    /* ignore */
  }
  return () => offs.forEach((off) => {
    try {
      off();
    } catch {
      /* ignore */
    }
  });
}
