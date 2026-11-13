// End-to-end smoke run: loads the built page with the mock runtime in a real browser, walks
// every sheet in both themes and at phone width, and fails on console errors, page overflow or
// missing content. Screenshots land in test/e2e/out/ (git-ignored).
//
//   node test/e2e/run.mjs            full run
//   node test/e2e/run.mjs --shots    also keep full-page screenshots of every sheet

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Playwright is provided by the environment (global install), so resolve it the CommonJS way.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'test', 'e2e', 'out');
const page0 = pathToFileURL(path.join(root, 'dist', 'preview.html')).href;
const SHEETS = ['command', 'fin', 'job', 'ppl', 'sal', 'ops', 'csh', 'cus', 'eqp', 'lgl', 'pur', 'org', 'str', 'wkr'];
const shots = process.argv.includes('--shots');
const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function open(query, viewport, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${page0}${query}`);
  await page.waitForFunction(() => !document.querySelector('.topbar__fresh')?.textContent.includes('Reading') && !document.querySelector('.topbar__fresh')?.textContent.includes('Starting'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

async function walk(label, query, viewport, scheme) {
  const { ctx, page, errors } = await open(query, viewport, scheme);
  for (const s of SHEETS) {
    await page.evaluate((k) => { location.hash = k === 'command' ? '' : `#${k}`; }, s);
    await page.waitForTimeout(120);
    const info = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.querySelector('.titleblock h1')?.textContent || '', text: document.getElementById('sheet')?.innerText.length || 0, bad: (document.body.innerText.match(/undefined|NaN|\[object Object\]/g) || []).length }));
    check(info.overflow <= 1, `${label} ${s}: no sideways page scroll (overflow ${info.overflow}px)`);
    check(info.title.length > 0 && info.text > 300, `${label} ${s}: renders "${info.title}" (${info.text} chars)`);
    check(info.bad === 0, `${label} ${s}: no undefined/NaN in visible text`);
    if (shots || s === 'command' || s === 'csh') await page.screenshot({ path: path.join(out, `${label}-${s}.png`), fullPage: true });
  }
  check(errors.length === 0, `${label}: no console errors${errors.length ? ` -> ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

// 1. Every sheet, desktop light and dark, phone light; with and without the owner's own records.
await walk('desktop-light', '', { width: 1440, height: 900 }, 'light');
await walk('desktop-dark-seeded', '?seed=1', { width: 1440, height: 900 }, 'dark');
await walk('phone-light-seeded', '?seed=1', { width: 400, height: 800 }, 'light');
await walk('desktop-jt-down', '?fail=jt', { width: 1280, height: 800 }, 'light');
await walk('desktop-all-down', '?fail=all', { width: 1280, height: 800 }, 'light');
await walk('desktop-no-connectors', '?nomcp=1', { width: 1280, height: 800 }, 'light');

// 2. Behaviour: numbers, scope switch, saving a record, the chat, the minion floor.
{
  const { ctx, page, errors } = await open('?seed=1', { width: 1440, height: 900 });
  const body = () => page.evaluate(() => document.body.innerText);
  let t = await body();
  check(/Good (morning|afternoon|evening), Jake\./.test(t), 'briefing greets the owner by the name on file');
  check(/\$78K|\$78,250/.test(t), 'command shows cash from the bank feed plus the typed balance (78,250)');
  check(/posted/.test(t) && /1,200/.test(t), 'minion floor reports seats out of 1,200');
  const calls = await page.evaluate(() => window.__mock.calls.map((c) => `${c.tool}:${(c.input && c.input.action) || ''}`));
  check(calls.length > 30 && !calls.some((c) => /create|update|delete|send|void|categorize/.test(c)), `only read calls were made (${calls.length} calls)`);
  const realms = await page.evaluate(() => window.__mock.calls.filter((c) => c.server === 'Intuit QuickBooks Labs').every((c) => c.input && c.input.realm_id));
  check(realms, 'every QuickBooks call names its company explicitly');

  await page.getByRole('button', { name: 'Seal Right' }).first().click();
  await page.waitForTimeout(150);
  t = await body();
  check(/\$227K/.test(t), 'switching to Seal Right shows only its revenue (227K)');
  await page.getByRole('button', { name: 'Both' }).first().click();

  await page.evaluate(() => { location.hash = '#eqp'; });
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /Add asset/ }).first().click();
  await page.fill('#f-equipment-name', 'Test trailer');
  await page.fill('#f-equipment-monthlyPayment', '450');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(200);
  t = await body();
  check(/Test trailer/.test(t) && /2 on file/.test(t), 'a new equipment record is saved and shown');
  const stored = await page.evaluate(() => [...window.__mock.store.get('equipment').values()].some((d) => d.name === 'Test trailer' && d.monthlyPayment === 450));
  check(stored, 'the record reached storage with typed values');

  await page.evaluate(() => { location.hash = '#wkr'; });
  await page.waitForTimeout(150);
  await page.check('#wk-cash');
  await page.waitForTimeout(200);
  const wk = await page.evaluate(() => { const d = [...window.__mock.store.get('weekly').entries()].find(([k]) => k === '2026-W46'); return d ? d[1] : null; });
  check(wk && wk.checks && wk.checks.cash === true, 'ticking a weekly review step saves it');

  await page.getByRole('button', { name: 'Ask Jarvis' }).first().click();
  await page.fill('#ask-input', 'Who owes me money?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Mock answer/.test(document.querySelector('.drawer')?.innerText || '') && !/Thinking/.test(document.querySelector('.drawer')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  t = await body();
  const drawerText = await page.evaluate(() => document.querySelector('.drawer')?.innerText || '(no drawer)');
  check(/Mock answer to: "Who owes me money\?"/.test(drawerText) && /looked up 3 overdue invoices/.test(drawerText), `Ask Jarvis answers and can use its lookup tools${/looked up 3/.test(drawerText) ? '' : ` -> ${drawerText.slice(0, 200).replace(/\n/g, ' / ')}`}`);
  await page.keyboard.press('Escape');

  await page.evaluate(() => { location.hash = ''; });
  await page.waitForTimeout(150);
  const seats = await page.locator('.seat:not(.seat--idle)').count();
  const idle = await page.locator('.seat--idle').count();
  check(seats > 200 && seats + idle === 1200, `floor draws ${seats} posted + ${idle} standing by = 1,200`);
  await page.locator('.seat--alert').first().click();
  await page.waitForTimeout(100);
  t = await body();
  check(/Minion report/i.test(t), 'selecting a seat opens that minion’s report');
  check(errors.length === 0, `behaviour run: no console errors${errors.length ? ` -> ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

await browser.close();
console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
process.exit(failures.length ? 1 : 0);
