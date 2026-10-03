/**
 * GayDex: Circuit — spatial world tests.
 *
 * These run the REAL Circuit scene code against the REAL vendored three.js
 * (r186) and the REAL battle engine, in Node. Only a GL context needs a
 * browser; scene construction, transforms, raycasting, instancing, shader
 * materials and disposal all execute for real here.
 *
 * The adapter is fed a faithful stand-in for window.GayDexApp: it serves the
 * canonical 19-entry taxonomy, delegates every battle question to the verbatim
 * engine, and uses the Evolution Lab scoring lifted verbatim out of src/app.js
 * — so Circuit cannot drift from gameplay truth inside this test.
 *
 * Run: node --test tests/circuit-world.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEX = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/dex-entries.json'), 'utf8'));

const CIRCUIT_FILES = ['00-namespace.js', '05-state.js', '10-assets.js', '20-runtime.js', '30-geography.js', '40-specimens.js', '50-input.js', '60-battle3d.js', '70-compare-lab.js', '80-circuit-mode.js'];

function loadCore() {
  const mod = { exports: {} };
  new Function('module', 'exports', readFileSync(join(ROOT, 'src/battle-core.js'), 'utf8'))(mod, mod.exports);
  return mod.exports;
}
const Core = loadCore();

/**
 * The Evolution Lab scoring lives in the application layer, not the engine.
 * Lift it straight out of src/app.js so this test exercises the real function
 * rather than a paraphrase of it.
 */
function realLabScoring() {
  const src = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
  const labMapSrc = src.match(/^const labMap=\{.*\};$/m);
  const scoreSrc = src.match(/^function scoreEntry\(e,vals\)\{.*\}$/m);
  const candSrc = src.match(/^function labCandidates\(vals\)\{[\s\S]*?^\}$/m);
  assert.ok(labMapSrc && scoreSrc && candSrc, 'could not locate the real lab scoring in src/app.js');
  const make = new Function('GAYDEX', `${labMapSrc[0]}\n${scoreSrc[0]}\n${candSrc[0]}\nreturn labCandidates;`);
  return make(DEX);
}

/** Isolated realm holding three.js + the Circuit modules. */
function makeRealm() {
  const noop = () => {};
  const store = new Map();
  const sandbox = {
    console, Math, JSON, Date, Set, Map, WeakMap, Array, Object, Number, String, Boolean,
    Error, TypeError, Promise, Symbol, RegExp, isNaN, isFinite, parseInt, parseFloat,
    Uint8Array, Uint8ClampedArray, Float32Array, Uint16Array, Uint32Array, Int16Array, Int32Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    performance, Image: class { set src(_v) { /* never decodes: placeholder path */ } },
    navigator: { userAgent: 'node' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, 'vendor/three.iife.min.js'), 'utf8'), ctx, { filename: 'three.iife.min.js' });
  assert.equal(String(sandbox.THREE.REVISION), '186', 'vendored three revision');
  for (const f of CIRCUIT_FILES) {
    vm.runInContext(readFileSync(join(ROOT, 'src/circuit', f), 'utf8'), ctx, { filename: 'src/circuit/' + f });
  }
  return sandbox;
}

/**
 * Faithful stand-in for the window.GayDexApp bridge. Data comes from the
 * canonical fixture; every battle question is answered by the verbatim engine.
 */
function makeFakeApp() {
  const lines = { Twink: [], Cub: [], Otter: [], Independent: [] };
  const byId = new Map();
  for (const e of DEX) { byId.set(e.id, e); lines[e.line].push(e); }
  const labCandidates = realLabScoring();

  const battleState = {
    scene: 'prism', intro: 'sweep', arenaEffects: true, speed: 1, sfx: false, balanced: true,
    cpuB: true, cpuSkill: 'rival', fxMode: 'standard', motionMode: 'standard',
    idA: 'twunk', idB: 'bear', moveA: 'flex', moveB: 'serve', match: null, log: [],
  };
  const state = { selected: null, seen: new Set(), favs: new Set(), compare: new Set(), perf: 'auto', atlasOpen: false };
  const labStore = { build: 'slim', hair: 'smooth', age: 'young', vibe: 'boyish' };
  const hooks = [];
  const seats = [];

  return {
    version: 'test', dex: DEX, atlasLines: Core.BATTLE_LINES, statNames: ['Youth', 'Power', 'Hair', 'Maturity', 'Vibe'],
    colors: Core.BATTLE_LINE_COLORS, lineColor: (l) => Core.BATTLE_LINE_COLORS[l] || Core.BATTLE_DEFAULT_COLOR,
    esc: (s) => String(s),
    entry: (id) => byId.get(id) || null,
    stagePassive: Core.battleStagePassive, lineagePassive: Core.battleLineagePassive,
    signatureSpec: Core.battleSignatureSpec, battleStats: Core.battleStats,
    battleAvatarFor: () => '',
    state, battleState,
    save: () => {}, storageGet: () => null, storageSet: () => {},
    markSeen(id) { if (!byId.has(id) || state.seen.has(id)) return false; state.seen.add(id); return true; },
    selectEntry: (id) => { state.selected = id; },
    toggleCompare(id) { if (state.compare.has(id)) state.compare.delete(id); else if (state.compare.size < 3) state.compare.add(id); },
    compareIds: () => [...state.compare].filter((id) => byId.has(id)).slice(0, 3),
    BattleCore: Core,
    battleEntriesForLine: (l) => lines[l] || [],
    setBattleScene(scene) { if (!Core.BATTLE_SCENE_RULES[scene]) return false; battleState.scene = scene; return true; },
    /** Seat a pair with the real engine and resolve it, emitting real events. */
    setFighters(idA, idB) {
      const a = byId.get(idA), b = byId.get(idB);
      if (!a || !b) return false;
      seats.push([idA, idB]);
      const m = Core.makeBattleMatch(a, b, battleState.balanced, Core.hashSeed(`circuit|${idA}|${idB}`));
      m.scene = battleState.scene;
      Core.applyBattleOpener(m);
      battleState.match = m;
      battleState.idA = idA; battleState.idB = idB;
      let guard = 0;
      while (!m.ended && guard++ < 60) {
        const events = Core.battleRound(m, Core.aiBattleMove(m.a, m.b, m.decisionRng, m), Core.aiBattleMove(m.b, m.a, m.decisionRng, m));
        for (const ev of events) for (const h of hooks.slice()) h(ev, m);
      }
      return true;
    },
    setCpu: () => true,
    resetBattle: () => {}, resolveBattleRound: () => [], autoBattle: () => {},
    runLineageSeries: () => [], randomBattleRival: () => null, populateBattleStages: () => '',
    labCandidates,
    labVals: () => ({ ...labStore }),
    setLabVals(v) { for (const k of ['build', 'hair', 'age', 'vibe']) if (v[k] != null) labStore[k] = v[k]; },
    runLab: () => labCandidates(labStore),
    onBattleEvent(fn) { hooks.push(fn); return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); }; },
    emitBattleEvent(e) { for (const h of hooks.slice()) h(e, battleState.match); },
    __seats: seats, __byId: byId, __labStore: labStore,
  };
}

/** Build the Circuit stack exactly as 90-boot.js does. */
function buildStack() {
  const sandbox = makeRealm();
  const App = makeFakeApp();
  sandbox.GayDexApp = App;
  const C = sandbox.GayDexCircuit;
  const THREE = sandbox.THREE;

  const adapter = C.createAdapter(App);
  const assets = C.createAssets(THREE, { textureBudget: 26, labelBudget: 44 });
  const world = C.createWorld(THREE, { assets });
  for (const line of Object.keys(C.ROUTES)) {
    world.buildRoute(line, (id) => adapter.entry(id), Core.BATTLE_LINES[line]);
  }
  const specimens = C.createSpecimenField(THREE, { assets, world });
  for (const [line, route] of Object.entries(world.routes)) {
    for (const n of route.nodes) specimens.add(n.entry, n.world, { district: route.district, line });
  }
  for (const e of adapter.entries()) {
    if (specimens.get(e.id)) continue;
    specimens.add(e, [C.DISTRICTS.prism.center[0], C.DISTRICTS.prism.center[1] + 20], { district: 'prism', line: e.line });
  }
  world.root.updateMatrixWorld(true);

  const compare = C.createCompareRing(THREE, { world, assets, entryOf: (id) => adapter.entry(id) });
  const lab = C.createSpatialLab(THREE, { world, assets, adapter });
  const battle = C.createBattleLayer(THREE, { runtime: null, world, assets });
  const circuitMode = C.createCircuitMode({ adapter, world, runtime: null, onStatus: () => {}, onReport: () => {}, onBoutStart: () => {}, onBoutEnd: () => {} });

  return { sandbox, C, THREE, App, adapter, assets, world, specimens, compare, lab, battle, circuitMode };
}

function countNodes(obj) { let n = 0; obj.traverse(() => { n++; }); return n; }

let stack = null;
function S() { if (!stack) stack = buildStack(); return stack; }

/* ------------------------------------------------------------------ */

test('namespace: nexus + four districts, engine scenes mapped to districts', () => {
  const { C } = S();
  assert.deepEqual(Object.keys(C.DISTRICTS), ['nexus', 'prism', 'aqua', 'pride', 'emerald']);
  // Engine scene ids are prism/aqua/pride/forest; Emerald owns "forest".
  assert.deepEqual(Object.keys(C.SCENE_TO_DISTRICT).sort(), ['aqua', 'forest', 'pride', 'prism']);
  assert.equal(C.SCENE_TO_DISTRICT.forest, 'emerald');
  assert.equal(C.DISTRICT_TO_SCENE.emerald, 'forest');
  assert.deepEqual([...C.DISTRICTS.nexus.center], [0, 0]);
  for (const id of ['prism', 'aqua', 'pride', 'emerald']) {
    assert.equal(C.DISTRICTS[id].radius, 34);
    assert.equal(typeof C.DISTRICTS[id].color, 'number');
  }
  assert.equal(C.DISTRICTS.prism.line, 'Twink');
  assert.equal(C.DISTRICTS.aqua.line, 'Otter');
  assert.equal(C.DISTRICTS.emerald.line, 'Cub');
  assert.equal(C.DISTRICTS.pride.line, 'Independent');
  assert.deepEqual([...C.QUALITY_STEPS].sort(), ['auto', 'eco', 'high']);
});

test('world: four districts at their authored coordinates, plus gateway arches', () => {
  const { world, C } = S();
  assert.ok(world.root.isObject3D);
  assert.ok(countNodes(world.root) > 200, `world too sparse: ${countNodes(world.root)} nodes`);
  for (const id of ['prism', 'aqua', 'pride', 'emerald']) {
    const d = world.districts[id];
    assert.ok(d && d.group.isObject3D, `${id} district missing`);
    assert.equal(d.group.position.x, C.DISTRICTS[id].center[0]);
    assert.equal(d.group.position.z, C.DISTRICTS[id].center[1]);
  }
  const gateways = [];
  world.root.traverse((o) => { if (o.userData && o.userData.kind === 'gateway' && o.isMesh) gateways.push(o); });
  assert.ok(gateways.length >= 4, `expected gateway geometry, found ${gateways.length}`);
  assert.deepEqual([...new Set(gateways.map((g) => g.userData.district))].sort(), ['aqua', 'emerald', 'pride', 'prism']);
  assert.equal(world.districtAt(0, 0), 'nexus', 'origin is the transit nexus');
});

test('geography: every canonical form is placed once, inside its own lineage district', () => {
  const { world, specimens, adapter } = S();
  const placed = specimens.all();
  assert.equal(placed.length, 19, `expected all 19 canonical forms, got ${placed.length}`);
  for (const s of placed) {
    const e = adapter.entry(s.id);
    assert.ok(e, `${s.id} is not a canonical entry`);
    assert.equal(s.entry.id, e.id);
    assert.equal(s.meta.line, e.line);
    const expect = { Twink: 'prism', Cub: 'emerald', Otter: 'aqua', Independent: 'pride' }[e.line];
    assert.equal(world.districtAt(s.group.position.x, s.group.position.z), expect, `${s.id} in wrong district`);
  }
});

test('routes: three ladders with a variant spur; Independent gets no ladder and no tube', () => {
  const { world, specimens } = S();
  assert.deepEqual(Object.keys(world.routes).sort(), ['Cub', 'Independent', 'Otter', 'Twink']);

  for (const line of ['Twink', 'Cub', 'Otter']) {
    const r = world.routes[line];
    const main = r.nodes.filter((n) => !n.variant);
    const variants = r.nodes.filter((n) => n.variant);
    // The ids on the pads are the engine's canonical ladder, in order.
    assert.deepEqual([...main.map((n) => n.id)], [...Core.BATTLE_LINES[line].main], `${line} ladder must match the engine`);
    // Stages come from canonical data and are not uniform across lines
    // (the Otter starter is "Starter Variant"), so assert the shape that
    // matters: three non-Mega steps then the Mega anchor.
    assert.equal(main[3].entry.stage, 'Mega', `${line} fourth pad must be the Mega form`);
    for (const n of main.slice(0, 3)) assert.notEqual(n.entry.stage, 'Mega', `${n.id} must not be Mega`);
    assert.equal(variants.length, 1, `${line} variant missing`);
    assert.equal(variants[0].id, Core.BATTLE_LINES[line].variant);
    assert.match(variants[0].entry.stage, /Variant/, 'variant pad must hold a canonical Variant form');
    assert.equal(variants[0].id, Core.BATTLE_LINES[line].variant, 'variant must be the engine\'s variant for that line');
    // The variant hangs off the tube rather than sitting on it.
    let minDist = Infinity;
    for (const m of main) minDist = Math.min(minDist, Math.hypot(m.world[0] - variants[0].world[0], m.world[1] - variants[0].world[1]));
    assert.ok(minDist > 5, `${line} variant only ${minDist.toFixed(1)} from the main tube`);
    // Mega is the far anchor, and gets its gate.
    const mega = main[3], starter = main[0];
    assert.ok(Math.hypot(mega.world[0] - starter.world[0], mega.world[1] - starter.world[1]) > 20, 'Mega should sit far down the route');
    let gates = 0;
    mega.node.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry' && o.scale.y === 1 && o.position.y === 5.5) gates++; });
    assert.ok(gates >= 2, 'Mega pad should have a dramatic gate');
    for (const n of r.nodes) assert.ok(specimens.get(n.id), `route node ${n.id} has no specimen`);
  }

  const ind = world.routes.Independent;
  assert.equal(ind.shape, 'pavilion');
  assert.deepEqual([...ind.nodes.map((n) => n.id)], [...Core.BATTLE_LINES.Independent.main]);
  assert.equal(ind.nodes.length, 4, 'all four Independent forms stand freely');
  assert.ok(!ind.nodes.some((n) => n.variant), 'Independent has no variant spur');
  // No connecting tube: they are not a progression.
  let tubes = 0;
  ind.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'TubeGeometry') tubes++; });
  assert.equal(tubes, 0, 'Independent forms must not be joined into a ladder');
});

test('raycasting: aiming the camera at a specimen actually hits it', () => {
  const { THREE, world, specimens } = S();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 900);
  const s0 = specimens.get('twink');
  cam.position.set(s0.group.position.x, 3.2, s0.group.position.z + 8);
  cam.lookAt(s0.group.position.x, 3.2, s0.group.position.z);
  cam.updateMatrixWorld(true);
  world.root.updateMatrixWorld(true);

  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), cam);
  const hits = rc.intersectObjects(specimens.hitTargets, false);
  assert.ok(hits.length > 0, 'raycast found nothing');
  assert.equal(hits[0].object.userData.kind, 'specimen');
  assert.equal(hits[0].object.userData.id, 'twink', 'nearest hit should be the aimed specimen');
  assert.equal(hits[0].object.material.visible, false, 'hit proxy must be invisible');
  assert.equal(new Set(specimens.hitTargets).size, specimens.hitTargets.length, 'duplicate hit targets');
  assert.equal(specimens.hitTargets.length, 19);

  // Gateways are raycastable through their generous invisible hit proxy.
  const gw = [];
  world.root.traverse((o) => { if (o.userData && o.userData.kind === 'gateway' && o.isMesh && o.userData.label) gw.push(o); });
  assert.equal(gw.length, 4, 'one hit proxy per district gateway');
  const cam2 = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  cam2.position.set(0, 3, 0);
  cam2.lookAt(gw[0].getWorldPosition(new THREE.Vector3()));
  cam2.updateMatrixWorld(true);
  rc.setFromCamera(new THREE.Vector2(0, 0), cam2);
  const gwHits = rc.intersectObjects(gw, false);
  assert.ok(gwHits.length > 0, 'gateway hit proxy not raycastable from the nexus centre');
  assert.equal(gwHits[0].object.userData.kind, 'gateway');
  assert.ok(['prism', 'aqua', 'pride', 'emerald'].includes(gwHits[0].object.userData.district));

  // A player walking straight down a spoke fires a ray lying exactly in the
  // gateway cylinder's symmetry plane; the proxy must still register.
  for (const id of ['prism', 'aqua', 'pride', 'emerald']) {
    const proxy = gw.find((o) => o.userData.district === id);
    const target = proxy.getWorldPosition(new THREE.Vector3());
    const spoke = new THREE.PerspectiveCamera(62, 1.6, 0.1, 400);
    spoke.position.set(0, 2, 0);
    spoke.lookAt(target);
    spoke.updateMatrixWorld(true);
    rc.setFromCamera(new THREE.Vector2(0, 0), spoke);
    const hits = rc.intersectObjects(gw, false);
    assert.ok(hits.length > 0, `${id} gateway un-pickable from straight down its spoke`);
    assert.equal(hits[0].object.userData.district, id);
  }
});

test('proximity: update() reports the specimen the camera stands next to', () => {
  const { THREE, specimens } = S();
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  cam.position.set(0, 2, 0);
  assert.equal(specimens.update(0.016, 0, 1, {}, cam), null, 'nexus centre is near nothing');

  const otter = specimens.get('otter');
  cam.position.set(otter.group.position.x, 2, otter.group.position.z + 2.5);
  assert.equal(specimens.update(0.016, 0.1, 1, {}, cam), 'otter');
  assert.equal(specimens.nearestId, 'otter');
  // `near` and the billboard yaw are damped, so let them converge.
  for (let f = 0; f < 90; f++) specimens.update(0.016, 0.1 + f * 0.016, 1, {}, cam);
  assert.ok(otter.near > 0.8, `nearby specimen should register proximity, got ${otter.near.toFixed(3)}`);
  assert.ok(specimens.updateStats.culled >= 10, `expected distant specimen culling, got ${specimens.updateStats.culled}`);
  assert.ok(specimens.updateStats.active < specimens.updateStats.total, 'not every specimen should animate at once');
  // Yaw-only billboard: specimens never tip over.
  assert.ok(Math.abs(otter.group.rotation.x) < 1e-9, 'specimen must not pitch');
  assert.ok(Math.abs(otter.group.rotation.z) < 1e-9, 'specimen must not roll');
  const yawToCam = Math.atan2(cam.position.x - otter.group.position.x, cam.position.z - otter.group.position.z);
  assert.ok(Math.abs(((otter.group.rotation.y - yawToCam + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.05, 'specimen should face the camera');

  cam.position.set(0, 2, 0);
  assert.equal(specimens.update(0.016, 0.2, 1, {}, cam), null);
});

test('discovery: undiscovered forms are rim-only silhouettes until scanned', () => {
  const { specimens, adapter } = S();
  const s = specimens.get('mega-bear');
  specimens.setDiscovered('mega-bear', false);
  assert.equal(s.portrait.visible, false, 'undiscovered portrait must be hidden');
  assert.equal(s.rim.visible, true, 'silhouette stays so the form is still findable');
  assert.equal(s.discovered, false);

  const fresh = adapter.scan('mega-bear');
  assert.ok(fresh && fresh.id === 'mega-bear');
  specimens.setDiscovered('mega-bear', true);
  assert.equal(s.portrait.visible, true);
  assert.ok(s.rim.material.uniforms.uOpacity.value < 0.9, 'revealed form should dim the outline');

  const before = adapter.discoveredCount();
  adapter.scan('mega-bear');
  assert.equal(adapter.discoveredCount(), before, 're-scan must not double-count');
  specimens.setDiscovered('mega-bear', false);
});

test('district ambience: each district owns its own reactive state', () => {
  const { world, C } = S();
  assert.equal(typeof world.districts.aqua.setFlow, 'function');
  assert.equal(typeof world.districts.pride.setHype, 'function');
  assert.equal(typeof world.districts.pride.setCrowdCount, 'function');
  assert.equal(typeof world.districts.emerald.setRecovery, 'function');
  assert.equal(typeof world.districts.prism.lab.pulse, 'function');

  world.districts.aqua.setFlow(0.9);
  assert.equal(world.districts.aqua.water.material.uniforms.uFlow.value, 0.9, 'Flow must reach the water shader');
  world.districts.pride.setHype(1);
  assert.equal(world.districts.pride.hype, 1);
  world.districts.emerald.setRecovery(0.5);

  const crowd = world.districts.pride.crowd;
  assert.ok(crowd.isInstancedMesh, 'crowd must use InstancedMesh');
  assert.ok(crowd.count <= 520, `crowd cap exceeded: ${crowd.count}`);

  world.setQuality(C.QUALITY.eco);
  world.update(0.016, 1, 1, C.QUALITY.eco);
  assert.ok(world.districts.pride.crowdActive <= C.QUALITY.eco.crowd, `ECO crowd should thin: ${world.districts.pride.crowdActive}`);
  world.setQuality(C.QUALITY.high);
  world.update(0.016, 1.1, 1, C.QUALITY.high);
  assert.ok(world.districts.pride.crowdActive > C.QUALITY.eco.crowd, 'HIGH crowd should be denser than ECO');

  world.setActiveDistrict('pride');
  assert.equal(world.activeDistrict, 'pride');
  world.update(0.016, 1.15, 1, C.QUALITY.high);
  assert.ok(world.updateStats.updatersRun <= 2, `too many district updaters ran: ${world.updateStats.updatersRun}`);
  assert.ok(world.updateStats.routeNodesUpdated <= 8, `too many route nodes updated: ${world.updateStats.routeNodesUpdated}`);
  world.pulseFocus(1);
  world.update(0.016, 1.16, 1, C.QUALITY.high);
  assert.ok(world.updateStats.frame > 0, 'world update telemetry should advance');
  world.setActiveDistrict('nowhere');
  assert.equal(world.activeDistrict, 'nexus', 'unknown district falls back to the nexus');
  world.pulseRipple(3, 4);
  world.update(0.016, 1.2, 1, C.QUALITY.high);
});


test('world scheduler: active district stays hot while remote ambience is throttled, with a focus flare on arrival', () => {
  const { world, C } = S();
  world.setActiveDistrict('pride');

  const prismBefore = world.districts.prism.dome.rotation.y;
  const prideBefore = world.districts.pride.rings[0].mesh.rotation.z;
  world.update(1 / 60, 2, 1, C.QUALITY.auto);

  assert.equal(world.districts.prism.dome.rotation.y, prismBefore, 'inactive Prism should skip the first remote frame');
  assert.notEqual(world.districts.pride.rings[0].mesh.rotation.z, prideBefore, 'active Pride should update every frame');

  for (let i = 0; i < 7; i++) world.update(1 / 60, 2 + (i + 1) / 60, 1, C.QUALITY.auto);
  assert.notEqual(world.districts.prism.dome.rotation.y, prismBefore, 'inactive Prism should still advance on the reduced cadence');

  const gates = [];
  world.root.traverse((o) => {
    if (o.userData?.kind === 'gateway' && !o.userData.label) gates.push(o);
  });
  const prideGate = gates.find((g) => g.userData.district === 'pride');
  assert.ok(prideGate, 'Pride gateway arch missing');

  world.setActiveDistrict('nexus');
  for (let i = 0; i < 90; i++) world.update(1 / 60, 3 + i / 60, 1, C.QUALITY.auto);
  world.setActiveDistrict('pride');
  world.update(1 / 60, 5, 1, C.QUALITY.auto);
  assert.ok(prideGate.scale.x > 1.05, 'district acquisition should flare the destination gate');
});

test('compare ring: shows up to three forms spread around a circle', () => {
  const { compare, adapter } = S();
  const slotGroups = () => compare.group.children.filter((c) => c.isGroup);
  const visibleSlots = () => slotGroups().filter((g) => g.visible);

  compare.hide();
  assert.equal(compare.group.visible, false);
  assert.equal(compare.active, false);
  assert.equal(slotGroups().length, 3, 'ring must hold three slots');

  compare.show(['twink'], [0, 0]);
  assert.equal(compare.group.visible, true);
  assert.equal(compare.active, true);
  assert.equal(visibleSlots().length, 1);

  compare.show(['twink', 'bear'], [0, 0]);
  assert.equal(visibleSlots().length, 2);

  compare.show(['twink', 'bear', 'otter'], [0, 0]);
  assert.equal(visibleSlots().length, 3);
  const angles = visibleSlots().map((g) => Math.atan2(g.position.x, g.position.z).toFixed(2));
  assert.equal(new Set(angles).size, 3, 'pinned forms must be spread around the ring, not stacked');

  // A fourth pin is capped by the adapter, and the ring follows the adapter.
  for (const id of ['twink', 'bear', 'otter', 'daddy']) adapter.toggleCompare(id);
  const ids = adapter.compareIds();
  assert.equal(ids.length, 3, 'compare must cap at three');
  compare.show(ids, [0, 0]);
  assert.equal(visibleSlots().length, 3);
  compare.hide();
});

test('spatial lab: dials drive the SAME labCandidates() the conventional form uses', () => {
  const { lab, adapter, App } = S();
  assert.deepEqual([...lab.DIAL_KEYS], ['build', 'hair', 'age', 'vibe']);
  for (const k of lab.DIAL_KEYS) assert.ok(lab.OPTIONS[k].length >= 4, `${k} options`);
  assert.equal(lab.holos.length, 3, 'lab shows the top three candidates');

  const target = { build: 'large', hair: 'hairy', age: 'adult', vibe: 'rugged' };
  for (let i = 0; i < lab.DIAL_KEYS.length; i++) {
    const key = lab.DIAL_KEYS[i];
    let guard = 0;
    while (lab.state[key] !== target[key] && guard++ < 12) lab.cycleDial(i, 1);
    assert.equal(lab.state[key], target[key], `dial ${key} could not reach ${target[key]}`);
  }
  // The dials wrote through to the conventional lab inputs.
  assert.deepEqual(App.labVals(), target, 'spatial dials did not update the canonical lab inputs');

  lab.run();
  const fromDials = lab.results.map((r) => r.id);
  const fromForm = adapter.labCandidates(target).map((c) => c[0].id);
  assert.deepEqual(fromDials, fromForm, 'spatial lab diverged from the conventional lab');
  assert.equal(fromDials.length, 3);
  for (const id of fromDials) assert.notEqual(App.entry(id).stage, 'Mega', 'Mega must stay excluded');
  assert.ok(fromDials.some((id) => App.entry(id).line === 'Cub'), 'large/hairy/rugged should surface the Cub lineage');
  const scores = lab.results.map((r) => r.score);
  assert.ok(scores[0] >= scores[1] && scores[1] >= scores[2], 'candidates must stay sorted by score');
  assert.equal(lab.holos.filter((h) => h.entry).length, 3, 'all three holos should be populated');
  lab.hide();
  assert.equal(lab.active, false);
});

/** Build the adapter-shaped snapshot the battle layer consumes. */
function snapOf(adapter) { return adapter.battleSnapshot(); }

test('battle layer: consumes engine events and never recomputes a round', () => {
  const { battle, App, adapter } = S();
  const a = App.entry('twunk'), b = App.entry('mega-bear');
  App.setFighters('twunk', 'mega-bear');
  const m = App.battleState.match;
  assert.ok(m && m.ended, 'fake app should have resolved the seated bout');

  battle.setScene('prism');
  battle.enter({ entryA: a, entryB: b });
  assert.equal(battle.active, true);
  assert.equal(battle.group.visible, true);
  assert.equal(battle.sceneId, 'prism');

  // Replay a fresh, unresolved match so events arrive one at a time.
  const live = Core.makeBattleMatch(a, b, true, 4242);
  live.scene = 'prism';
  Core.applyBattleOpener(live);
  App.battleState.match = live;
  battle.setState(snapOf(adapter));

  let guard = 0, events = 0;
  while (!live.ended && guard++ < 60) {
    for (const ev of Core.battleRound(live, Core.aiBattleMove(live.a, live.b, live.decisionRng, live), Core.aiBattleMove(live.b, live.a, live.decisionRng, live))) {
      battle.onEvent(ev);
      events++;
    }
    battle.setState(snapOf(adapter));
    battle.update(0.016, 0.1, 1);
  }
  assert.ok(live.ended);
  assert.ok(events > 0, 'no engine events were emitted');
  assert.ok(battle.liveShards > 0, `no instanced debris after ${events} real events`);

  battle.exit();
  assert.equal(battle.group.visible, false);
  assert.equal(battle.active, false);
  assert.equal(battle.liveShards, 0, 'debris pool must be cleared on exit');
});

test('battle layer: FLEX / SERVE / READ / GUARD+fatigue / FLOW / HYPE all have visual state', () => {
  const { battle, App, adapter } = S();
  const a = App.entry('otter'), b = App.entry('mature-otter');
  App.setFighters('otter', 'mature-otter');
  battle.setScene('aqua');
  battle.enter({ entryA: a, entryB: b });

  for (const side of ['a', 'b']) {
    const rig = battle.rigs[side];
    assert.ok(rig, `${side} rig missing`);
    for (const k of ['portrait', 'rimMesh', 'guard', 'guardMat', 'pad', 'hype', 'hypeMat', 'flowSegs', 'readLattice', 'ghost']) {
      assert.ok(rig[k] != null, `${side} rig missing ${k}`);
    }
    assert.equal(rig.flowSegs.length, 4, 'FLOW circuit should be four segments');
  }

  const live = Core.makeBattleMatch(a, b, true, 77);
  live.scene = 'aqua';
  Core.applyBattleOpener(live);
  App.battleState.match = live;

  // HYPE is engine state, read straight off the match through the adapter.
  live.a.hype = 100;
  battle.setState(snapOf(adapter));
  for (let f = 0; f < 90; f++) battle.update(0.016, 0.3 + f * 0.016, 1);
  assert.ok(battle.rigs.a.hype.scale.y > 0.9, `HYPE 100 must raise the signature column, got ${battle.rigs.a.hype.scale.y.toFixed(3)}`);
  assert.ok(battle.rigs.a.hypeMat.opacity > 0.5, 'signature column should brighten at full HYPE');
  assert.ok(battle.hypePeak >= 0.99, `hype peak should reach full, got ${battle.hypePeak}`);

  // GUARD + fatigue: guard chain is engine state and drives the shell.
  live.b.guardChain = 3;
  battle.onEvent({ kind: 'guard', side: 'b', move: 'guard', guardChain: 3 });
  battle.setState(snapOf(adapter));
  assert.equal(battle.rigs.b.guard.visible, true, 'guard shell must appear on a GUARD event');
  assert.equal(battle.rigs.b.guardShow, 1);

  // READ LOCK lights the anticipation lattice on the defender.
  battle.onEvent({ kind: 'damage', side: 'a', type: 'insight', move: 'read', predicted: true, damage: 12 });
  assert.equal(battle.rigs.b.readLattice.visible, true, 'READ LOCK must light the read lattice');
  assert.equal(battle.rigs.b.ghost.visible, true, 'READ LOCK must show the predicted ghost');
  assert.ok(battle.rigs.b.readShow > 1, 'READ LOCK should read stronger than a plain READ');

  // FLOW BREAK discharges the completed circuit.
  battle.onEvent({ kind: 'damage', side: 'a', type: 'style', move: 'serve', flowBurst: true, damage: 20 });
  assert.equal(battle.rigs.a.flowFlash, 1, 'FLOW BREAK must flash the flow circuit');

  // FLEX pressure travels through the floor.
  battle.onEvent({ kind: 'damage', side: 'b', type: 'force', move: 'flex', damage: 15 });
  battle.update(0.016, 0.4, 1);

  // Signature readiness comes from engine cooldown + hype, never the layer.
  live.a.sigCd = 0; live.a.hype = 100;
  battle.setState(snapOf(adapter));
  assert.equal(snapOf(adapter).a.signatureReady, true, 'engine should report signature ready');

  battle.pulse('#ffffff', 1);
  battle.setQualityMode('eco');
  battle.setMotion(true);
  battle.update(0.016, 0.5, 0);
  battle.exit();
});

test('circuit mode: refuses Independent ladders instead of inventing one', () => {
  const { circuitMode } = S();
  const bad = circuitMode.seriesFor('Independent', 'Cub');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Independent/);
  assert.equal(circuitMode.start('Independent', 'Cub'), null, 'must not start an impossible ladder');
  assert.equal(circuitMode.state.running, false);
  assert.equal(circuitMode.seriesFor('Nope', 'Cub').ok, false);
});

test('circuit mode: walks Starter→Stage II→Stage III→Mega→Variant and reports only measured totals', async () => {
  const { circuitMode, App } = S();
  const plan = circuitMode.seriesFor('Twink', 'Cub');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.pairs.map((p) => p.label), ['Starter', 'Stage II', 'Stage III', 'Mega', 'Variant']);
  assert.deepEqual(plan.pairs.map((p) => p.a), ['twink', 'twank', 'twunk', 'mega-twunk', 'elder-twink']);
  assert.deepEqual(plan.pairs.map((p) => p.b), ['cub', 'cob', 'bear', 'mega-bear', 'polar-bear']);
  assert.deepEqual(plan.pairs.map((p) => p.kind), ['main', 'main', 'main', 'main', 'variant']);

  const report = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('circuit series timed out')), 30000);
    circuitMode.start('Twink', 'Cub');
    const poll = setInterval(() => {
      if (circuitMode.state.completed) { clearInterval(poll); clearTimeout(timer); resolve(circuitMode.state.report); }
      else if (!circuitMode.state.running) { clearInterval(poll); clearTimeout(timer); reject(new Error('series stopped without completing')); }
    }, 50);
  });

  assert.ok(report, 'no report produced');
  assert.equal(report.lineA, 'Twink');
  assert.equal(report.lineB, 'Cub');
  assert.equal(report.bouts.length, 5);
  assert.equal(report.score.a + report.score.b, 5, 'series tally must account for every bout');
  assert.ok(report.rounds >= 5, `rounds implausible: ${report.rounds}`);

  // The five seated pairs are exactly the canonical ladder + variant.
  assert.deepEqual(App.__seats.slice(-5).map((s) => s.join('|')), [
    'twink|cub', 'twank|cob', 'twunk|bear', 'mega-twunk|mega-bear', 'elder-twink|polar-bear',
  ]);

  for (const b of report.bouts) {
    assert.ok(['a', 'b', 'draw'].includes(b.winner), `bout ${b.label} winner`);
    assert.ok(b.rounds >= 1 && b.rounds <= 40, `bout ${b.label} rounds ${b.rounds}`);
    assert.equal(typeof b.seed, 'number', 'seed must be the engine seed, for reproducibility');
    assert.ok(App.entry(b.a) && App.entry(b.b));
  }

  for (const side of ['a', 'b']) {
    const t = report.totals[side];
    for (const k of ['damage', 'biggest', 'counters', 'readLocks', 'flowBreaks', 'guards', 'signatures', 'crits', 'shielded']) {
      assert.equal(typeof t[k], 'number', `totals.${side}.${k} not measured`);
      assert.ok(t[k] >= 0);
    }
    assert.ok(t.biggest <= t.damage || t.damage === 0, 'biggest hit cannot exceed total damage');
  }
  assert.ok(report.initiative.a + report.initiative.b > 0, 'initiative never observed');
  assert.ok(report.vectorTendencies.a.length > 0, 'attack-vector tendency not measured');
  assert.ok(report.biggestHit && report.biggestHit.value > 0 && ['a', 'b'].includes(report.biggestHit.side));
  assert.ok(report.closestBout && report.closestBout.gap >= 0);

  // No analytic key may exist that the engine never produced.
  assert.deepEqual(Object.keys(report).sort(), [
    'biggestHit', 'bouts', 'closestBout', 'initiative', 'lineA', 'lineB', 'rounds', 'score', 'totals', 'vectorTendencies',
  ]);
  assert.deepEqual(Object.keys(report.totals.a).sort(), [
    'biggest', 'counters', 'crits', 'damage', 'flowBreaks', 'guards', 'readLocks', 'shielded', 'signatures',
  ]);
  circuitMode.dispose();
  assert.equal(circuitMode.state.running, false);
});

test('disposal: tearing the stack down releases every GPU resource', () => {
  const { assets, world, specimens, compare, lab, battle } = S();
  // No canvas exists in Node, so label/texture caches stay cold here; assert on
  // what the scene graph really owns instead.
  let geos = 0, mats = 0;
  const seenMat = new Set();
  world.root.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      if (o.geometry) geos++;
      const m = o.material;
      for (const one of (Array.isArray(m) ? m : [m])) if (one && !seenMat.has(one.uuid)) { seenMat.add(one.uuid); mats++; }
    }
  });
  assert.ok(geos > 50, `world should own plenty of geometry, got ${geos}`);
  assert.ok(mats > 20, `world should own materials, got ${mats}`);
  assert.ok(world.updaters > 0, 'world should register updaters');
  const before = assets.report();
  assert.deepEqual(Object.keys(before).sort(), ['created', 'decodeFailures', 'evicted', 'gpuGeometries', 'gpuTextures', 'labels', 'programs', 'textures']);

  compare.dispose();
  lab.dispose();
  battle.dispose();
  specimens.dispose();
  world.dispose();
  assets.dispose();

  const after = assets.report();
  assert.equal(after.textures, 0, `textures leaked: ${after.textures}`);
  assert.equal(after.labels, 0, `labels leaked: ${after.labels}`);
  assert.equal(assets.materialCount, 0, `materials leaked: ${assets.materialCount}`);
  assert.equal(world.root.children.length, 0, 'world root still has children after dispose');
  assert.equal(specimens.all().length, 0);
  assert.equal(specimens.hitTargets.length, 0);
  // Disposal must be idempotent — enter/exit cycles happen repeatedly.
  assert.doesNotThrow(() => { assets.dispose(); world.dispose(); specimens.dispose(); compare.dispose(); lab.dispose(); battle.dispose(); });
});
