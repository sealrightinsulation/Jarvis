// "Ask Jarvis": Claude, called from the page on the viewer's own account.
// Memory-less by contract: every call carries the rules, the data digest and the conversation.

import { cap } from './claude.js';

let limitsMemo = null;

export async function aiAvailable() {
  return !!(await cap('sample'));
}

export async function aiLimits() {
  if (limitsMemo) return limitsMemo;
  const sample = await cap('sample');
  if (!sample) return (limitsMemo = { available: false, tools: 0 });
  try {
    const l = await sample.limits();
    limitsMemo = { available: true, tools: (l && l.tools && l.tools.maxCount) || 0, maxPromptBytes: (l && l.maxPromptBytes) || 262144 };
  } catch {
    limitsMemo = { available: true, tools: 0, maxPromptBytes: 262144 };
  }
  return limitsMemo;
}

/** Viewer-facing copy per failure code. `hide: true` means stop offering the feature this visit. */
export function explainAiError(code) {
  switch (code) {
    case 'cancelled':
      return { text: '', hide: false, silent: true };
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return { text: 'Asking Jarvis is switched off for this page. You can turn it on from the page’s Permissions menu.', hide: true };
    case 'rate_limited':
      return { text: 'You have hit a Claude usage limit, or too many questions are running. Try again in a few minutes.', hide: false };
    case 'session_expired':
      return { text: 'Your claude.ai session expired. Sign in again, then ask once more.', hide: false };
    case 'prompt_too_large':
      return { text: 'That question pulled in too much data at once. Ask about one area or one job at a time.', hide: false };
    case 'refused':
      return { text: 'Claude declined to answer that. Try rephrasing the question.', hide: false };
    case 'empty_completion':
      return { text: 'No answer came back. Try a simpler question.', hide: false };
    case 'tools_unavailable':
      return { text: 'This view cannot let Jarvis look things up live. Answers will use the summary only.', hide: false };
    default:
      return { text: 'The answer was interrupted. Press Ask to try again.', hide: false };
  }
}

/**
 * Ask Claude. Resolves {ok, text, truncated} or {ok:false, code, text?}. Never throws.
 * @param {string | {role:'user'|'assistant', content:string}[]} input
 * @param {{onText?: (t:string)=>void, signal?: AbortSignal, tools?: any[], tier?: 'default'|'complex'|'quick', cache?: boolean|object}} [opts]
 */
export async function ask(input, opts = {}) {
  const sample = await cap('sample');
  if (!sample) return { ok: false, code: 'capability_disabled' };
  const options = {};
  if (opts.onText) options.onText = ({ text }) => opts.onText(text);
  if (opts.signal) options.signal = opts.signal;
  if (opts.tier) options.modelTier = opts.tier;
  if (opts.tools && opts.tools.length) {
    options.tools = opts.tools; // a call with tools is never cached; do not pass cache
  } else if (opts.cache !== undefined) {
    options.cache = opts.cache;
  }
  try {
    const res = await sample(input, options);
    return { ok: true, text: res.text, truncated: !!res.truncated };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'upstream_error', text: e && e.text };
  }
}
