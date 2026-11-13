// Formatting and date helpers. Pure functions; `now` is always passed in so everything is testable.

const CAD0 = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const CAD2 = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM0 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Parse anything money-like ("1,234.50", "$1,234", 1234.5, null) to a number or null. */
export function toNum(v) {
  if (isNum(v)) return v;
  if (typeof v === 'string') {
    const s = v.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const sum = (arr, f = (x) => x) => arr.reduce((t, x) => t + (toNum(f(x)) || 0), 0);
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** $1,234 (whole dollars). "—" for null. */
export function money(v) {
  const n = toNum(v);
  return n === null ? '—' : CAD0.format(Math.abs(n) < 0.5 ? 0 : n).replace('CA', '');
}
/** $1,234.56 */
export function money2(v) {
  const n = toNum(v);
  return n === null ? '—' : CAD2.format(n).replace('CA', '');
}
/** $1.2M / $340K / $950 for tight spaces. */
export function moneyShort(v) {
  const n = toNum(v);
  if (n === null) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${NUM1.format(a / 1e6)}M`;
  if (a >= 1e4) return `${sign}$${NUM0.format(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${NUM1.format(a / 1e3)}K`;
  return `${sign}$${NUM0.format(a)}`;
}
export function num(v, digits = 0) {
  const n = toNum(v);
  if (n === null) return '—';
  return digits ? NUM1.format(n) : NUM0.format(n);
}
/** ratio 0.234 -> "23%". */
export function pct(v, digits = 0) {
  const n = toNum(v);
  if (n === null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}
export const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || `${one}s`}`;

// ---------- dates (all local-calendar, ISO yyyy-mm-dd strings) ----------

const pad = (n) => String(n).padStart(2, '0');

/** Date -> "yyyy-mm-dd" in local time. */
export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** "yyyy-mm-dd" (or an ISO timestamp) -> local Date at midnight, or null. */
export function parseDate(s) {
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : new Date(s.getFullYear(), s.getMonth(), s.getDate());
  if (typeof s !== 'string' || !s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
/** Whole days from a to b (b - a). Accepts Dates or ISO strings; null if either is missing. */
export function daysBetween(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
/** Monday of the week containing d. */
export function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
/** ISO week id like "2026-W46". */
export function isoWeekId(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
export function addMonths(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), last));
  return x;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 13" or "Nov 13, 2025" when the year differs from `now`. */
export function shortDate(s, now) {
  const d = parseDate(s);
  if (!d) return '—';
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return now && d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}
/** "2026-11" -> "Nov 2026"; "Nov" when short. */
export function monthLabel(key, short) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return key || '';
  return short ? MONTHS[Number(m[2]) - 1] : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** "3 days overdue" / "due in 5 days" / "due today". days = today - dueDate. */
export function dueText(daysPast) {
  if (daysPast === null || daysPast === undefined) return 'no due date';
  if (daysPast > 0) return `${daysPast} day${daysPast === 1 ? '' : 's'} overdue`;
  if (daysPast === 0) return 'due today';
  return `due in ${-daysPast} day${daysPast === -1 ? '' : 's'}`;
}
/** "5 min ago", "2 h ago", "yesterday", "Nov 3". */
export function ago(ms, nowMs) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return shortDate(new Date(ms), new Date(nowMs));
}
export function clockTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Normalise a person/company name for matching across systems. */
export function nameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|ltd|limited|corp|corporation|co|llc|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const by = (f, dir = 1) => (a, b) => {
  const x = f(a);
  const y = f(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return (x < y ? -1 : 1) * dir;
};
export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
