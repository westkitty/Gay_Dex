/**
 * Boot resilience and build-integrity suite.
 *
 * These tests exist to fail if the hardening they describe is removed:
 *   - persisted state is untrusted input: a truncated/garbage localStorage
 *     value must not stop the terminal from booting, and ids that are no
 *     longer in the taxonomy must not inflate the observed count;
 *   - the roundtrip assembler must still prove itself on machines that do not
 *     have the pristine commit in their object store (shallow clones, CI);
 *   - the Perf HUD must show real measurements on the no-WebGL path instead of
 *     placeholder dashes.
 *
 * Run: node --test tests/resilience.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');

/**
 * Boot the real artifact. `seed` runs before the document scripts, which is
 * exactly where a hostile or corrupted localStorage value would be read.
 */
function boot(seed = {}) {
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
          if (k === 'canvas') return { width: 2, height: 2 };
          if (k === 'measureText') return () => ({ width: 10 });
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          return () => {};
        },
        set() { return true; },
      });
      window.HTMLCanvasElement.prototype.getContext = function (type) { return type === '2d' ? ctx2d() : null; };
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  return { dom, window: dom.window, errors };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('boot: corrupted localStorage does not stop the terminal, and is repaired', async () => {
  const { window, errors } = boot({
    'gaydex-seen': '{"not":"an array"',      // truncated JSON
    'gaydex-favs': 'null',                   // parses, wrong type
    'gaydex-compare': '"twink"',             // parses, wrong type
    'gaydex-selected': 'not-a-real-id',
  });
  await settle(150);

  assert.deepEqual(errors, [], 'no uncaught errors during a corrupted-storage boot');
  assert.equal(window.__GAYDEX_READY > 0, true, 'app reported ready');
  assert.equal(window.document.querySelectorAll('#dexGrid .card').length, 19, 'catalogue still renders');
  // The corrupt set is discarded entirely; the only observed form left is the
  // one the terminal opened on (viewing an entry is itself an observation).
  assert.equal(window.document.querySelector('#seenCount').textContent, '1', 'corrupt seen set is discarded');
  assert.equal(window.document.querySelector('#entryName').textContent, 'Twink', 'selection falls back to a real entry');
  // The repair is persisted, so the next boot starts clean.
  assert.equal(window.localStorage.getItem('gaydex-seen'), '["twink"]');
});

test('boot: unknown taxonomy ids are dropped instead of inflating progress', async () => {
  const { window, errors } = boot({
    'gaydex-seen': JSON.stringify(['twink', 'ghost-form', 'mega-twunk', 42, null]),
    'gaydex-favs': JSON.stringify(['cub', 'deleted-entry']),
    'gaydex-compare': JSON.stringify(['twink', 'cub', 'otter', 'bear', 'daddy']),
  });
  await settle(150);

  assert.deepEqual(errors, []);
  assert.equal(window.document.querySelector('#seenCount').textContent, '2', 'only real entries count as observed');
  assert.equal(window.document.querySelector('#seenPct').textContent, '11%');
  assert.equal(window.document.querySelector('#favCount').textContent, '1');
  const cards = [...window.document.querySelectorAll('#dexGrid .card')];
  assert.equal(cards.filter((c) => c.classList.contains('comparing')).length, 3, 'compare deck never exceeds three');
});

test('boot: removing the dead legacy canvas leaves one honest stage composition', async () => {
  const { window } = boot();
  await settle(150);
  const stage = window.document.querySelector('#stage');
  assert.ok(stage, 'stage present');
  assert.equal(stage.querySelector('canvas'), null, 'no unreferenced canvas sits above the portrait');
  assert.equal(stage.querySelectorAll('.fallback-portrait').length, 1, 'exactly one specimen canvas');
});

test('perf HUD: real measurements without WebGL, and it stops when closed', async () => {
  const { window, errors } = boot();
  await settle(150);
  const btn = window.document.querySelector('#perfBtn');
  const hud = window.document.querySelector('#perfHud');
  assert.equal(hud.classList.contains('show'), false, 'HUD starts closed');

  btn.click();
  await settle(220);
  const text = hud.textContent;
  assert.equal(hud.classList.contains('show'), true);
  assert.match(text, /FPS \d+/, `HUD shows a measured frame rate, got: ${JSON.stringify(text)}`);
  assert.match(text, /FRAME [\d.]+ms/);
  assert.match(text, /NODES \d+/);
  assert.doesNotMatch(text, /CALLS --/, 'no placeholder dashes remain');

  btn.click();
  await settle(120);
  assert.equal(hud.classList.contains('show'), false);
  assert.deepEqual(errors, []);
});

test('build: the roundtrip assembler proves itself without git history', () => {
  // GAYDEX_PRISTINE=fixture forces the path taken by shallow clones and CI
  // runners that only fetched the branch tip.
  const out = execFileSync('node', [join(ROOT, 'tools/build.mjs'), '--roundtrip'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, GAYDEX_PRISTINE: 'fixture' },
  });
  assert.match(out, /ROUNDTRIP OK/);
  assert.match(out, /source tests\/fixtures\/original-single-file\.html/);
});

test('build: the committed artifact is byte-identical to what the parts assemble', () => {
  const out = execFileSync('node', [join(ROOT, 'tools/build.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /BUILD CHECK OK/);
});

test('build inputs: the pristine fixture is present and the assembler reads it', () => {
  assert.equal(existsSync(join(ROOT, 'tests/fixtures/original-single-file.html')), true);
  const fixture = readFileSync(join(ROOT, 'tests/fixtures/original-single-file.html'), 'utf8');
  assert.ok(fixture.includes('<script>'), 'fixture is a real single-file artifact');
  assert.equal(fixture.includes('GayDexCircuit'), false, 'fixture predates the Circuit layer');
});
