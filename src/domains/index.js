// Runs every sheet's logic and seats the minion fleet. Pure: (ctx) -> everything the UI shows.

import { DOMAINS } from '../catalog/catalog.js';
import { safeCompute, coverageOf } from './contract.js';
import { seatFleet } from '../minions/engine.js';
import fin from './fin.js';
import job from './job.js';
import ppl from './ppl.js';
import sal from './sal.js';
import ops from './ops.js';
import csh from './csh.js';
import cus from './cus.js';
import eqp from './eqp.js';
import lgl from './lgl.js';
import pur from './pur.js';
import org from './org.js';
import str from './str.js';
import wkr from './wkr.js';

export const LOGIC = { fin, job, ppl, sal, ops, csh, cus, eqp, lgl, pur, org, str, wkr };
const ORDER = DOMAINS.map((d) => d.key);

/**
 * @param {Object} ctx DomainContext
 * @returns {{results: Object, fleet: Object, coverage: Object, briefing: Object}}
 */
export function computeAll(ctx) {
  const results = {};
  for (const key of ORDER) {
    if (key === 'wkr') continue;
    results[key] = safeCompute(LOGIC[key], ctx);
  }
  // The weekly review reads the other twelve sheets.
  results.wkr = safeCompute({ key: 'wkr', compute: (c) => wkr.compute(c, results) }, ctx);

  const specs = ORDER.flatMap((k) => results[k].minions);
  const fleet = seatFleet(specs, ORDER);

  const allItems = ORDER.flatMap((k) => results[k].items);
  const coverage = { overall: coverageOf(allItems), byDomain: Object.fromEntries(ORDER.map((k) => [k, coverageOf(results[k].items)])) };
  return { results, fleet, coverage };
}
