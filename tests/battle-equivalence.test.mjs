/**
 * Battle-truth equivalence suite.
 *
 * Proves that `src/battle-core.js` (the refactored, DOM-free engine used by
 * GayDex: Circuit) produces byte-identical battle outcomes to the ORIGINAL
 * engine extracted verbatim from git commit cbbe7a3 by
 * `tools/extract-original-engine.mjs`.
 *
 * Compares, per match: full log text, winner, round count, final HP, shield,
 * hype, combo, guard chain, every recorded metric, momentum swing and the
 * rolling timeline.  If the refactor had altered any damage number, counter
 * interaction, Flow threshold, Guard-fatigue curve, READ LOCK condition,
 * opener, arena pulse or RNG consumption, one of these assertions fails.
 *
 * Run: node --test tests/battle-equivalence.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const ORIGINAL = require(join(ROOT, 'tests/fixtures/original-engine.cjs'));

function loadCore() {
  const src = readFileSync(join(ROOT, 'src/battle-core.js'), 'utf8');
  const sandboxWindow = {};
  new Function('window', 'module', 'globalThis', src)(sandboxWindow, { exports: {} }, sandboxWindow);
  return sandboxWindow.GayDexBattleCore;
}

/**
 * Canonical GayDex entries.  Generated from the pristine artifact by
 * `tools/extract-original-engine.mjs` (portraits stripped — battle math never
 * reads them), so the taxonomy under test cannot drift with UI work.
 */
const DEX = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/dex-entries.json'), 'utf8'));

const CORE = loadCore();
const BY_ID = Object.fromEntries(DEX.map((e) => [e.id, e]));

const SCENES = ['prism', 'aqua', 'pride', 'forest'];
const OPENERS = ['sweep', 'drop', 'burst', 'random'];
const SKILLS = ['trainer', 'rival', 'nemesis'];
const LINES = Object.keys(ORIGINAL.BATTLE_LINES);

/** Deep snapshot of everything the engine records about a finished match. */
function snapshot(m) {
  const side = (f) => ({
    hp: f.hp,
    shield: f.shield,
    hype: f.hype,
    combo: f.combo,
    guardChain: f.guardChain,
    sigCd: f.sigCd,
    lastMove: f.lastMove,
    lastTaken: f.lastTaken,
    history: f.history.slice(),
    metrics: f.metrics ? { ...f.metrics } : null,
    stats: { ...f.stats },
  });
  return {
    winner: m.winner,
    round: m.round,
    ended: m.ended,
    opener: m.opener,
    log: m.log.slice(),
    a: side(m.a),
    b: side(m.b),
    momentumSwing: m.momentumSwing ? { ...m.momentumSwing } : null,
    timeline: m.timeline.map((r) => ({ ...r, tags: r.tags.slice() })),
  };
}

/** Play one match to completion through an engine, driving both sides. */
function play(eng, idA, idB, { balanced, scene, opener, arenaEffects, cpuB, cpuSkill, seed, cpuOnA }) {
  if (eng.bindContext) eng.bindContext({ scene, intro: opener, arenaEffects, cpuSkill });
  else Object.assign(eng.battleState, { scene, intro: opener, arenaEffects, cpuSkill });

  const m = eng.makeBattleMatch(BY_ID[idA], BY_ID[idB], balanced, seed);
  eng.applyBattleOpener(m);
  let guard = 0;
  while (!m.ended && guard++ < 64) {
    const a = cpuOnA ? eng.chooseCpuBattleMove(m.a, m.b, m.decisionRng, m).move : eng.aiBattleMove(m.a, m.b, m.decisionRng, m);
    const b = cpuB ? eng.chooseCpuBattleMove(m.b, m.a, m.decisionRng, m).move : eng.aiBattleMove(m.b, m.a, m.decisionRng, m);
    eng.battleRound(m, a, b);
  }
  return m;
}

const cases = [];
let n = 0;
for (const la of LINES) {
  for (const lb of LINES) {
    for (const idA of ORIGINAL.BATTLE_LINES[la].main) {
      for (const idB of ORIGINAL.BATTLE_LINES[lb].main) {
        cases.push({
          idA, idB,
          balanced: n % 2 === 0,
          scene: SCENES[n % SCENES.length],
          opener: OPENERS[(n >> 1) % OPENERS.length],
          arenaEffects: n % 3 !== 0,
          cpuB: n % 4 === 0,
          cpuSkill: SKILLS[n % SKILLS.length],
          cpuOnA: n % 5 === 0,
          seed: 1000 + n * 7919,
        });
        n++;
      }
    }
  }
}

test('fixture provenance: original engine fixture exposes the full engine surface', () => {
  for (const name of ['battleRound', 'applyAttack', 'battleStats', 'signatureSpec', 'simulateBattle', 'chooseCpuBattleMove', 'battleArenaPulse']) {
    assert.equal(typeof ORIGINAL[name], 'function', `missing ${name}`);
  }
  assert.equal(Object.keys(ORIGINAL.BATTLE_SCENE_RULES).length, 4);
  assert.deepEqual(Object.keys(ORIGINAL.BATTLE_COUNTER).sort(), ['flex', 'read', 'serve']);
});

test('engine surface parity: core exports every original declaration', () => {
  // `battleState` is the fixture's DOM-free stub of the UI-owned state object;
  // the core replaces it with bindContext()/getContext() by design.
  for (const name of Object.keys(ORIGINAL)) {
    if (name === 'battleState') continue;
    assert.ok(name in CORE, `core is missing ${name}`);
  }
  assert.equal(typeof CORE.bindContext, 'function');
  assert.equal(typeof CORE.getContext, 'function');
});

test('static derivation parity: battleStats / passives / signatures', () => {
  for (const e of DEX) {
    for (const balanced of [true, false]) {
      assert.deepEqual(CORE.battleStats(e, balanced), ORIGINAL.battleStats(e, balanced), `battleStats ${e.id} balanced=${balanced}`);
    }
    assert.deepEqual(CORE.stagePassive(e), ORIGINAL.stagePassive(e), `stagePassive ${e.id}`);
    assert.equal(CORE.lineagePassive(e), ORIGINAL.lineagePassive(e), `lineagePassive ${e.id}`);
    for (const f of [0, 0.35, 0.5, 0.999]) {
      assert.deepEqual(
        CORE.signatureSpec({ entry: e, stats: CORE.battleStats(e, true) }, () => f),
        ORIGINAL.signatureSpec({ entry: e, stats: ORIGINAL.battleStats(e, true) }, () => f),
        `signatureSpec ${e.id} rng=${f}`);
    }
  }
});

test(`deterministic equivalence: ${cases.length} full matches identical to the original engine`, () => {
  for (const c of cases) {
    const a = snapshot(play(ORIGINAL, c.idA, c.idB, c));
    const b = snapshot(play(CORE, c.idA, c.idB, c));
    assert.deepEqual(b, a, `divergence for ${c.idA} vs ${c.idB} ${JSON.stringify(c)}`);
  }
});

test('seeded replay: identical seed reproduces identical battle truth', () => {
  const opts = { balanced: true, scene: 'pride', opener: 'random', arenaEffects: true, cpuB: true, cpuSkill: 'nemesis', cpuOnA: false, seed: 777777 };
  const first = snapshot(play(CORE, 'mega-bear', 'mega-otter', opts));
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(snapshot(play(CORE, 'mega-bear', 'mega-otter', opts)), first, `replay ${i} diverged`);
  }
  // A different seed must be allowed to differ — the engine is seeded, not frozen.
  const other = snapshot(play(CORE, 'mega-bear', 'mega-otter', { ...opts, seed: 777778 }));
  assert.notDeepEqual(other.log, first.log, 'different seeds produced identical logs — RNG is not being consumed');
});

test('fast-sim parity: simulateBattle matches the original across the ladder', () => {
  // simulateBattle reads scene/arenaEffects from the live context, exactly as
  // the original read them off battleState.  Bind both sides to the same
  // context so the comparison measures the engine, not the harness.
  const ORIGINAL_DEFAULTS = { ...ORIGINAL.battleState };
  for (const scene of SCENES) {
    for (const arenaEffects of [true, false]) {
      Object.assign(ORIGINAL.battleState, { scene, arenaEffects });
      CORE.bindContext({ scene, arenaEffects, intro: 'sweep', cpuSkill: 'rival' });
      fastSimParity(scene, arenaEffects);
    }
  }
  Object.assign(ORIGINAL.battleState, ORIGINAL_DEFAULTS);
  CORE.bindContext({ scene: 'prism', arenaEffects: true, intro: 'sweep', cpuSkill: 'rival' });
});

function fastSimParity(scene, arenaEffects) {
  for (const la of LINES) {
    for (const lb of LINES) {
      for (let i = 0; i < ORIGINAL.BATTLE_LINES[la].main.length; i++) {
        const ea = BY_ID[ORIGINAL.BATTLE_LINES[la].main[i]];
        const eb = BY_ID[ORIGINAL.BATTLE_LINES[lb].main[i]];
        for (const seed of [1, 4242, 999983]) {
          const x = ORIGINAL.simulateBattle(ea, eb, true, seed);
          const y = CORE.simulateBattle(ea, eb, true, seed);
          assert.equal(y.winner, x.winner, `${ea.id} v ${eb.id} seed ${seed}`);
          assert.equal(y.a.hp, x.a.hp);
          assert.equal(y.b.hp, x.b.hp);
          assert.equal(y.round, x.round, `${ea.id} v ${eb.id} seed ${seed} scene ${scene} fx ${arenaEffects}`);
        }
      }
    }
  }
}

test('arena rule tables are unchanged', () => {
  assert.deepEqual(CORE.BATTLE_SCENE_RULES, ORIGINAL.BATTLE_SCENE_RULES);
  assert.deepEqual(CORE.BATTLE_OPENER_RULES, ORIGINAL.BATTLE_OPENER_RULES);
  assert.deepEqual(CORE.BATTLE_PULSE_FORECAST, ORIGINAL.BATTLE_PULSE_FORECAST);
  assert.deepEqual(CORE.BATTLE_LINES, ORIGINAL.BATTLE_LINES);
  assert.deepEqual(CORE.BATTLE_MOVES, ORIGINAL.BATTLE_MOVES);
});

test('core is DOM-free: no document/window/canvas references in engine bodies', () => {
  const src = readFileSync(join(ROOT, 'src/battle-core.js'), 'utf8');
  const bodyOnly = src.slice(src.indexOf('const BATTLE_LINES'));
  for (const banned of ['document.', 'getElementById', 'querySelector', ".getContext('", 'requestAnimationFrame', 'THREE.']) {
    assert.ok(!bodyOnly.includes(banned), `engine must not reference ${banned}`);
  }
});
