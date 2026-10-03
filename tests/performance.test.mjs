/**
 * Technical-uplift suite: catalogue render reuse, search coalescing and
 * off-critical-path portrait decoding.
 *
 * These are the claims the uplifts make, so they are the claims that get
 * measured. Each one fails if the optimisation is undone.
 *
 * Run: node --test tests/performance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const frame = (win) => new Promise((r) => win.requestAnimationFrame(() => setTimeout(r, 0)));
const visibleCards = (doc) => [...doc.querySelectorAll('#dexGrid .card')].filter((c) => !c.hidden);

function launch(seed = {}, extra = {}) {
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
          if (k === 'canvas') return { width: 64, height: 64 };
          if (k === 'measureText') return () => ({ width: 120 });
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          return () => {};
        },
        set() { return true; },
      });
      window.HTMLCanvasElement.prototype.getContext = function (t) { return t === '2d' ? ctx2d() : null; };
      // Count every decoded asset image the Circuit asks for.
      const NativeImage = window.Image;
      window.__imagesRequested = [];
      window.Image = class InstrumentedImage extends NativeImage {
        constructor(...args) {
          super(...args);
          const self = this;
          let src = '';
          Object.defineProperty(self, 'src', {
            get() { return src; },
            set(v) { src = v; window.__imagesRequested.push(String(v)); },
            configurable: true,
          });
        }
      };
      if (extra.setup) extra.setup(window);
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  return { window: dom.window, errors };
}

test('catalogue: filtering reuses the built cards instead of rebuilding them', async () => {
  const { window, errors } = launch();
  await settle();
  const doc = window.document;
  const App = window.GayDexApp;

  const buildStats = App.renderStats();
  assert.equal(buildStats.gridBuilds, 1, 'the catalogue is built exactly once');
  assert.equal(buildStats.cards, 19);

  const cards = [...doc.querySelectorAll('#dexGrid .card')];
  const images = cards.map((c) => c.querySelector('img'));
  const before = App.renderStats().gridRenders;

  // Typing: five keystrokes in the same tick must coalesce into one pass.
  const search = doc.querySelector('#search');
  for (const value of ['o', 'ot', 'ott', 'otte', 'otter']) {
    search.value = value;
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  await frame(window);

  const after = App.renderStats().gridRenders;
  assert.equal(after - before, 1, `five keystrokes caused ${after - before} catalogue passes, expected 1`);
  assert.equal(App.renderStats().gridBuilds, 1, 'no rebuild happened while typing');
  const shown = visibleCards(doc).map((c) => c.dataset.id);
  assert.equal(shown.length < 19, true, 'the query narrowed the catalogue');
  for (const id of ['twink-otter', 'otter', 'mature-otter', 'mega-otter', 'silver-otter']) {
    assert.ok(shown.includes(id), `${id} matches the query`);
  }

  // Node identity is the whole point: decoded portraits survive filtering.
  const cardsAfter = [...doc.querySelectorAll('#dexGrid .card')];
  assert.equal(cardsAfter.length, 19);
  cards.forEach((card, i) => {
    assert.equal(cardsAfter[i], card, 'card elements are the same objects after filtering');
    assert.equal(cardsAfter[i].querySelector('img'), images[i], 'portrait elements are never re-created');
  });

  // And nothing was inserted or removed in the DOM tree.
  let childListMutations = 0;
  const observer = new window.MutationObserver((records) => {
    childListMutations += records.filter((r) => r.type === 'childList').length;
  });
  observer.observe(doc.querySelector('#dexGrid'), { childList: true, subtree: true });
  search.value = 'bear';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await frame(window);
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await frame(window);
  observer.takeRecords();
  assert.equal(childListMutations, 0, 'filtering mutates attributes only');
  assert.equal(visibleCards(doc).length, 19);
  assert.deepEqual(errors, []);
});

test('portraits: the Circuit does not decode nineteen portraits while booting', async () => {
  const { window } = launch();
  await settle(140);

  // Boot the Circuit through its test seam, with a stubbed renderer.
  const C = window.GayDexCircuit;
  const THREE = window.THREE;
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 620);
  const subs = [];
  const runtime = {
    camera,
    get maxAnisotropy() { return 4; },
    get quality() { return { ...C.QUALITY.auto }; },
    onFrame(fn) { subs.push(fn); return () => {}; },
    onTelemetry() {}, onError() {},
    resize() {}, suspend() {}, resume() {}, isRunning() { return true; },
    setQuality() {}, setReducedMotion() {}, dispose() { subs.length = 0; },
  };
  // The application layer pre-warms its default duelists; the Circuit's own
  // nineteen portraits must not join them on the boot critical path.
  const baseline = window.__imagesRequested.length;
  const api = C.boot({ support: { ok: true, revision: '186' }, factories: { createRuntime: () => runtime } });
  assert.ok(api, 'Circuit booted');

  const assets = api.assets;
  const boot = assets.statsSnapshot();
  assert.equal(window.__imagesRequested.length, baseline, 'no portrait decode was started during boot');
  assert.ok(boot.queued >= 19, `nineteen portrait handles are deferred, saw ${boot.queued}`);
  assert.equal(assets.stats.deferred, 19, 'and the deferral is counted, not accidental');

  // Walking into a district decodes the portraits that can actually be seen.
  api.enterCircuit();
  for (let i = 0; i < 200; i++) subs.slice().forEach((fn) => fn(1 / 60, i / 60, 1, { label: 'AUTO' }));
  const inView = window.__imagesRequested.length;
  assert.ok(inView > 0, 'the district the player is standing in is decoded');
  assert.ok(inView < 19, `but not the whole world at once (saw ${inView})`);

  // The idle prewarm finishes the rest without blocking anything.
  assert.equal(assets.ensure(api.adapter.entry('twink').img), assets.get(api.adapter.entry('twink').img),
    'ensure() is idempotent and returns the same texture handle');
  await settle(600);
  const circuitRequests = window.__imagesRequested.slice(baseline);
  assert.equal(circuitRequests.length, new Set(circuitRequests).size,
    'the asset pipeline never starts the same decode twice');
  // Every canonical portrait is decoded by the end of the idle pass, so nothing
  // is missing when the player travels - it just did not happen during boot.
  for (const e of window.GayDexApp.dex) {
    assert.ok(circuitRequests.includes(e.img), `${e.name} was eventually decoded`);
  }

  api.dispose();
  const snapshot = assets.statsSnapshot();
  assert.equal(snapshot.queued, 0, 'nothing is left queued after teardown');
});

test('single-file assembly: every script and partial is inlined exactly once', () => {
  const html = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');
  const markers = [
    'vendor/three.iife.min.js', 'src/battle-core.js', 'src/app.js',
    'src/circuit/00-namespace.js', 'src/circuit/05-state.js', 'src/circuit/10-assets.js',
    'src/circuit/20-runtime.js', 'src/circuit/30-geography.js', 'src/circuit/40-specimens.js',
    'src/circuit/50-input.js', 'src/circuit/60-battle3d.js', 'src/circuit/70-compare-lab.js',
    'src/circuit/80-circuit-mode.js', 'src/circuit/90-boot.js',
  ];
  for (const m of markers) {
    const banner = html.split(`/* ==== ${m} ::`).length - 1;
    assert.equal(banner, 1, `${m} is inlined exactly once`);
  }
  assert.equal(html.split('id="circuitRoot"').length - 1, 1, 'the world root renders once');
  assert.equal(html.split('id="circuitFallback"').length - 1, 1, 'the fallback notice renders once');
  assert.equal(html.split('<script>').length - 1, 1, 'one inline script block, no external requests');
  // No runtime dependency on a network: no src/href to a remote origin.
  assert.equal(/(?:src|href)\s*=\s*["']https?:\/\//i.test(html), false, 'no external asset references');
});
