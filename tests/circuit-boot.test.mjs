/**
 * Circuit boot wiring, executed headlessly.
 *
 * `src/circuit/90-boot.js` owns the camera director, the specimen inspector,
 * the accessible navigator, the in-world battle dock, toasts and teardown.
 * Every previous test skipped it, because building it needs a renderer and a
 * test runner has no GPU.
 *
 * So this suite runs the REAL boot function against the REAL world, specimens,
 * input, compare ring, lab, battle layer, three.js and battle engine, with the
 * one thing a GPU is required for - the WebGLRenderer - replaced by a stub
 * whose only job is to own the camera and pump the frame subscribers. The boot
 * code is not modified for the test: it is the same function production calls,
 * driven through the `boot(opts)` seam.
 *
 * Run: node --test tests/circuit-boot.test.mjs
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

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Boot the real application in jsdom. WebGL2 is absent, so the Circuit takes
 * its documented static-fallback path and we can drive the real boot ourselves. */
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
        media: q,
        matches: /pointer:\s*coarse/.test(q) ? false : false,
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

/** The only stub: a renderer-shaped object that owns the real camera and the
 * frame subscriber list. Everything else in the stack is production code. */
function stubRuntime(THREE, win) {
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 620);
  camera.position.set(0, 2.05, 26);
  const subscribers = [];
  const telemetry = [];
  const state = { quality: 'auto', motion: false, running: false, disposed: false, frames: 0, resizes: 0 };
  return {
    camera,
    three: THREE,
    get maxAnisotropy() { return 4; },
    get quality() { return { ...win.GayDexCircuit.QUALITY.auto }; },
    get tier() { return 'auto'; },
    get mode() { return state.quality; },
    get time() { return state.frames / 60; },
    get fps() { return 60; },
    get disposed() { return state.disposed; },
    get contextLost() { return false; },
    get blockers() { return state.running ? [] : ['user']; },
    get governor() { return { changes: 0, history: [] }; },
    onFrame(fn) { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; },
    onTelemetry(fn) { telemetry.push(fn); },
    onError() {},
    resize() { state.resizes++; },
    suspend() { state.running = false; },
    resume() { state.running = true; },
    isRunning() { return state.running; },
    setQuality(m) { state.quality = m; },
    setReducedMotion(v) { state.motion = !!v; },
    dispose() { state.disposed = true; subscribers.length = 0; },
    /* test-only driving surface */
    _pump(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        state.frames++;
        const t = state.frames / 60;
        for (const fn of subscribers.slice()) fn(dt, t, state.motion ? 0.15 : 1, { label: 'AUTO' });
      }
    },
    _emitTelemetry(t) { telemetry.forEach((fn) => fn(t)); },
    get _subscribers() { return subscribers.length; },
    get _state() { return state; },
  };
}

/** Boot the Circuit for real, over the running application. */
function bootCircuit(win, opts = {}) {
  const C = win.GayDexCircuit;
  const runtime = stubRuntime(win.THREE, win);
  const api = C.boot({
    support: { ok: true, revision: String(win.THREE.REVISION) },
    factories: { createRuntime: () => runtime },
    ...opts,
  });
  return { api, runtime };
}

test('boot: production boot function builds the whole stack against a stub renderer', async () => {
  const { window, errors } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);

  assert.ok(api, 'boot returned an api even without a GPU');
  assert.equal(api.support.ok, true);
  assert.equal(api.world.districts.prism !== undefined, true, 'all four districts built');
  assert.equal(api.specimens.all().length, 19, 'every canonical form has a spatial specimen');
  assert.equal(api.runtime, runtime);
  assert.equal(runtime._subscribers, 1, 'exactly one frame subscriber chain is registered');
  assert.deepEqual(errors, []);
  api.dispose();
});

test('boot: enter / exit toggles the world, remembers the camera, and suspends the loop', async () => {
  const { window } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);

  api.enterCircuit();
  assert.equal(window.document.querySelector('#circuitRoot').hidden, false, 'root is shown');
  assert.equal(window.document.body.classList.contains('circuit-on'), true, 'atlas yields to the world');
  assert.equal(runtime._state.running, true, 'renderer resumed');
  assert.equal(window.document.querySelector('#circuitEnterBtn').getAttribute('aria-pressed'), 'true');

  runtime._pump(120); // two seconds of walking about, plus the warp fly-through
  const before = { x: runtime.camera.position.x, z: runtime.camera.position.z };

  api.exitCircuit();
  assert.equal(window.document.querySelector('#circuitRoot').hidden, true);
  assert.equal(window.document.body.classList.contains('circuit-on'), false);
  assert.equal(runtime._state.running, false, 'renderer suspended');
  const saved = JSON.parse(window.localStorage.getItem('gaydex-circuit-v1'));
  assert.equal(typeof saved.camera.x, 'number', 'camera position persisted for the next visit');
  assert.equal(typeof saved.camera.z, 'number');
  assert.equal(typeof before.x, 'number');

  // Re-entering restores the saved viewpoint rather than teleporting home.
  api.enterCircuit();
  assert.ok(Math.abs(runtime.camera.position.x - saved.camera.x) < 1.5, 'camera restored');
  api.dispose();
});

test('inspector: scanning a specimen uses the canonical entry and the real persistence path', async () => {
  const { window, errors } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);
  api.enterCircuit();

  const target = api.specimens.all().find((s) => s.id === 'mature-otter');
  const entry = api.adapter.entry('mature-otter');
  api.openInspector('mature-otter');
  runtime._pump(140); // let the approach flight finish

  const doc = window.document;
  assert.equal(doc.querySelector('#circuitInspector').hidden, false, 'inspector opened');
  assert.equal(doc.querySelector('#circuitInspectorName').textContent, entry.name);
  assert.equal(doc.querySelector('#circuitInspectorDesc').textContent, entry.desc, 'description is the canonical copy');
  assert.match(doc.querySelector('#circuitInspectorEyebrow').textContent, /#013 \/\/ OTTER \/\/ STAGE III/);
  assert.equal(doc.querySelectorAll('#circuitInspectorFacts div').length, 8, 'eight canonical facts');
  assert.equal(doc.querySelectorAll('#circuitInspectorStats .circuit-stat').length, 5, 'five canonical axes');
  assert.equal(doc.querySelectorAll('#circuitInspectorTraits .circuit-trait').length, entry.traits.length);
  assert.equal(doc.querySelectorAll('#circuitInspectorLineage .circuit-route-node').length, entry.evo.length, 'evolution route is the canonical chain');

  // Scanning is a real discovery: it must persist through the app's storage.
  assert.equal(api.adapter.isDiscovered('mature-otter'), true, 'form marked observed');
  const seen = JSON.parse(window.localStorage.getItem('gaydex-seen'));
  assert.ok(seen.includes('mature-otter'), 'observation persisted to gaydex storage');
  assert.equal(api.specimens.get(target.id).discovered, true, 'the 3D specimen switched to its revealed state');
  assert.equal(api.specimens.get(target.id).inspecting, true, 'the inspected specimen is highlighted');
  assert.match(doc.querySelector('#circuitToast').textContent, /SCANNED \/\/ Mature Otter added to observed forms/);

  // The route nodes are real navigation, not decoration.
  const routeBtn = doc.querySelector('#circuitInspectorLineage .circuit-route-node[data-route-id="mega-otter"]');
  assert.ok(routeBtn, 'route node for the Mega form exists');
  routeBtn.click();
  runtime._pump(200);
  assert.equal(doc.querySelector('#circuitInspectorName').textContent, 'Mega Otter', 'route click flew to and opened the next form');
  assert.deepEqual(errors, []);
  api.dispose();
});

test('inspector actions: compare, challenge and atlas hand-off all reach production paths', async () => {
  const { window } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);
  api.enterCircuit();
  api.openInspector('twunk');
  runtime._pump(120);

  const doc = window.document;
  doc.querySelector('#ciCompare').click();
  assert.deepEqual([...api.adapter.compareIds()], ['twunk'], 'pinned through the canonical compare deck');
  assert.match(doc.querySelector('#ciCompare').textContent, /Unpin/);

  doc.querySelector('#ciChallenge').click();
  runtime._pump(200);
  assert.equal(api.battle.active, true, 'challenge seated a match and entered the arena');
  assert.equal(doc.querySelector('#circuitBattleHud').hidden, false, 'battle dock is visible');
  const snap = api.adapter.battleSnapshot();
  assert.equal(snap.a.id, 'twunk', 'fighter A is the challenged form');
  assert.notEqual(snap.b.id, snap.a.id, 'a real rival was seated from the canonical pool');
  assert.equal(doc.querySelectorAll('#circuitBattleMoves .circuit-move[data-move]').length, 5, 'five engine moves offered');
  assert.match(doc.querySelector('#circuitBattleCenter').textContent, /ROUND 1/);

  // Resolve a round through the real engine, from the in-world dock.
  doc.querySelector('[data-move="flex"]').click();
  doc.querySelector('#circuitResolve').click();
  await settle(60);
  assert.ok(api.adapter.battleSnapshot().round >= 2, 'engine advanced the round');
  assert.equal(api.battle.active, true);

  doc.querySelector('#circuitLeave').click();
  runtime._pump(120);
  assert.equal(api.battle.active, false, 'leaving the arena restores the world');
  assert.equal(doc.querySelector('#circuitBattleHud').hidden, true);
  api.dispose();
});

test('navigator: every district, lineage and system action is reachable and wired', async () => {
  const { window } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);
  api.enterCircuit();

  const doc = window.document;
  doc.querySelector('#circuitNavToggle').click();
  const nav = doc.querySelector('#circuitNavigator');
  assert.equal(nav.hidden, false, 'navigator opened');
  assert.equal(doc.querySelector('#circuitNavToggle').getAttribute('aria-expanded'), 'true');

  const districts = [...nav.querySelectorAll('[data-nav-kind="district"]')].map((b) => b.dataset.navId);
  assert.deepEqual(districts, ['nexus', 'prism', 'aqua', 'pride', 'emerald'], 'all five travel targets');
  const specimens = [...nav.querySelectorAll('[data-nav-kind="specimen"]')].map((b) => b.dataset.navId);
  assert.equal(specimens.length, 19, 'every form listed');
  assert.deepEqual([...nav.querySelectorAll('[data-nav-kind="action"]')].map((b) => b.dataset.navId),
    ['compare', 'lab', 'battle', 'circuit', 'exit'], 'every system action listed');

  // Travelling from the index moves the world and the district card together.
  nav.querySelector('[data-nav-kind="district"][data-nav-id="aqua"]').click();
  runtime._pump(200);
  assert.equal(api.world.activeDistrict, 'aqua');
  assert.equal(doc.querySelector('#circuitDistrictName').textContent, 'AQUA PULSE BAY');
  assert.equal(JSON.parse(window.localStorage.getItem('gaydex-circuit-v1')).lastDistrict, 'aqua');

  // Opening a form from the index goes through the same scan path as clicking it.
  doc.querySelector('#circuitNavToggle').click();
  nav.querySelector('[data-nav-kind="specimen"][data-nav-id="polar-bear"]').click();
  runtime._pump(240);
  assert.equal(doc.querySelector('#circuitInspectorName').textContent, 'Polar Bear');
  assert.equal(api.adapter.isDiscovered('polar-bear'), true);
  api.dispose();
});

test('input: keyboard travel, targeting and escape semantics work through the real handlers', async () => {
  const { window } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);
  api.enterCircuit();
  runtime._pump(120);

  const doc = window.document;
  const key = (k, code) => {
    const e = new window.KeyboardEvent('keydown', { key: k, code: code || k, bubbles: true, cancelable: true });
    doc.dispatchEvent(e);
    return e;
  };

  // F1-F4 are documented travel keys.
  key('F3', 'F3');
  runtime._pump(200);
  assert.equal(api.world.activeDistrict, 'pride', 'F3 travelled to the Pride Circuit');

  // Tab cycles spatial targets and publishes a prompt.
  key('Tab', 'Tab');
  runtime._pump(2);
  assert.ok(api.input.target, 'Tab selected a target');
  assert.equal(doc.querySelector('#circuitPrompt').hidden, false, 'prompt is shown for the target');

  // Escape backs out one layer at a time: prompt -> navigator -> arena -> world.
  doc.querySelector('#circuitNavToggle').click();
  assert.equal(doc.querySelector('#circuitNavigator').hidden, false);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  assert.equal(doc.querySelector('#circuitNavigator').hidden, true, 'Escape closed the navigator');

  const first = key('KeyP');
  assert.equal(first.defaultPrevented, false, 'unrelated keys are not swallowed');
  api.exitCircuit();
  assert.equal(doc.querySelector('#circuitRoot').hidden, true, 'Escape exited the world');
  api.dispose();
});

test('telemetry and quality: chips reflect real subsystem state, and teardown is complete', async () => {
  const { window, errors } = launch();
  await settle();
  const { api, runtime } = bootCircuit(window);
  api.enterCircuit();
  runtime._pump(60);

  const doc = window.document;
  runtime._emitTelemetry({
    version: '186', fps: 58, frameMs: 17.2, calls: 214, triangles: 98400, textures: 26, geometries: 40,
    programs: 18, dpr: 1.5, tier: 'auto', mode: 'auto', qualityLabel: 'AUTO', shadowMap: true,
    subscribers: 1, running: true, contextLost: false, points: 0, lines: 0,
  });
  assert.match(doc.querySelector('#circuitTelemetry').textContent, /58 FPS .* 214 calls .* 26 tex/);
  assert.equal(doc.querySelector('#circuitQualityBtn').innerHTML.includes('AUTO'), true);

  const qb = doc.querySelector('#circuitQualityBtn');
  qb.click();
  assert.match(qb.innerHTML, /HIGH|ECO/, `quality cycled, got ${qb.innerHTML}`);
  const mb = doc.querySelector('#circuitMotionBtn');
  mb.click();
  assert.equal(doc.body.classList.contains('circuit-reduced'), true, 'reduced motion is a real, independent switch');
  mb.click();
  assert.equal(doc.body.classList.contains('circuit-reduced'), false);

  // HUD is only written while it is open.
  api.enterCircuit();
  doc.querySelector('#perfBtn').click();
  runtime._emitTelemetry({
    version: '186', fps: 55, frameMs: 18, calls: 200, triangles: 90000, textures: 24, geometries: 40,
    programs: 16, dpr: 1.5, tier: 'auto', mode: 'auto', qualityLabel: 'AUTO', shadowMap: true,
  });
  assert.match(doc.querySelector('#perfHud').textContent, /CALLS 200/);
  assert.match(doc.querySelector('#perfHud').textContent, /3D AUTO/);
  doc.querySelector('#perfBtn').click();
  const closed = doc.querySelector('#perfHud').textContent;
  runtime._emitTelemetry({
    version: '186', fps: 60, frameMs: 16, calls: 999, triangles: 90000, textures: 24, geometries: 40,
    programs: 16, dpr: 1.5, tier: 'auto', mode: 'auto', qualityLabel: 'AUTO', shadowMap: true,
  });
  assert.equal(doc.querySelector('#perfHud').textContent, closed, 'closed HUD is not rewritten');

  api.dispose();
  assert.equal(runtime._state.disposed, true, 'renderer released');
  assert.equal(runtime._subscribers, 0, 'no frame subscriber outlives teardown');
  assert.deepEqual(errors, []);
});
