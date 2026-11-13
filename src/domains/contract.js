// The contract every sheet (domain) follows.
//
// A domain module default-exports:
//   { key, compute(ctx) -> DomainResult, Sheet }            (Sheet is a Preact component)
//
// compute(ctx) is PURE: same inputs, same output, no I/O, no Date.now(). It must never throw on
// missing data: anything it cannot work out becomes a blind item that says what is missing and
// how to fix it. It must never invent a number.
//
// ctx (DomainContext):
//   now        Date           today at local midnight
//   today      string         'yyyy-mm-dd'
//   scope      'all'|'ab'|'sr'  which company the owner is looking at
//   model      Model          normalized live data (src/model/types.js). Sections that failed to
//                             load are null/empty and listed in model.missing
//   registers  {[key]: row[]} Jarvis's own records (src/registers/schemas.js); filter with inScope()
//   settings   {main, strategy, profile}  owner-typed settings with defaults applied
//
// DomainResult:
//   items     ItemResult[]   one per catalogue item of this domain, in catalogue order
//   headline  Headline[]     2-4 numbers for the Command sheet
//   minions   MinionSpec[]   every watch this domain wants posted (see src/minions/engine.js)
//   data      object         anything this domain's own Sheet needs (tables, chart series)
//
// ItemResult:
//   id        catalogue id, e.g. 'fin.revenue'
//   label     catalogue label
//   coverage  'live' | 'partial' | 'blind'     can Jarvis see this at all?
//   health    'good' | 'watch' | 'alert' | 'none'   is it OK? ('none' = not judged)
//   display   short value text, e.g. '$234,518 this year'  ('' when blind)
//   detail    one plain sentence: how it was worked out, or exactly what is missing
//   source    where it came from, e.g. 'QuickBooks · Seal Right', 'JobTread', 'Your equipment list'
//   fix       optional {label, go}: the one thing the owner can do to cover or improve it
//             go: {sheet?: string, register?: string, settings?: 'main'|'strategy'|'profile', field?: string, ask?: string}
//
// Headline: {label, value, hint?, health?, blind?: boolean, go?: {sheet}}

import { ITEMS_BY_DOMAIN } from '../catalog/catalog.js';

export const live = (display, detail, source, health = 'none', fix) => ({ coverage: 'live', health, display, detail, source, fix });
export const partial = (display, detail, source, health = 'none', fix) => ({ coverage: 'partial', health, display, detail, source, fix });
export const blind = (detail, fix, source = '') => ({ coverage: 'blind', health: 'none', display: '', detail, source, fix });

/** Shorthand for the common fixes. */
export const fixRegister = (register, label) => ({ label, go: { register } });
export const fixSettings = (doc, field, label) => ({ label, go: { settings: doc, field } });
export const fixSheet = (sheet, label) => ({ label, go: { sheet } });

/**
 * Turn a map of {itemId: partialResult} into the ordered ItemResult[] for a domain.
 * Any catalogue item the domain forgot is reported blind, so a gap is visible rather than silent.
 */
export function finalizeItems(domainKey, map) {
  return ITEMS_BY_DOMAIN[domainKey].map((def) => {
    const r = map[def.id];
    if (!r) return { id: def.id, label: def.label, coverage: 'blind', health: 'none', display: '', detail: 'Jarvis does not track this yet.', source: '' };
    return { id: def.id, label: def.label, coverage: r.coverage, health: r.health || 'none', display: r.display || '', detail: r.detail || '', source: r.source || '', fix: r.fix || undefined };
  });
}

/** Coverage counts for a set of items. */
export function coverageOf(items) {
  const c = { live: 0, partial: 0, blind: 0, total: items.length };
  for (const it of items) c[it.coverage] += 1;
  c.score = c.total ? (c.live + 0.5 * c.partial) / c.total : 0;
  return c;
}

/** Run a domain's compute safely: a bug in one sheet must not blank the whole page. */
export function safeCompute(domain, ctx) {
  try {
    const r = domain.compute(ctx) || {};
    return {
      items: Array.isArray(r.items) ? r.items : finalizeItems(domain.key, {}),
      headline: Array.isArray(r.headline) ? r.headline : [],
      minions: Array.isArray(r.minions) ? r.minions : [],
      data: r.data || {},
      error: null,
    };
  } catch (e) {
    console.error(`[jarvis] ${domain.key} compute failed`, e);
    return { items: finalizeItems(domain.key, {}), headline: [], minions: [], data: {}, error: String((e && e.message) || e) };
  }
}
