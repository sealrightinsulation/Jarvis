// Assemble the one Model every sheet reads from the loader's raw results.

import { COMPANIES } from '../registers/schemas.js';
import { isoDate, toNum, round2 } from '../app/format.js';
import { normalizeCompany } from './qbo.js';
import { normalizeJobTread } from './jobtread.js';
import { classifyBankRow, monthlyFlows, detectRecurring, nsfEvents, weeklyRunRate } from './bank.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** Bank-feed rows for one company's connected accounts, classified and rolled up. */
function buildBank(company, done, now) {
  if (!company.feeds.length) return null;
  const accounts = company.feeds.map((f) => {
    const rows = [];
    const seen = new Set();
    let truncated = false;
    let loaded = false;
    for (const state of ['pending', 'accepted']) {
      const st = done[`qbo.${company.key}.feed.${f.accountId}.${state}`];
      if (!st || st.status !== 'ok') continue;
      loaded = true;
      if (st.payload && st.payload.truncated) truncated = true;
      for (const r of arr(st.payload && st.payload.items)) {
        if (!r || r.id === undefined || seen.has(String(r.id))) continue;
        seen.add(String(r.id));
        rows.push(classifyBankRow(r, f.type));
      }
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { ...f, rows, truncated, loaded };
  });
  const cashRows = accounts.filter((a) => a.type === 'bank').flatMap((a) => a.rows);
  const cardRows = accounts.filter((a) => a.type === 'card').flatMap((a) => a.rows);
  const bankAccts = accounts.filter((a) => a.type === 'bank');
  const cardAccts = accounts.filter((a) => a.type === 'card');
  const sumBal = (list) => (list.some((a) => a.bankBalance !== null) ? round2(list.reduce((t, a) => t + (toNum(a.bankBalance) || 0), 0)) : null);
  const updated = accounts.map((a) => a.lastUpdated).filter(Boolean).sort();
  return {
    company: company.key,
    accounts,
    rowsLoaded: accounts.some((a) => a.loaded),
    truncated: accounts.some((a) => a.truncated),
    cashRows,
    cardRows,
    flows: monthlyFlows(cashRows),
    cardFlows: monthlyFlows(cardRows),
    recurring: detectRecurring([...cashRows, ...cardRows], now),
    nsf: nsfEvents(cashRows),
    runRate: weeklyRunRate(cashRows, now, 8),
    cashBalance: sumBal(bankAccts),
    cardOwing: sumBal(cardAccts),
    pendingReview: accounts.reduce((t, a) => t + a.pendingCount, 0),
    reviewedRows: [...cashRows, ...cardRows].filter((r) => !r.pending).length,
    lastUpdated: updated.length ? updated[0] : null,
  };
}

/** Calendar events, shape-tolerant (the connector's exact payload is not pinned down). */
function buildCalendar(done) {
  const st = done['gcal.week'];
  if (!st || st.status !== 'ok') return null;
  const p = st.payload || {};
  const list = arr(p.events || p.items || (p.data && (p.data.events || p.data.items)));
  const when = (v) => (v && typeof v === 'object' ? v.dateTime || v.date || v.startTime || '' : v || '');
  return {
    events: list
      .map((e) => ({
        id: String(e.id || e.eventId || ''),
        title: e.summary || e.title || '(untitled)',
        start: String(when(e.start || e.startTime)),
        end: String(when(e.end || e.endTime)),
        location: e.location || '',
        attendees: arr(e.attendees).length,
        allDay: !!(e.start && typeof e.start === 'object' && e.start.date && !e.start.dateTime),
      }))
      .filter((e) => e.start),
  };
}

/**
 * @param {Object} done loader output (key -> {status, payload, storedAt, error, spec})
 * @param {Date} now local today
 */
export function buildModel(done, now) {
  const companies = {};
  for (const c of Object.values(COMPANIES)) companies[c.key] = normalizeCompany(c, done, now);
  const banks = {};
  for (const c of Object.values(COMPANIES)) banks[c.key] = buildBank(companies[c.key], done, now);

  const missing = [];
  let oldest = 0;
  for (const st of Object.values(done)) {
    if (!st || !st.spec) continue;
    if (st.status === 'error') missing.push({ key: st.spec.key, label: st.spec.label, connector: st.spec.connector, company: st.spec.company, optional: !!st.spec.optional, error: st.error });
    if (st.status === 'ok' && st.storedAt) oldest = oldest ? Math.min(oldest, st.storedAt) : st.storedAt;
  }

  return {
    today: isoDate(now),
    companies,
    banks, // per company; today only Seal Right's file has connected feeds
    jt: normalizeJobTread(done, now),
    cal: buildCalendar(done),
    missing,
    loadedAt: oldest,
    anyLive: Object.values(done).some((st) => st && st.status === 'ok'),
  };
}
