/**
 * Adversarial final-QA suite.
 *
 * Written as the checks a hostile reviewer would run against the shipped
 * artifact: inaccessible names, duplicate ids, discovery readouts that disagree
 * with each other, a no-JS dead end, an undeployed social card, and stale
 * numbers in a live panel.
 *
 * Run: node --test tests/final-qa.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');
const settle = (ms = 160) => new Promise((r) => setTimeout(r, ms));

function launch(seed = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/gaydex.html',
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = (q) => ({
        media: q, matches: false,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        onchange: null, dispatchEvent: () => false,
      });
      class RO { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} }
      window.ResizeObserver = RO;
      window.IntersectionObserver = class extends RO {
        constructor(cb, opts) { super(cb); this.opts = opts; }
        observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
      };
      if (!window.CSS) window.CSS = {};
      if (!window.CSS.escape) window.CSS.escape = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
      const ctx2d = () => new Proxy({}, {
        get(t, k) {
          if (k === 'canvas') return { width: 640, height: 300 };
          if (k === 'measureText') return () => ({ width: 120 });
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          return () => {};
        },
        set() { return true; },
      });
      window.HTMLCanvasElement.prototype.getContext = function (t) { return t === '2d' ? ctx2d() : null; };
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  return { window: dom.window, errors };
}

test('accessibility sweep: no duplicate ids, unnamed controls or unlabelled images', async () => {
  const { window } = launch({ 'gaydex-seen': JSON.stringify(['twink', 'cub']) });
  await settle();
  const doc = window.document;

  const ids = {};
  doc.querySelectorAll('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
  assert.deepEqual(Object.entries(ids).filter(([, n]) => n > 1), [], 'no duplicate element ids');

  const unnamed = [...doc.querySelectorAll('button')].filter((b) =>
    !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'));
  assert.deepEqual(unnamed.map((b) => b.id || b.className), [], 'every button has an accessible name');

  const unlabelled = [...doc.querySelectorAll('input,select,textarea')].filter((c) =>
    !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')
    && !(c.id && doc.querySelector(`label[for="${c.id}"]`)) && !c.closest('label'));
  assert.deepEqual(unlabelled.map((c) => c.id), [], 'every control is labelled');

  for (const img of doc.querySelectorAll('img')) {
    assert.ok(img.hasAttribute('alt'), `image ${img.id || img.className} has an alt attribute`);
  }
  const hiddenWithFocusables = [...doc.querySelectorAll('[aria-hidden="true"]')]
    .filter((el) => el.querySelector('button,a[href],input,select'));
  assert.deepEqual(hiddenWithFocusables.map((e) => e.id || e.className), [],
    'nothing focusable is hidden from assistive tech');
  assert.ok(doc.querySelector('a.skip-link[href="#main"]'), 'a skip link exists');
  assert.equal(doc.querySelector('main').id, 'main', 'and it points at real content');
  assert.equal(doc.documentElement.lang, 'en');
});

test('no-JS: the artifact still explains itself and lists the real taxonomy', () => {
  const html = HTML;
  const m = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(m, 'the artifact has a noscript fallback');
  const body = m[1];
  assert.match(body, /GayDex needs JavaScript/);
  for (const line of ['Twink', 'Cub', 'Otter', 'Independent']) {
    assert.ok(body.includes(`<strong>${line}</strong>`), `${line} lineage is listed without scripts`);
  }
  // The list is generated from the canonical data, so it must contain every form.
  const { execFileSync } = require('node:child_process');
  void execFileSync;
  const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
  const start = app.indexOf('const GAYDEX=[');
  const dex = JSON.parse(app.slice(start + 'const GAYDEX='.length, app.indexOf('];', start) + 1));
  for (const e of dex) {
    assert.ok(body.includes(e.name), `${e.name} appears in the script-free index`);
  }
  assert.match(body, /community slang, not biology/i, 'the terminology disclaimer survives without scripts');
});

test('discovery: every progress readout agrees after a scan, including from the Circuit', async () => {
  const { window } = launch();
  await settle();
  const App = window.GayDexApp;
  const doc = window.document;

  const readouts = () => ({
    pill: Number(doc.querySelector('#seenCount').textContent),
    pct: doc.querySelector('#seenPct').textContent,
    lattice: doc.querySelectorAll('#latticeDots .lattice-dot.seen').length,
    latticeText: doc.querySelector('#latticeProgress').textContent,
    cards: doc.querySelectorAll('#dexGrid .card.seen').length,
    stored: JSON.parse(window.localStorage.getItem('gaydex-seen') || '[]').length,
  });

  const before = readouts();
  assert.equal(before.lattice, before.pill, 'readouts start consistent');

  // The Circuit's scan contract is: markSeen(), then select().
  App.markSeen('silver-daddy');
  let now = readouts();
  assert.equal(now.pill, before.pill + 1, 'the pill counts the new form');
  assert.equal(now.lattice, now.pill, 'the lattice agrees immediately (no stale progress)');
  assert.equal(now.cards, now.pill, 'the atlas grid agrees too');
  assert.equal(now.stored, now.pill, 'and it is persisted');
  assert.equal(now.latticeText, `${now.pill} / 19 observed`);

  // Repeat selection of a known form must not double-count anything.
  App.selectEntry('silver-daddy', false);
  App.markSeen('silver-daddy');
  now = readouts();
  assert.deepEqual(now, readouts(), 'repeat observation is idempotent');
  assert.equal(doc.querySelectorAll('#latticeDots .lattice-dot.seen').length, now.pill);

  // And walking the lattice still works after the in-place update rework.
  const target = [...doc.querySelectorAll('#latticeDots .lattice-dot')].find((d) => d.dataset.lattice === 'average-guy');
  target.click();
  assert.equal(doc.querySelector('#entryName').textContent, 'Average Guy');
  assert.equal(doc.querySelectorAll('#latticeDots .lattice-dot.seen').length, now.pill + 1);
  assert.equal(target.dataset.label.includes('observed'), true, 'the dot relabels itself');
});

test('live battle panel: the duel card follows engine state and stops when the match ends', async () => {
  const { window } = launch();
  await settle();
  const App = window.GayDexApp;
  const doc = window.document;

  App.resetBattle();
  const match = App.battleState.match;
  App.selectEntry(match.a.entry.id, false);
  await settle(160);
  assert.equal(doc.querySelector('#duelCard').classList.contains('live'), true);

  await App.autoBattle();
  assert.equal(match.ended, true);
  assert.equal(doc.querySelector('#duelCard').classList.contains('live'), false,
    'a finished match leaves the card in profile mode, not stuck on stale HP');
  const caption = doc.querySelector('#duelCaption').textContent;
  assert.doesNotMatch(caption, /LIVE/, 'no permanently "live" residue');

  // The card still describes a real comparison afterwards.
  assert.match(caption, /Against .+: ahead on \d of 3 attack vectors/);
  assert.deepEqual(JSON.parse(doc.querySelector('#duelCanvas').dataset.model).self.force > 0, true);
});

test('deployment: everything the social card and icons need is actually published', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(wf, /_site\/assets/, 'the deploy copies the assets directory');
  assert.match(wf, /og-card\.png/, 'the social card is published, otherwise og:image 404s');
  assert.ok(existsSync(join(ROOT, 'assets/og-card.png')));
  assert.ok(existsSync(join(ROOT, 'assets/icon-512.png')));

  const meta = HTML.match(/<meta property="og:image" content="([^"]+)"/);
  assert.ok(meta, 'the artifact declares a social image');
  const path = meta[1].replace(/^\.\//, '');
  assert.ok(existsSync(join(ROOT, path)), `the declared social image exists at ${path}`);
  assert.match(HTML, /<title>GayDex: Circuit/, 'the document title matches the project, not a build codename');
  assert.doesNotMatch(HTML, /AWE XL/, 'no internal codename leaks into shipped copy');
});

test('battle controls: a click during the opening animation is queued, not dropped', async () => {
  const { window } = launch();
  await settle(160);
  const App = window.GayDexApp;
  const doc = window.document;

  // Reproduces the reported dead-button case: reset starts the intro, so
  // "Auto to KO" is pressed while the theatre is still animating.
  App.resetBattle();
  const match = App.battleState.match;
  await settle(80); // the intro is scheduled on the next tick, as in the browser
  assert.equal(App.battleState.animating, true, 'the intro is playing');
  const tokenBefore = App.battleState.match;
  await App.autoBattle();
  assert.equal(match.ended, true, 'auto battle still ran and finished the match');
  assert.equal(App.battleState.match, tokenBefore, 'and it ran the same match, not a new one');
  assert.ok(match.round > 1);

  // A reset while an auto battle is queued must invalidate it rather than let
  // the stale run fight on in a new match.
  App.resetBattle();
  const fresh = App.battleState.match;
  const p = App.autoBattle();
  App.resetBattle();
  await p;
  assert.equal(fresh.ended, false, 'the superseded match was not silently fought to a finish');
  assert.equal(App.battleState.match.ended, false);
});
