/* ---------------------------------------------------------------------------
 * GayDex: Circuit — state adapter.
 *
 * The single seam between the canonical application (data + battle truth +
 * persistence, all owned by `src/app.js` and `src/battle-core.js`) and the
 * Three.js presentation layer.
 *
 * Direction of authority is one-way:
 *   canonical data / battle engine  -->  adapter  -->  Circuit rendering
 * The adapter can *request* intents (select, scan, compare, challenge) but it
 * never writes battle numbers and never recomputes an outcome.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const PREF_KEY = 'gaydex-circuit-v1';

  function readPrefs(storageGet) {
    try { return JSON.parse(storageGet(PREF_KEY, '{}')) || {}; } catch { return {}; }
  }

  function createAdapter(App) {
    if (!App) throw new Error('Circuit state adapter requires window.GayDexApp');

    const prefs = readPrefs(App.storageGet);
    const listeners = { battle: [], discovery: [], selection: [], battleLifecycle: [] };

    function savePrefs() {
      App.storageSet(PREF_KEY, JSON.stringify(prefs));
    }

    /* ---- canonical data (read view) ----------------------------------- */
    const dex = App.dex.slice();
    const byId = Object.fromEntries(dex.map((e) => [e.id, e]));
    function entry(id) { return byId[id] || null; }
    function entries() { return dex; }
    function lineOf(e) { return e ? e.line : 'Independent'; }
    function colorOf(e) { return C.LINE_COLOR[lineOf(e)] || 0x42e7ff; }

    /* ---- discovery / selection ---------------------------------------- */
    function isDiscovered(id) { return App.state.seen.has(id); }
    function discoveredCount() { return App.state.seen.size; }
    function selectedId() { return App.state.selected; }
    function compareIds() { return App.compareIds(); }
    function isFavorite(id) { return App.state.favs.has(id); }

    /**
     * SCAN. Marks the form discovered through the app (which owns persistence)
     * and returns the canonical entry.
     */
    function scan(id) {
      const e = entry(id);
      if (!e) return null;
      const fresh = App.markSeen(id);
      if (fresh) listeners.discovery.forEach((f) => f(e));
      return e;
    }

    function select(id) {
      if (!entry(id)) return false;
      App.selectEntry(id, false);
      listeners.selection.forEach((f) => f(entry(id)));
      return true;
    }

    function toggleCompare(id) {
      if (!entry(id)) return false;
      App.toggleCompare(id);
      return true;
    }

    function clearCompare() {
      App.compareIds().forEach((id) => App.toggleCompare(id));
    }

    /* ---- battle read model --------------------------------------------
     * A snapshot, not a simulation. Every number here is read straight off the
     * live match produced by `src/battle-core.js`. */
    function battleSnapshot() {
      const bs = App.battleState;
      const m = bs.match;
      if (!m) return null;
      const side = (f) => ({
        id: f.entry.id,
        name: f.entry.name,
        line: f.entry.line,
        stage: f.entry.stage,
        hp: f.hp,
        maxHp: f.maxHp,
        hpRatio: f.maxHp ? f.hp / f.maxHp : 0,
        shield: f.shield,
        hype: f.hype,
        combo: f.combo,
        guardChain: f.guardChain,
        guardFatigue: Math.max(0, (f.guardChain || 0) - 1),
        sigCd: f.sigCd,
        signatureReady: f.sigCd === 0 && f.hype >= 100,
        lastMove: f.lastMove,
        history: f.history.slice(),
        color: colorOf(f.entry),
        stats: f.stats,
        metrics: f.metrics,
      });
      return {
        round: m.round,
        ended: m.ended,
        winner: m.winner,
        format: m.format || 'classic',
        score: m.score ? { ...m.score } : null,
        matchPoint: !!m.score && (m.score.a >= 2 || m.score.b >= 2),
        finishReason: m.finishReason || null,
        seed: m.seed,
        scene: m.scene,
        arenaEffects: m.arenaEffects,
        opener: m.opener,
        lastFirst: m.lastFirst || null,
        lastInitiative: m.lastInitiative ? m.lastInitiative.slice() : null,
        timeline: m.timeline.slice(),
        a: side(m.a),
        b: side(m.b),
        cpuB: !!bs.cpuB,
        cpuSkill: bs.cpuSkill,
        moveA: bs.moveA,
        moveB: bs.moveB,
      };
    }

    /* ---- intents ------------------------------------------------------ */
    /**
     * Seat an exact pair. Circuit never constructs a match itself — it hands
     * the two canonical ids to the app, which owns the engine call and the
     * resulting match object.
     */
    function setFighters(idA, idB) {
      if (!entry(idA) || !entry(idB)) return false;
      return !!App.setFighters(idA, idB);
    }

    function challenge(idA, idB) {
      const a = entry(idA) || entry(selectedId());
      const b = entry(idB) || pickRival(a);
      if (!a || !b) return false;
      return App.setFighters(a.id, b.id);
    }

    /** Deterministic-ish rival pick that avoids mirroring the same lineage. */
    function pickRival(a) {
      const pool = dex.filter((e) => e.id !== a.id && e.line !== a.line && e.stage !== 'Mega');
      const list = pool.length ? pool : dex.filter((e) => e.id !== a.id);
      return list[Math.floor(Math.random() * list.length)] || null;
    }

    function randomRival() { App.randomBattleRival(); }
    function setCpu(on, skill) { return App.setCpu(on, skill); }
    function setBattleScene(scene) { return App.setBattleScene(scene); }
    function resetBattle(o) { App.resetBattle(o || {}); }
    function resolveRound() { return App.resolveBattleRound(); }
    function autoBattle() { return App.autoBattle(); }
    function runSeries() { return App.runLineageSeries(); }

    /* ---- Evolution Lab (conventional engine stays authoritative) ------ */
    function labCandidates(vals) { return App.labCandidates(vals || App.labVals()); }
    function labVals() { return App.labVals(); }
    function setLabVals(v) { App.setLabVals(v); }
    function runLab() { return App.runLab(); }

    /* ---- preferences owned by Circuit --------------------------------- */
    const prefApi = {
      get quality() { return C.QUALITY[prefs.quality] ? prefs.quality : 'auto'; },
      set quality(v) { if (C.QUALITY[v]) { prefs.quality = v; savePrefs(); } },
      get motion() { return prefs.motion === 'reduced' ? 'reduced' : 'auto'; },
      set motion(v) { prefs.motion = v === 'reduced' ? 'reduced' : 'auto'; savePrefs(); },
      get entered() { return prefs.entered === true; },
      set entered(v) { prefs.entered = !!v; savePrefs(); },
      get lastDistrict() { return C.DISTRICTS[prefs.lastDistrict] ? prefs.lastDistrict : 'prism'; },
      set lastDistrict(v) { if (C.DISTRICTS[v]) { prefs.lastDistrict = v; savePrefs(); } },
      get camera() { return prefs.camera || null; },
      set camera(v) { prefs.camera = v; savePrefs(); },
      get sfx() { return prefs.sfx !== false; },
      set sfx(v) { prefs.sfx = !!v; savePrefs(); },
      raw: prefs,
    };

    /* ---- event fan-out ------------------------------------------------ */
    const offBattle = App.onBattleEvent((event, match) => {
      listeners.battle.forEach((f) => f(event, match));
    });

    function on(kind, fn) {
      if (!listeners[kind] || typeof fn !== 'function') return () => {};
      listeners[kind].push(fn);
      return () => { const i = listeners[kind].indexOf(fn); if (i >= 0) listeners[kind].splice(i, 1); };
    }

    function emitLifecycle(phase, detail) {
      listeners.battleLifecycle.forEach((f) => f(phase, detail));
    }

    return {
      App, dex, entries, entry, lineOf, colorOf,
      isDiscovered, discoveredCount, selectedId, compareIds, isFavorite,
      scan, select, toggleCompare, clearCompare,
      battleSnapshot, challenge, setFighters, pickRival, randomRival, setCpu, setBattleScene,
      resetBattle, resolveRound, autoBattle, runSeries,
      labCandidates, labVals, setLabVals, runLab,
      prefs: prefApi, on, emitLifecycle,
      offBattle,
      /**
       * Read-only handle on the canonical engine. Circuit uses it for
       * *labels and lookups only* (move names, signature copy, lineage tables
       * when planning a route). It never calls a resolver through here.
       */
      BattleCore: App.BattleCore || null,
    };
  }

  C.createAdapter = createAdapter;
  C.PREF_KEY = PREF_KEY;
})(window.GayDexCircuit);
