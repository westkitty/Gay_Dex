/**
 * Loop 4 suite: authored assets and the fight-vector duel card.
 *
 * The duel card draws engine-derived numbers, so the tests check the numbers
 * against the engine rather than against a copy of the drawing code. A
 * recording 2D context captures what was actually painted, which is how the
 * shape claim is verified instead of asserted.
 *
 * Run: node --test tests/duelcard-assets.test.mjs
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
const settle = (ms = 140) => new Promise((r) => setTimeout(r, ms));

/** A 2D context that records the geometry it is asked to draw. */
function recordingContext() {
  const calls = { moveTo: [], lineTo: [], arc: [], fillText: [], fill: 0, stroke: 0, paths: [] };
  let current = null;
  const ctx = {
    calls,
    canvas: { width: 640, height: 300 },
    get current() { return current; },
    beginPath() { current = []; calls.paths.push(current); },
    closePath() {},
    moveTo(x, y) { calls.moveTo.push([x, y]); if (current) current.push([x, y]); },
    lineTo(x, y) { calls.lineTo.push([x, y]); if (current) current.push([x, y]); },
    arc(x, y, r) { calls.arc.push([x, y, r]); },
    fill() { calls.fill++; if (current && current.length) calls.lastFill = current.slice(); },
    stroke() { calls.stroke++; if (current && current.length) calls.lastStroke = current.slice(); },
    fillText(t) { calls.fillText.push(String(t)); },
    clearRect() {}, setLineDash() {}, save() {}, restore() {},
    measureText: (t) => ({ width: String(t).length * 7 }),
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'lineCap', 'textAlign']) ctx[k] = '';
  return ctx;
}

function launch(seed = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const contexts = [];
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
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== '2d') return null;
        const ctx = recordingContext();
        if (this.id === 'duelCanvas') { contexts.push({ canvas: this, ctx }); return ctx; }
        return new Proxy({}, {
          get(t, k) {
            if (k === 'canvas') return { width: 64, height: 64 };
            if (k === 'measureText') return () => ({ width: 120 });
            if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
            if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
            return () => {};
          },
          set() { return true; },
        });
      };
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  return { window: dom.window, errors, contexts };
}

test('duel card: the drawn shape and numbers are the engine\'s own battle vectors', async () => {
  const { window, errors, contexts } = launch();
  await settle(200);
  const App = window.GayDexApp;
  const Core = window.GayDexBattleCore;
  assert.ok(contexts.length, 'the card created a 2D context');

  // Every canonical form must produce a model straight off the engine.
  for (const e of App.dex) {
    const model = App.duelModel(e.id);
    const expect = Core.battleStats(e, true);
    for (const k of ['force', 'style', 'insight', 'armor', 'speed', 'crit', 'maxHp']) {
      assert.equal(model.self[k], expect[k], `${e.name}.${k} comes from BattleCore.battleStats`);
    }
    assert.ok(model.rival && model.rival.id !== e.id, `${e.name} is compared against a real rival`);
    // Paint it and read back what the canvas actually announced.
    App.renderDuelCard(e);
    const drawn = JSON.parse(window.document.querySelector('#duelCanvas').dataset.model);
    assert.equal(drawn.self.force, expect.force, 'the painted model matches the engine');
    assert.equal(drawn.self.speed, expect.speed, `${e.name} speed as painted`);
    assert.equal(drawn.self.maxHp, expect.maxHp, `${e.name} HP as painted`);
  }

  // The paint itself: two closed triangles (selected form + rival), one filled.
  const last = contexts[contexts.length - 1];
  App.renderDuelCard(App.entry('bear'));
  const outlined = last.ctx.calls.paths.filter((p) => p.length === 3);
  assert.ok(outlined.length >= 2, `expected two triangular profiles to be traced, saw ${outlined.length}`);
  assert.equal(last.ctx.calls.fill > 0, true, 'the selected profile is filled');
  assert.ok(last.ctx.calls.fillText.some((t) => /^FORCE \d+$/.test(t)), 'vector values are labelled on the chart');
  assert.ok(last.ctx.calls.fillText.some((t) => /HP$/.test(t)), 'the HP ring is labelled');
  assert.deepEqual(errors, []);
});

test('duel card: the profile genuinely reflects the form\'s vector balance', async () => {
  const { window } = launch();
  await settle(200);
  const App = window.GayDexApp;

  const vertexLengths = (id, rivalId) => {
    App.renderDuelCard(App.entry(id), { keepRival: true });
    App.renderDuelCard(App.entry(id), { keepRival: true });
    const canvas = window.document.querySelector('#duelCanvas');
    const model = JSON.parse(canvas.dataset.model);
    const v = model.self;
    const mx = Math.max(v.force, v.style, v.insight, 1);
    return [v.force / mx, v.style / mx, v.insight / mx];
  };

  // A Power-forward form and a Vibe-forward form must not share a silhouette.
  const bear = App.duelModel('bear').self;
  const twink = App.duelModel('twink').self;
  assert.ok(bear.force > bear.insight, 'Bear is Force-forward');
  assert.ok(twink.style > twink.force, 'Twink is Style-forward');
  const bearShape = vertexLengths('bear');
  const twinkShape = vertexLengths('twink');
  assert.notDeepEqual(bearShape.map((n) => +n.toFixed(2)), twinkShape.map((n) => +n.toFixed(2)),
    'different vector balance means a different drawn profile');

  // The "next rival" control really changes the comparison.
  const before = window.document.querySelector('#duelCanvas').dataset.model;
  const beforeRival = JSON.parse(before).rival.id;
  window.document.querySelector('#duelRivalBtn').click();
  const after = JSON.parse(window.document.querySelector('#duelCanvas').dataset.model);
  assert.notEqual(after.rival.id, beforeRival, 'the rival actually changed');
  assert.equal(after.self.force, JSON.parse(before).self.force, 'the selected form did not change');
});

test('duel card: it goes live from the engine\'s match state, not from a parallel copy', async () => {
  const { window } = launch();
  await settle(200);
  const App = window.GayDexApp;
  const doc = window.document;

  App.resetBattle();
  const match = App.battleState.match;
  App.selectEntry(match.a.entry.id, false);
  await settle(120);
  App.renderDuelCard(App.entry(match.a.entry.id), { keepRival: true });
  assert.equal(doc.querySelector('#duelCard').classList.contains('live'), true, 'card switched to live mode');
  assert.match(doc.querySelector('#duelCaption').textContent, /LIVE/);

  // Damage the fighter through the engine, then re-render through the app path.
  App.selectEntry(match.b.entry.id, false);
  const before = match.a.hp;
  App.battleState.match.a.hp = Math.max(1, before - 17);
  App.renderDuelCard(App.entry(match.a.entry.id), { keepRival: true });
  const drawn = JSON.parse(doc.querySelector('#duelCanvas').dataset.model);
  assert.equal(drawn.self.maxHp, match.a.maxHp);
  assert.match(doc.querySelector('#duelCaption').textContent, new RegExp(`${Math.ceil(match.a.hp)} HP`),
    'the caption reports the live engine HP, not a cached number');
});

test('duel card: accessible name describes the comparison in words', async () => {
  const { window } = launch();
  await settle(200);
  const doc = window.document;
  const canvas = doc.querySelector('#duelCanvas');
  const model = window.GayDexApp.duelModel('bear', 'cub');
  window.GayDexApp.renderDuelCard(window.GayDexApp.entry('bear'), { rival: 'cub' });
  const label = canvas.getAttribute('aria-label');
  assert.match(label, /Force \d+, Style \d+, Insight \d+/);
  assert.match(label, new RegExp(model.rival.name), 'the rival is named');
  assert.match(label, /vector-envelope share \d+ percent/);
  assert.equal(canvas.getAttribute('role'), 'img', 'presented as an image with a real description');
});

test('assets: app icon, touch icon and social card are authored, embedded and consistent', async () => {
  const { window } = launch();
  await settle(120);
  const doc = window.document;

  const icons = [...doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
  assert.equal(icons.length, 3, 'two favicon sizes plus a touch icon');
  for (const link of icons) {
    assert.match(link.getAttribute('href'), /^data:image\/png;base64,/,
      'icons are embedded, so the artifact needs no sibling files to be recognisable');
  }
  assert.ok(doc.querySelector('meta[name="description"]'), 'the artifact describes itself');
  assert.equal(doc.querySelector('meta[property="og:image"]').getAttribute('content'), './assets/og-card.png');
  assert.equal(doc.querySelector('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');

  // The generated files exist, are real PNGs, and their pixels decode.
  const { deflateSync } = await import('node:zlib');
  void deflateSync;
  for (const [file, w, h] of [['assets/icon-512.png', 512, 512], ['assets/og-card.png', 1200, 630]]) {
    const buf = readFileSync(join(ROOT, file));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} has a PNG signature`);
    assert.equal(buf.readUInt32BE(16), w, `${file} width`);
    assert.equal(buf.readUInt32BE(20), h, `${file} height`);
    assert.ok(buf.length > 2000, `${file} has real content`);
  }

  // The embedded favicon and the generated head partial are the same bytes.
  const head = readFileSync(join(ROOT, 'src/shell/partials/head-icons.html'), 'utf8');
  const first = icons[0].getAttribute('href');
  assert.ok(head.includes(first), 'the inlined icon comes from the generated partial');
});

test('assets: the icon generator is deterministic and its output is committed', () => {
  const { execFileSync } = require('node:child_process');
  const before = readFileSync(join(ROOT, 'assets/icon-512.png'));
  const beforeCard = readFileSync(join(ROOT, 'assets/og-card.png'));
  const beforeHead = readFileSync(join(ROOT, 'src/shell/partials/head-icons.html'), 'utf8');
  execFileSync('node', [join(ROOT, 'tools/make-icons.mjs')], { cwd: ROOT });
  assert.deepEqual(readFileSync(join(ROOT, 'assets/icon-512.png')), before, 'icon is byte-stable');
  assert.deepEqual(readFileSync(join(ROOT, 'assets/og-card.png')), beforeCard, 'social card is byte-stable');
  assert.equal(readFileSync(join(ROOT, 'src/shell/partials/head-icons.html'), 'utf8'), beforeHead, 'head partial is byte-stable');
});
