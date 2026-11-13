// A-04 Sales and pipeline: where the next dollar of revenue is coming from.
// Quotes live in two places: JobTread proposals (Advanced Builds) and QuickBooks estimates (both).

import { live, partial, blind, fixRegister, fixSettings, finalizeItems } from './contract.js';
import { minion, itemMinions } from '../minions/engine.js';
import { money, moneyShort, pct, plural, round2, toNum, shortDate, daysBetween, monthKey, addMonths } from '../app/format.js';
import { inScope, COMPANIES } from '../registers/schemas.js';
import { openQuotes, quoteOutcomes, backlog, revenueSeries, customerRollup, jtIn, companiesIn } from '../model/derive.js';

export function compute(ctx) {
  const { model, registers, settings, scope, now } = ctx;
  const s = settings.main || {};
  const stale = toNum(s.quoteStaleDays) || 14;
  const quotes = openQuotes(model, scope);
  const outcomes = quoteOutcomes(model, scope);
  const bl = backlog(model, scope);
  const rev = revenueSeries(model, scope);
  const jt = jtIn(model, scope);
  const cos = companiesIn(model, scope);
  const it = {};
  const quotesLoaded = outcomes.loaded;
  const quoteValue = round2(quotes.reduce((t, q) => t + q.value, 0));
  const staleQuotes = quotes.filter((q) => q.ageDays !== null && q.ageDays > stale);

  // ---- pipeline ----
  const stages = jt ? ['lead', 'estimating', 'quoted', 'active', 'lost'].map((st) => ({ stage: st, jobs: jt.jobs.filter((j) => j.stage === st) })) : [];
  if (quotesLoaded) {
    it['sal.pipeline'] = live(
      `${money(quoteValue)} in ${plural(quotes.length, 'open quote')}`,
      `${jt ? `JobTread: ${stages.map((x) => `${x.jobs.length} ${x.stage}`).join(', ')}. ` : ''}Open quotes come from JobTread proposals and QuickBooks estimates, before HST.`,
      'JobTread + QuickBooks',
      'none',
    );
    it['sal.quotes_out'] = live(`${plural(quotes.length, 'quote')} awaiting an answer`, staleQuotes.length ? `${plural(staleQuotes.length, 'quote')} worth ${money(staleQuotes.reduce((t, q) => t + q.value, 0))} ${staleQuotes.length === 1 ? 'has' : 'have'} had no answer in over ${stale} days. Oldest: ${staleQuotes.slice().sort((a, b) => b.ageDays - a.ageDays)[0].customer}, ${staleQuotes.slice().sort((a, b) => b.ageDays - a.ageDays)[0].ageDays} days.` : 'All sent within the follow-up window.', 'JobTread + QuickBooks', staleQuotes.length ? 'watch' : 'good');
  } else {
    const b = blind('Quotes could not be read from JobTread or QuickBooks.');
    it['sal.pipeline'] = b;
    it['sal.quotes_out'] = b;
  }

  // ---- upcoming and signed ----
  if (bl.loaded) {
    const notStarted = jt.jobs.filter((j) => j.stage === 'active' && !j.actualCost && j.invoiced === 0);
    it['sal.upcoming'] = partial(`${money(bl.total)} signed and not yet invoiced`, `${plural(bl.jobs.filter((j) => j.remaining > 0).length, 'signed job')} with work left to bill${notStarted.length ? `; ${notStarted.length} not started` : ''}. Seal Right has no signed-work record: jobs appear only when invoiced.`, 'JobTread contracts and invoices', 'none');
    const year = String(now.getFullYear());
    const signedThisYear = jt.docs.filter((d) => d.type === 'customerOrder' && d.status === 'approved' && d.issueDate && d.issueDate.startsWith(year));
    it['sal.signed'] = live(`${money(signedThisYear.reduce((t, d) => t + d.price, 0))} signed this year`, `${plural(signedThisYear.length, 'approved proposal')} in JobTread this year, including change orders.`, 'JobTread approved proposals', 'none');
  } else {
    const b = blind(scope === 'sr' ? 'Seal Right has no signed-contract record. Accepted QuickBooks estimates are the closest thing.' : 'JobTread could not be read.');
    it['sal.upcoming'] = b;
    it['sal.signed'] = b;
  }

  // ---- acceptance rate and size ----
  if (quotesLoaded && outcomes.decided >= 3) {
    it['sal.acceptance'] = live(`${pct(outcomes.rate)} of decided quotes won`, `${outcomes.won} won, ${outcomes.lost} lost, ${outcomes.expired} expired this year${outcomes.rateByValue !== null ? `; ${pct(outcomes.rateByValue)} by dollar value` : ''}. ${outcomes.pending} still open.`, 'JobTread + QuickBooks', outcomes.rate < 0.25 ? 'watch' : 'good');
  } else if (quotesLoaded) {
    it['sal.acceptance'] = partial('Too few decided quotes', `Only ${outcomes.decided} quote${outcomes.decided === 1 ? ' has' : 's have'} been marked won, lost or expired this year. Mark quotes accepted or rejected so the rate means something.`, 'JobTread + QuickBooks', 'none');
  } else {
    it['sal.acceptance'] = blind('Quote outcomes could not be read.');
  }
  if (quotesLoaded && outcomes.won > 0) {
    it['sal.avg_size'] = live(`${money(outcomes.wonValue / outcomes.won)} average won job`, `${money(outcomes.wonValue)} across ${plural(outcomes.won, 'quote')} won this year.${quotes.length ? ` Open quotes average ${money(quoteValue / quotes.length)}.` : ''}`, 'JobTread + QuickBooks', 'none');
  } else {
    it['sal.avg_size'] = blind('No won quotes this year to average.');
  }

  // ---- acquisition cost ----
  const mk = (registers.marketing || []).filter((r) => inScope(r, scope));
  if (mk.length) {
    const spend = round2(mk.reduce((t, r) => t + (toNum(r.spend) || 0), 0));
    const leads = mk.reduce((t, r) => t + (toNum(r.leads) || 0), 0);
    const won = mk.reduce((t, r) => t + (toNum(r.jobsWon) || 0), 0);
    it['sal.cac'] = live(won ? `${money(spend / won)} per customer won` : `${money(spend)} spent, no jobs attributed`, `${money(spend)} of marketing spend, ${leads} leads${leads ? ` (${money(spend / leads)} each)` : ''}, ${won} jobs won.`, 'Your marketing log', 'none', fixRegister('marketing', 'Add a month'));
  } else {
    it['sal.cac'] = blind('Nothing records what you spend to win a customer or where leads come from.', fixRegister('marketing', 'Log marketing spend'));
  }

  // ---- repeat customers ----
  const custs = customerRollup(model, scope);
  const thisYear = custs.filter((c) => c.ytd > 0);
  if (thisYear.length && cos.some((c) => c.loaded.customersPrev)) {
    const rep = thisYear.filter((c) => c.repeat);
    it['sal.repeat'] = live(`${pct(rep.length / thisYear.length)} of this year’s customers are repeat`, `${rep.length} of ${thisYear.length} customers invoiced this year were also invoiced last year, bringing ${money(rep.reduce((t, c) => t + c.ytd, 0))} of ${money(thisYear.reduce((t, c) => t + c.ytd, 0))}.`, 'QuickBooks sales by customer', 'none');
  } else {
    it['sal.repeat'] = blind('Sales by customer for this year and last could not both be read.');
  }

  // ---- major relationships ----
  const notes = (registers.customer_notes || []).filter((r) => inScope(r, scope));
  const top = thisYear.slice().sort((a, b) => b.ytd - a.ytd).slice(0, 5);
  if (top.length) {
    const noted = top.filter((c) => notes.some((n) => n.customer && c.name.toLowerCase().includes(String(n.customer).toLowerCase().slice(0, 12))));
    it['sal.major'] = (noted.length ? live : partial)(`${top.map((c) => c.name).slice(0, 3).join(', ')}`, `Your five biggest customers this year bring ${money(top.reduce((t, c) => t + c.ytd, 0))}. Relationship notes exist for ${noted.length} of them.`, 'QuickBooks + your notes', noted.length < top.length ? 'watch' : 'good', fixRegister('customer_notes', 'Add a relationship note'));
  } else {
    it['sal.major'] = blind('No customer revenue could be read.');
  }

  // ---- tenders and competitors ----
  const tenders = (registers.tenders || []).filter((r) => inScope(r, scope));
  const liveT = tenders.filter((t) => ['watching', 'preparing', 'submitted'].includes(t.status || 'watching'));
  it['sal.tenders'] = tenders.length ? live(`${plural(liveT.length, 'open opportunity', 'open opportunities')}`, liveT.length ? liveT.slice(0, 3).map((t) => `${t.name}${t.dueDate ? ` (due ${shortDate(t.dueDate, now)})` : ''}`).join('; ') + '.' : 'Nothing currently open.', 'Your tender list', liveT.some((t) => t.dueDate && daysBetween(now, t.dueDate) <= 7 && t.status !== 'submitted') ? 'watch' : 'none', fixRegister('tenders', 'Add')) : blind('No tenders or large opportunities are being tracked.', fixRegister('tenders', 'Add a tender'));
  const comps = (registers.competitors || []).filter((r) => inScope(r, scope));
  it['sal.competitors'] = comps.length ? live(`${plural(comps.length, 'competitor')} on file`, comps.filter((c) => c.pricing).slice(0, 3).map((c) => `${c.name}: ${c.pricing}`).join('; ') || 'No pricing recorded yet.', 'Your competitor notes', 'none', fixRegister('competitors', 'Add')) : blind('No competitor pricing is recorded. Note it whenever you lose a quote on price.', fixRegister('competitors', 'Add a competitor'));

  // ---- revenue forecast 3 / 6 / 12 months ----
  let fc = null;
  if (rev.loaded && rev.ttm !== null) {
    const monthlyRun = rev.ttm / 12;
    const winRate = outcomes.rate !== null && outcomes.decided >= 3 ? outcomes.rate : null;
    const weighted = winRate !== null ? quoteValue * winRate : null;
    const base = (bl.loaded ? bl.total : 0) + (weighted || 0);
    fc = { monthlyRun: round2(monthlyRun), backlog: bl.loaded ? bl.total : null, weighted: weighted !== null ? round2(weighted) : null, winRate, runOnly: { m3: round2(monthlyRun * 3), m6: round2(monthlyRun * 6), m12: round2(monthlyRun * 12) } };
    it['sal.forecast'] = partial(
      `${moneyShort(fc.runOnly.m3)} / ${moneyShort(fc.runOnly.m6)} / ${moneyShort(fc.runOnly.m12)} at the current pace`,
      `Next 3, 6 and 12 months if invoicing continues at the last-12-month average of ${money(monthlyRun)} a month. Against that: ${bl.loaded ? `${money(bl.total)} signed and unbilled` : 'no signed-work record'}${weighted !== null ? ` and ${money(weighted)} of open quotes weighted at your ${pct(winRate)} win rate` : ''}. A projection, not a promise.`,
      'QuickBooks revenue, JobTread contracts and quotes',
      bl.loaded && base < monthlyRun * 3 ? 'watch' : 'none',
    );
  } else {
    it['sal.forecast'] = blind('Revenue history could not be read to project from.');
  }

  const items = finalizeItems('sal', it);

  // ---- minions ----
  const minions = [...itemMinions('sal', items)];
  for (const q of quotes) {
    const st = q.ageDays === null ? 'clear' : q.ageDays > stale * 3 ? 'alert' : q.ageDays > stale ? 'watch' : 'clear';
    minions.push(minion(`sal.quote:${q.id}`, 'sal', 'Quote follow-up', `${q.customer} · ${q.title}`, st, `${money(q.value)} quoted ${q.date ? shortDate(q.date, now) : 'on an unknown date'}${q.ageDays !== null ? `, ${q.ageDays} days ago` : ''} via ${q.system}. No answer recorded.`, { weight: Math.min(80, 30 + (q.ageDays || 0) / 2), amount: q.value, action: st !== 'clear' ? { label: 'Draft a follow-up', go: { ask: `Draft a short follow-up to ${q.customer} about the ${money(q.value)} quote (${q.title}) sent ${q.ageDays} days ago. Friendly, specific, asks for a decision or a call.` } } : undefined }));
  }
  if (jt) {
    const recent = monthKey(addMonths(now, -2));
    for (const d of jt.docs.filter((x) => x.type === 'customerOrder' && x.status === 'denied' && x.issueDate && x.issueDate.slice(0, 7) >= recent)) {
      minions.push(minion(`sal.lost:${d.id}`, 'sal', 'Lost-quote reviewer', `${d.account} · ${d.job}`, 'watch', `${money(d.price)} proposal declined. Record why (price, timing, competitor) so the pattern shows.`, { weight: 28, amount: d.price, action: fixRegister('competitors', 'Note the competitor') }));
    }
    for (const j of jt.jobs.filter((x) => x.stage === 'estimating')) minions.push(minion(`sal.draft:${j.id}`, 'sal', 'Draft-quote nudger', `${j.customer} · ${j.name}`, 'watch', `A ${money(j.draftValue)} proposal is drafted but not sent.`, { weight: 32, amount: j.draftValue }));
    for (const j of jt.jobs.filter((x) => x.stage === 'lead')) minions.push(minion(`sal.lead:${j.id}`, 'sal', 'Lead tracker', `${j.customer || 'Unknown'} · ${j.name}`, 'clear', 'Open in JobTread with no proposal yet.', { weight: 8 }));
  }
  for (const t of liveT) {
    const d = t.dueDate ? daysBetween(now, t.dueDate) : null;
    minions.push(minion(`sal.tender:${t.id}`, 'sal', 'Tender deadline keeper', t.name, d !== null && d < 0 && t.status !== 'submitted' ? 'alert' : d !== null && d <= 7 && t.status !== 'submitted' ? 'watch' : 'clear', d === null ? 'No due date set.' : d < 0 ? `Bid was due ${shortDate(t.dueDate, now)}.` : `Bid due ${shortDate(t.dueDate, now)}, ${d} days away. Status: ${t.status || 'watching'}.`, { weight: 50, amount: toNum(t.value) }));
  }

  const byCompany = Object.keys(COMPANIES).filter((k) => scope === 'all' || scope === k).map((k) => ({ key: k, name: COMPANIES[k].name, quotes: quotes.filter((q) => q.company === k) }));
  const headline = [
    { label: 'Open quotes', value: quotesLoaded ? moneyShort(quoteValue) : null, blind: !quotesLoaded, hint: quotesLoaded ? `${quotes.length} out, ${staleQuotes.length} going stale` : '', health: staleQuotes.length ? 'watch' : 'none', go: { sheet: 'sal' } },
    { label: 'Signed, not yet billed', value: bl.loaded ? moneyShort(bl.total) : null, blind: !bl.loaded, hint: bl.loaded ? `${bl.jobs.length} signed jobs` : 'no contract record', go: { sheet: 'sal' } },
  ];
  return { items, headline, minions, data: { quotes, staleQuotes, stale, outcomes, backlog: bl, stages, forecast: fc, byCompany, tenders, competitors: comps, marketing: mk, loaded: quotesLoaded } };
}

export default { key: 'sal', compute };
