/**
 * Experience-layer suite: the observation lattice, quick filters, the axis
 * legend contract, compare leaders, and the WebGL2 fallback notice.
 *
 * Every assertion runs the production artifact. If a control stops working,
 * or an explanation stops matching the engine, these fail.
 *
 * Run: node --test tests/experience.test.mjs
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
          if (k === 'canvas') return { width: 64, height: 64 };
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

test('lattice: nineteen forms, live observed state, and a working next-unobserved jump', async () => {
  const { window, errors } = launch({ 'gaydex-seen': JSON.stringify(['twink', 'twank', 'twunk']) });
  await settle();

  const doc = window.document;
  const dots = [...doc.querySelectorAll('#latticeDots .lattice-dot')];
  assert.equal(dots.length, 19, 'one dot per canonical form');
  assert.equal(dots.filter((d) => d.classList.contains('seen')).length, 3, 'observed forms are lit');
  assert.equal(doc.querySelector('#latticeProgress').textContent, '3 / 19 observed');
  assert.match(dots[0].getAttribute('aria-label'), /Twink .* Twink line, observed/);
  assert.match(dots[3].getAttribute('aria-label'), /Mega Twunk .* not yet observed/, 'unobserved forms say so');

  // The dot is a real navigator: it selects the form and marks it observed.
  dots[5].click();
  assert.equal(doc.querySelector('#entryName').textContent, 'Cub');
  assert.equal(doc.querySelector('#latticeProgress').textContent, '4 / 19 observed');
  assert.equal(JSON.parse(window.localStorage.getItem('gaydex-seen')).includes('cub'), true, 'discovery persisted');

  // Next unobserved walks the dex in order and skips what is already known.
  const next = doc.querySelector('#nextUnseenBtn');
  assert.match(next.textContent, /15 left/);
  const target = next.dataset.next;   // capture: the control retargets itself on use
  assert.ok(target);
  next.click();
  assert.equal(doc.querySelector('#entryName').textContent, window.GayDexApp.entry(target).name);
  assert.equal(JSON.parse(window.localStorage.getItem('gaydex-seen')).includes(target), true,
    'jumping to the next unobserved form also observes it');
  assert.deepEqual(errors, []);
});

test('lattice: a complete set is recognised, and the next-unobserved control retires', async () => {
  const all = ['twink', 'twank', 'twunk', 'mega-twunk', 'elder-twink', 'cub', 'cob', 'bear', 'mega-bear', 'polar-bear',
    'twink-otter', 'otter', 'mature-otter', 'mega-otter', 'silver-otter', 'jock', 'daddy', 'silver-daddy', 'average-guy'];
  const { window } = launch({ 'gaydex-seen': JSON.stringify(all) });
  await settle();
  const doc = window.document;
  assert.equal(doc.querySelector('#latticeProgress').textContent, '19 / 19 observed');
  assert.equal(doc.querySelector('#dexLattice').classList.contains('complete'), true, 'completion is a visual state, not only a number');
  assert.equal(doc.querySelector('#nextUnseenBtn').disabled, true);
  assert.match(doc.querySelector('#latticeNote').textContent, /Every form on record/);
});

test('quick filters: unobserved and favorites narrow the catalogue and recover cleanly', async () => {
  const { window } = launch({ 'gaydex-seen': JSON.stringify(['twink', 'cub']), 'gaydex-favs': JSON.stringify(['bear']) });
  await settle();
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 19);

  doc.querySelector('#quickUnseen').click();
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 17, 'observed forms hidden');
  assert.equal(doc.querySelector('#quickUnseen').getAttribute('aria-pressed'), 'true');

  doc.querySelector('#quickFaves').click();
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 1);
  assert.equal(doc.querySelector('#dexGrid .card').dataset.id, 'bear');

  // Favouriting while the favourites view is active must update it immediately.
  window.GayDexApp.selectEntry('daddy', false);
  doc.querySelector('#favBtn').click();
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 2, 'new favourite appears in the filtered view');
  doc.querySelector('#favBtn').click();
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 1);

  // Empty state explains itself and offers the way back.
  doc.querySelector('#search').value = 'zzzz';
  doc.querySelector('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 0);
  assert.match(doc.querySelector('#dexGrid .empty').textContent, /Nothing in the dex matches/);
  doc.querySelector('#emptyResetBtn').click();
  assert.equal(doc.querySelectorAll('#dexGrid .card').length, 19);
  assert.equal(doc.querySelector('#quickAll').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelector('#search').value, '');
});

test('axis legend: the published mapping matches what the engine actually does', async () => {
  const { window } = launch();
  await settle();
  const App = window.GayDexApp;
  const Core = window.GayDexBattleCore;
  const axes = App.statNames;

  assert.equal(Array.isArray(App.axisLegend), true, 'the contract is exposed as data');
  assert.match(window.document.querySelector('#axisLegendMapping').textContent, /Force from Power/, 'and rendered to the player');

  const base = { id: 'x', name: 'X', line: 'Twink', stage: 'Stage II', stats: [50, 50, 50, 50, 50], traits: [], evo: ['x'] };
  const vectors = ['force', 'style', 'insight', 'armor', 'speed', 'crit'];
  const read = (stats) => Core.battleStats({ ...base, stats }, true);
  const reference = read(base.stats);

  for (const axis of axes) {
    const i = axes.indexOf(axis);
    const bumped = read(base.stats.map((v, j) => (j === i ? v + 30 : v)));
    const gains = vectors
      .map((v) => [v, (bumped[v] - reference[v]) / Math.max(1, Math.abs(reference[v]))])
      .sort((a, b) => b[1] - a[1]);
    const dominant = gains[0];
    // The legend claims, per axis, which vector that axis drives. The engine
    // must agree that this axis moves that vector the most (or, for Maturity
    // and Hair, most-or-second-most where the table lists both).
    const claims = App.axisLegend.filter((row) => row.from.includes(axis)).map((row) => row.vector.toLowerCase());
    assert.ok(claims.length, `${axis} is used by at least one vector`);
    const rank = claims.map((c) => gains.findIndex((g) => g[0] === c));
    assert.ok(rank.includes(0) || rank.includes(1),
      `${axis} should lead or co-lead ${claims.join('/')} in the engine, but the strongest mover was ${dominant[0]} (${(dominant[1] * 100).toFixed(1)}%); measured ranks ${JSON.stringify(rank)}`);
  }

  // Max HP is a real derived stat too, and the legend names its inputs.
  const hpClaims = App.axisLegend.find((r) => r.vector === 'Max HP').from;
  const hpBase = read(base.stats).maxHp;
  for (const axis of hpClaims) {
    const i = axes.indexOf(axis);
    const hp = read(base.stats.map((v, j) => (j === i ? v + 30 : v))).maxHp;
    assert.ok(hp > hpBase, `${axis} raises Max HP, as the legend says`);
  }
});

test('compare deck: the leader on each axis is marked, ties included', async () => {
  const { window } = launch();
  await settle();
  const App = window.GayDexApp;
  App.toggleCompare('cub');       // Power-forward
  App.toggleCompare('twink');     // Youth/Vibe-forward
  App.toggleCompare('silver-daddy');

  const doc = window.document;
  const cards = [...doc.querySelectorAll('.compare-card')];
  assert.equal(cards.length, 3);
  const entries = App.compareIds().map((id) => App.entry(id));
  const perAxisLeads = App.statNames.map((_, i) => Math.max(...entries.map((e) => e.stats[i])));
  entries.forEach((e, cardIndex) => {
    const rows = [...cards[cardIndex].querySelectorAll('.mini-stat')];
    assert.equal(rows.length, 5);
    rows.forEach((row, axis) => {
      assert.equal(row.classList.contains('lead'), e.stats[axis] === perAxisLeads[axis],
        `${e.name} axis ${App.statNames[axis]} leader marking matches the numbers`);
    });
  });
});

test('fallback: without WebGL2 the explanation is visible, actionable and dismissible', async () => {
  const { window, errors } = launch();
  await settle();
  const doc = window.document;
  const fb = doc.querySelector('#circuitFallback');
  const root = doc.querySelector('#circuitRoot');

  assert.equal(root.contains(fb), false, 'the notice is not trapped inside the hidden world root');
  assert.equal(fb.hidden, false, 'it is shown when 3D is unavailable');
  assert.equal(window.getComputedStyle(fb).display !== 'none', true);
  assert.match(fb.textContent, /WebGL2/, 'it names the cause');
  assert.match(fb.textContent, /atlas, Lineage Atlas, Compare Deck, Evolution Lab and Battle Terminal/,
    'it says what still works');

  // The entry button must stay operable: a disabled control cannot explain itself.
  const enter = doc.querySelector('#circuitEnterBtn');
  assert.equal(enter.disabled, false);
  doc.querySelector('#circuitFallbackClose').click();
  assert.equal(fb.hidden, true, 'dismissible');
  enter.click();
  assert.equal(fb.hidden, false, 'and re-openable from the header button');
  assert.equal(window.GayDexCircuitState.ok, false);
  assert.deepEqual(errors, []);
});
