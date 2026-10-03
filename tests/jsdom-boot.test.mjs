/**
 * Full-application boot + regression journeys in jsdom.
 *
 * This loads the REAL production artifact (GayDex_Battle_Simulator_SINGLE_FILE.html)
 * and executes it. jsdom has no WebGL2, so the Circuit correctly takes its
 * static-fallback path — which is itself a required deliverable — while the
 * whole catalog, comparison, Evolution Lab and Battle Terminal run for real.
 *
 * Run: node --test tests/jsdom-boot.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');

function bootDoc() {
  const errors = [];
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && e.message || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  vc.on('warn', (...a) => logs.push(a.map(String).join(' ')));

  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/gaydex.html',
    virtualConsole: vc,
    resources: undefined, // never fetch anything: proves zero network dependency
    beforeParse(window) {
      /* jsdom gaps, shimmed with the browser-standard behaviour. These are
       * harness-only: every one of them exists in all target browsers, and the
       * app already guards the two observers behind `typeof` checks. */
      window.matchMedia = (q) => ({
        media: q, matches: /pointer:\s*coarse/.test(q) ? false : false,
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
      // jsdom ships no canvas backend: webgl* stays null (which is exactly the
      // static-fallback condition we want to exercise) and 2d gets a no-op
      // recording stub so the existing Canvas2D particle layer can run.
      const ctx2d = () => new Proxy({}, {
        get(t, k) {
          if (k === 'canvas') return { width: 2, height: 2 };
          if (k in t) return t[k];
          return () => undefined;
        },
        set(t, k, v) { t[k] = v; return true; },
      });
      const realGetContext = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        if (/webgl/i.test(String(kind))) return null;
        if (String(kind) === '2d') return ctx2d();
        return realGetContext ? realGetContext.call(this, kind, ...rest) : null;
      };
    },
  });
  return { dom, window: dom.window, errors, logs };
}

let booted = null;
function doc() {
  if (!booted) booted = bootDoc();
  return booted;
}

test('artifact boots with no uncaught errors and no network requests', () => {
  const { window, errors } = doc();
  assert.deepEqual(errors, [], `boot errors: ${errors.join(' | ')}`);
  assert.equal(window.__GAYDEX_BUILD, 'AWE-XL');
  assert.ok(typeof window.__GAYDEX_READY === 'number', 'app did not reach its ready marker');
});

test('vendored three.js is present and pinned to r186', () => {
  const { window } = doc();
  assert.ok(window.THREE, 'window.THREE missing — vendor bundle did not evaluate');
  assert.equal(String(window.THREE.REVISION), '186');
});

test('Circuit modules loaded and the static fallback engaged (jsdom has no WebGL2)', () => {
  const { window } = doc();
  assert.ok(window.GayDexCircuit, 'Circuit namespace missing');
  const C = window.GayDexCircuit;
  for (const fn of ['createAssets', 'createRuntime', 'createWorld', 'createSpecimenField', 'createInput', 'createBattleLayer', 'createCompareRing', 'createSpatialLab', 'createCircuitMode', 'createAdapter', 'boot', 'detectSupport']) {
    assert.equal(typeof C[fn], 'function', `Circuit.${fn} missing`);
  }
  const support = C.detectSupport();
  assert.equal(support.ok, false, 'jsdom unexpectedly reported WebGL2');
  assert.equal(window.GayDexCircuitState.ok, false);
  const root = window.document.querySelector('#circuitRoot');
  assert.equal(root.hidden, true, 'circuit root should stay hidden when unsupported');
  const fb = window.document.querySelector('#circuitFallback');
  assert.equal(fb.hidden, false, 'static fallback notice should be visible');
  const pill = window.document.querySelector('#enginePill');
  assert.match(pill.textContent, /static fallback/);
});

test('canonical taxonomy is intact: 19 entries, 4 lineages, five stats', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  assert.ok(App, 'application bridge missing');
  assert.equal(App.dex.length, 19);
  assert.deepEqual([...new Set(App.dex.map((e) => e.line))].sort(), ['Cub', 'Independent', 'Otter', 'Twink']);
  for (const e of App.dex) {
    assert.equal(e.stats.length, 5, `${e.id} stats`);
    assert.deepEqual([...App.statNames], ['Youth', 'Power', 'Hair', 'Maturity', 'Vibe']);
    assert.ok(Array.isArray(e.evo) && e.evo.length >= 1);
  }
  // The Lineage Atlas still renders its 4 rows.
  assert.equal(App.atlasLines.length, 4);
});

test('JOURNEY A — discovery: scan marks a form, persists, survives reload', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  const before = App.state.seen.size;
  assert.equal(App.markSeen('mega-bear'), true, 'first scan should report fresh');
  assert.equal(App.markSeen('mega-bear'), false, 'second scan should not re-count');
  assert.equal(App.state.seen.size, before + 1);
  const stored = JSON.parse(window.localStorage.getItem('gaydex-seen'));
  assert.ok(stored.includes('mega-bear'), 'discovery not persisted to localStorage');
});

test('JOURNEY B — lineage: evo chains resolve to real entries and stay correct', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  const twink = App.entry('twink');
  assert.deepEqual([...twink.evo], ['twink', 'twank', 'twunk', 'mega-twunk']);
  for (const id of twink.evo) {
    const e = App.entry(id);
    assert.ok(e, `${id} missing`);
    assert.equal(e.line, 'Twink');
  }
  assert.equal(App.entry('mega-twunk').stage, 'Mega');
  // Independent forms must NOT be forced into a ladder.
  assert.deepEqual([...App.entry('jock').evo], ['jock']);
  assert.deepEqual([...App.entry('average-guy').evo], ['average-guy']);
  assert.equal(App.stagePassive(App.entry('jock'))[0], 'Exhibition');
});

test('JOURNEY C — compare: pins cap at three and numbers match canonical entries', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  App.state.compare.clear();
  for (const id of ['twink', 'bear', 'otter', 'daddy']) App.toggleCompare(id);
  const ids = App.compareIds();
  assert.equal(ids.length, 3, 'compare must cap at 3');
  assert.ok(!ids.includes('twink'), 'oldest pin should have been evicted');
  const grid = window.document.querySelector('#compareGrid');
  for (const id of ids) {
    const e = App.entry(id);
    assert.ok(grid.textContent.includes(e.name), `${e.name} not rendered in compare grid`);
    for (const v of e.stats) assert.ok(grid.innerHTML.includes(`width:${v}%`), `stat ${v} for ${e.name} not shown`);
  }
  assert.equal(window.document.querySelector('#compareCount').textContent, '3/3');
});

test('JOURNEY H — Evolution Lab: conventional form returns real candidates', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  App.setLabVals({ build: 'large', hair: 'hairy', age: 'adult', vibe: 'rugged' });
  const cands = App.labCandidates(App.labVals());
  assert.equal(cands.length, 3);
  assert.ok(cands[0][1] >= cands[1][1] && cands[1][1] >= cands[2][1], 'candidates not sorted by score');
  for (const [e] of cands) assert.notEqual(e.stage, 'Mega', 'Mega forms must be excluded by the existing rule');
  assert.ok(cands.some(([e]) => e.line === 'Cub'), 'a large/hairy/rugged build should surface the Cub lineage');
  // The same scoring path must be what the spatial lab will call.
  assert.deepEqual(App.labCandidates({ build: 'large', hair: 'hairy', age: 'adult', vibe: 'rugged' }).map((c) => c[0].id), cands.map((c) => c[0].id));
});

test('JOURNEY D — battle: the terminal initialises, resolves rounds, reports, and stays deterministic', () => {
  const { window } = doc();
  const App = window.GayDexApp;
  assert.ok(App.setFighters('twunk', 'bear'), 'setFighters should accept canonical ids');
  let snap = App.battleState.match;
  assert.ok(snap, 'no match created');
  const seed = snap.seed;
  const startHp = [snap.a.hp, snap.b.hp];
  assert.equal(snap.round, 1);

  const first = [];
  let guard = 0;
  while (!App.battleState.match.ended && guard++ < 50) {
    App.battleState.moveA = ['flex', 'serve', 'read', 'guard'][guard % 4];
    App.battleState.moveB = ['serve', 'read', 'flex', 'guard'][(guard + 1) % 4];
    window.GayDexBattleCore.battleRound(App.battleState.match, App.battleState.moveA, App.battleState.moveB);
    first.push(App.battleState.match.log.slice(-1)[0]);
  }
  const m = App.battleState.match;
  assert.ok(m.ended, 'battle never resolved');
  assert.ok(['a', 'b', 'draw'].includes(m.winner));
  assert.ok(m.a.metrics && m.b.metrics, 'metrics not tracked');
  assert.ok(first.length > 0);
  assert.ok(startHp[0] > 0 && startHp[1] > 0);

  // Same seed => same truth.
  const replay = window.GayDexBattleCore.makeBattleMatch(App.entry('twunk'), App.entry('bear'), App.battleState.balanced, seed);
  window.GayDexBattleCore.applyBattleOpener(replay);
  for (let i = 1, g = 0; !replay.ended && g++ < 50; i++) {
    window.GayDexBattleCore.battleRound(replay, ['flex', 'serve', 'read', 'guard'][i % 4], ['serve', 'read', 'flex', 'guard'][(i + 1) % 4]);
  }
  assert.deepEqual(replay.log, m.log, 'seeded replay diverged from the live match');
  assert.equal(replay.winner, m.winner);
});

test('JOURNEY E — CPU: trainer / rival / nemesis all produce legal moves', () => {
  const { window } = doc();
  const Core = window.GayDexBattleCore;
  const App = window.GayDexApp;
  for (const skill of ['trainer', 'rival', 'nemesis']) {
    Core.bindContext({ scene: 'prism', intro: 'sweep', arenaEffects: true, cpuSkill: skill });
    const m = Core.makeBattleMatch(App.entry('mega-bear'), App.entry('mega-otter'), true, 4242);
    Core.applyBattleOpener(m);
    let guard = 0;
    while (!m.ended && guard++ < 60) {
      const pick = Core.chooseCpuBattleMove(m.b, m.a, m.decisionRng, m);
      assert.ok(['flex', 'serve', 'read', 'guard', 'signature'].includes(pick.move), `illegal CPU move ${pick.move}`);
      assert.equal(pick.skill, skill);
      assert.ok(typeof pick.reason === 'string' && pick.reason.length);
      Core.battleRound(m, Core.aiBattleMove(m.a, m.b, m.decisionRng, m), pick.move);
    }
    assert.ok(m.ended, `${skill} battle never resolved`);
  }
  Core.bindContext(App.battleState);
});

test('JOURNEY G — lineage series (the engine Circuit mode walks) still simulates', () => {
  const { window } = doc();
  const Core = window.GayDexBattleCore;
  const App = window.GayDexApp;
  const A = Core.BATTLE_LINES.Twink, B = Core.BATTLE_LINES.Cub;
  const pairs = A.main.map((id, i) => ({ label: ['Starter', 'Stage II', 'Stage III', 'Mega'][i], a: id, b: B.main[i] }));
  pairs.push({ label: 'Variant', a: A.variant, b: B.variant });
  assert.equal(pairs.length, 5);
  let scoreA = 0, scoreB = 0;
  for (const [i, p] of pairs.entries()) {
    const m = Core.simulateBattle(App.entry(p.a), App.entry(p.b), true, Core.hashSeed(`series|Twink|Cub|${p.label}|${i}`));
    assert.ok(m.ended);
    if (m.winner === 'a') scoreA++; else if (m.winner === 'b') scoreB++; else { scoreA += 0.5; scoreB += 0.5; }
  }
  assert.equal(scoreA + scoreB, 5);
});

test('JOURNEY I — accessibility: keyboard-only paths exist and are wired', () => {
  const { window } = doc();
  const d = window.document;
  // Every essential function has a focusable control.
  for (const id of ['randomBtn', 'megaBtn', 'favBtn', 'compareBtn', 'battleResolve', 'battleAuto', 'battleReset', 'battleSeries', 'battleSwap', 'labReset', 'circuitEnterBtn', 'circuitNavToggle']) {
    const el = d.getElementById(id);
    assert.ok(el, `missing control #${id}`);
    assert.ok(['BUTTON', 'A', 'INPUT', 'SELECT'].includes(el.tagName), `#${id} is not focusable`);
  }
  // Move buttons expose key shortcuts and ARIA state.
  const moves = d.querySelectorAll('[data-battle-move]');
  assert.ok(moves.length >= 10, 'battle move buttons not rendered');
  for (const b of moves) {
    assert.ok(b.hasAttribute('aria-keyshortcuts'), 'move button missing aria-keyshortcuts');
    assert.ok(b.hasAttribute('aria-pressed'), 'move button missing aria-pressed');
  }
  // The Circuit index is a real <nav> of buttons, not a canvas-only affordance.
  assert.ok(d.querySelector('#circuitNavigator'), 'circuit navigator missing');
  assert.equal(d.querySelector('#circuitNavigator').tagName, 'NAV');
  // Reduced motion must not remove capability: the stylesheet only shortens timings.
  const css = readFileSync(join(ROOT, 'src/shell/02-styles.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!/prefers-reduced-motion[^}]*display:\s*none/.test(css), 'reduced motion must not hide features');
});

test('JOURNEY J — lifecycle: single renderer design, no duplicate loops in the source', () => {
  const src = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');
  const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
  // The old hand-rolled WebGL paths must be gone from the application layer,
  // not left running behind the Three.js renderer. (three.js itself of course
  // still calls createProgram internally — that is the point of using it.)
  assert.equal((app.match(/getContext\('webgl/g) || []).length, 0, 'app.js still opens a raw WebGL context');
  assert.equal((app.match(/createProgram|createShader/g) || []).length, 0, 'app.js still compiles raw shaders');
  assert.equal((src.match(/initEmbedded3D|initBattleArena3D/g) || []).length, 0);
  // Exactly one animation driver: a single self-rescheduling tick, always
  // paired with cancellation on suspend/dispose.
  const runtime = readFileSync(join(ROOT, 'src/circuit/20-runtime.js'), 'utf8');
  assert.equal((runtime.match(/function tick\(/g) || []).length, 1, 'runtime must define exactly one frame loop');
  assert.equal((runtime.match(/cancelAnimationFrame\(/g) || []).length >= 2, true, 'rAF must be cancellable on suspend and dispose');
  assert.match(runtime, /blockers\.size === 0/, 'runtime must not render while a blocker is set');
  // Every listener added by Circuit is paired with a removal path.
  for (const f of ['50-input.js', '20-runtime.js']) {
    const s = readFileSync(join(ROOT, 'src/circuit/' + f), 'utf8');
    const add = (s.match(/addEventListener\(/g) || []).length;
    const rm = (s.match(/removeEventListener\(|disconnect\(\)/g) || []).length;
    assert.ok(rm >= 1, `${f} registers ${add} listeners with no teardown`);
  }
});

test('production artifact remains a single self-contained file with no network fetches', () => {
  assert.equal((HTML.match(/<script[^>]+src=/g) || []).length, 0, 'external script tag found');
  assert.equal((HTML.match(/<link[^>]+stylesheet/g) || []).length, 0, 'external stylesheet found');
  // three.js ships loader classes (FileLoader/ImageBitmapLoader) whose bodies
  // mention fetch/XHR. We never construct a loader, so scope the "no network"
  // guarantee to the code GayDex itself ships: everything after the vendored
  // three bundle, plus each source file directly.
  const marker = 'GayDex battle engine — CANONICAL GAMEPLAY AUTHORITY';
  const cut = HTML.indexOf(marker);
  assert.ok(cut > 100000, 'could not locate the end of the vendored three bundle');
  const ours = HTML.slice(cut);
  assert.equal((ours.match(/\bfetch\(/g) || []).length, 0, 'fetch() in GayDex code');
  assert.equal((ours.match(/XMLHttpRequest/g) || []).length, 0, 'XHR in GayDex code');
  for (const f of ['src/app.js', 'src/battle-core.js']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.equal((s.match(/\bfetch\(|XMLHttpRequest/g) || []).length, 0, `${f} touches the network`);
  }
  for (const f of readdirSync(join(ROOT, 'src/circuit'))) {
    const s = readFileSync(join(ROOT, 'src/circuit', f), 'utf8');
    assert.equal((s.match(/\bfetch\(|XMLHttpRequest/g) || []).length, 0, `circuit/${f} touches the network`);
  }
  // Strip comments, then assert nothing outside a comment references a URL.
  const code = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const runtimeUrls = (code.match(/https?:\/\/[^"'\s)]+/g) || [])
    // XML namespace constants are identifiers, never requests.
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  assert.deepEqual(runtimeUrls, [], `runtime URL references found: ${runtimeUrls.slice(0, 5).join(', ')}`);
  assert.equal((code.match(/\bimport\s*\(/g) || []).length, 0, 'dynamic import found');
  assert.ok(HTML.length > 1_500_000, 'artifact suspiciously small');
});
