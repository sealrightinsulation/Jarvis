// The briefing: a few plain sentences built from what the fleet found. No AI involved, so it is
// the same every time for the same data and can be read aloud without waiting.

import { money, plural } from './format.js';

function greeting(now) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * @param {{results: Object, fleet: Object, coverage: Object}} computed
 * @param {{now: Date, name?: string, anyLive: boolean, loading: boolean}} opts
 * @returns {{headline: string, points: Array<{status: string, text: string, go?: Object}>, spoken: string}}
 */
export function buildBriefing(computed, opts) {
  const { results, fleet, coverage } = computed;
  const hello = `${greeting(opts.now)}${opts.name ? `, ${opts.name}` : ''}.`;
  if (!opts.anyLive) {
    const headline = opts.loading ? `${hello} Reading QuickBooks and JobTread now.` : `${hello} I cannot reach QuickBooks or JobTread from this view, so I can only show what you have entered yourself.`;
    return { headline, points: [], spoken: headline };
  }
  const alerts = fleet.seated.filter((m) => m.status === 'alert' && m.role !== 'Checklist keeper');
  const points = [];
  const add = (status, text, go) => {
    if (text && points.length < 6) points.push({ status, text, go });
  };
  const g = (f) => {
    try {
      return f();
    } catch {
      return null;
    }
  };

  const cash = g(() => results.csh.data.cash);
  const fc = g(() => results.csh.data.forecast);
  if (cash && cash.known) add(fc && fc.low.balance < 0 ? 'alert' : 'info', `${money(cash.amount)} in the bank${cash.complete ? '' : ' that I can see'}${fc && fc.startKnown && fc.low.balance < 0 ? `, and if every bill on record is really still owed it goes ${money(Math.abs(fc.low.balance))} short within thirteen weeks` : ''}.`, { sheet: 'csh' });
  else add('blind', 'I cannot see a bank balance for the scope you are looking at. Enter one and the cash forecast switches on.', { settings: 'main', field: 'cashAb' });

  const ar = g(() => results.csh.data.ar);
  if (ar && ar.loaded && ar.overdueTotal > 0) add('watch', `${money(ar.overdueTotal)} is overdue from ${plural(ar.overdue.length, 'invoice')}. ${ar.overdue[0].customer} is the oldest at ${ar.overdue[0].daysOverdue} days.`, { sheet: 'csh' });
  const ap = g(() => results.csh.data.ap);
  if (ap && ap.loaded && ap.overdueTotal > 0) add('alert', `JobTread shows ${money(ap.overdueTotal)} of supplier bills past due, out of ${money(ap.total)} unpaid. Any already paid by cheque or e-transfer need marking paid there, or every cash figure here is too gloomy.`, { sheet: 'csh' });

  const jobs = g(() => results.job.data.jobs.filter((j) => j.health === 'alert' && j.hasBudget && j.projectedMargin < 0)) || [];
  if (jobs.length) add('alert', `JobTread projects ${jobs[0].name} to cost ${money(-jobs[0].projectedMargin)} more than its price.${jobs.length > 1 ? ` ${jobs.length - 1} more ${jobs.length === 2 ? 'job is' : 'jobs are'} projected to lose money too.` : ''}`, { sheet: 'job', job: jobs[0].id });

  const sal = g(() => results.sal.data);
  if (sal && sal.loaded && sal.staleQuotes.length) add('watch', `${plural(sal.staleQuotes.length, 'quote')} worth ${money(sal.staleQuotes.reduce((t, q) => t + q.value, 0))} ${sal.staleQuotes.length === 1 ? 'has' : 'have'} had no answer in over ${sal.stale} days.`, { sheet: 'sal' });

  const books = g(() => results.fin.data.companies.filter((c) => c.loaded.pnl && !c.hasCosts)) || [];
  if (books.length) add('alert', `${books.map((c) => c.name).join(' and ')} ${books.length === 1 ? 'has' : 'have'} no expenses in QuickBooks, so I cannot tell you profit. I can tell you revenue, who owes you, and what moved through the bank.`, { sheet: 'fin', anchor: 'books' });

  const wk = g(() => results.wkr.data);
  if (wk && !wk.closed) add('info', `This week's review is ${wk.done ? `${wk.done} of ${wk.steps.length} steps in` : 'not started'}.`, { sheet: 'wkr' });

  const n = alerts.length;
  const headline = `${hello} ${n === 0 ? 'Nothing is on fire.' : `${n} thing${n === 1 ? ' needs' : 's need'} you.`} I can see ${Math.round(coverage.overall.score * 100)}% of what you asked to know.`;
  const spoken = [headline, ...points.map((p) => p.text)].join(' ');
  return { headline, points, spoken };
}
