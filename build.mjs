// Builds Jarvis into one self-contained page for the Artifact tool.
//
//   dist/jarvis.html        the page body the Artifact tool publishes (title + style + markup + script)
//   dist/capabilities.json  the runtime capabilities to declare when publishing
//   dist/preview.html       a full local document that loads the page with a mock claude runtime
//                           (test/harness/mock-claude.js) for local previews and the e2e run
//
// Usage: node build.mjs [--watch-free single run]

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(root, 'src', ...p);
const dist = (...p) => path.join(root, 'dist', ...p);

const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';

async function bundle(entry, extra = {}) {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
    ...extra,
  });
  return res.outputFiles[0].text;
}

// A closing script tag inside inline JS would end the element early.
const safeInline = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

async function main() {
  await mkdir(dist(), { recursive: true });
  const [tokens, base, js] = await Promise.all([
    readFile(src('styles', 'tokens.css'), 'utf8'),
    readFile(src('styles', 'base.css'), 'utf8'),
    bundle(src('app', 'main.jsx')),
  ]);

  const page = [
    '<title>Jarvis Command Deck</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>\n${tokens}\n${base}\n</style>`,
    '<div id="jarvis-root"><noscript>Jarvis needs JavaScript.</noscript></div>',
    `<script>\n${safeInline(js)}\n</script>`,
    '',
  ].join('\n');
  await writeFile(dist('jarvis.html'), page);

  // Capabilities manifest: single source of truth lives in src/platform/manifest.js
  const { capabilities } = await import(pathToFileURL(src('platform', 'manifest.js')).href);
  await writeFile(dist('capabilities.json'), JSON.stringify(capabilities(), null, 2));

  // Local preview: same page, wrapped the way the publisher wraps it, with a mock runtime first.
  let mock = '';
  try {
    mock = await bundle(path.join(root, 'test', 'harness', 'mock-claude.js'), { minify: false });
  } catch (e) {
    mock = `console.warn('mock runtime not built: ${String(e.message).replace(/'/g, '').slice(0, 120)}')`;
  }
  const preview = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style><script>\n${safeInline(mock)}\n</script></head><body>${page}</body></html>`;
  await writeFile(dist('preview.html'), preview);

  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
  console.log(`built dist/jarvis.html (${kb(page)}), dist/preview.html, dist/capabilities.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
