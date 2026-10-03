/* ---------------------------------------------------------------------------
 * GayDex: Circuit — Circuit mode (lineage series progression + reports).
 *
 * Lane: threejs-project-engineer.
 *
 * Circuit mode turns the existing lineage series into spatial progression:
 * Starter -> Stage II -> Stage III -> Mega -> Variant, walking the physical
 * lineage route between bouts.  Independent forms keep their existing
 * exception — they have no four-stage ladder, so they are not forced into one.
 *
 * Every number in the final report is MEASURED from the engine: the metrics the
 * engine already records, plus per-round initiative and per-move tallies
 * observed off the events the engine emits.  Nothing is estimated or invented.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  function createCircuitMode(opts = {}) {
    const { adapter, world, runtime, onStatus, onReport, onBoutStart, onBoutEnd } = opts;
    const Core = adapter.BattleCore;

    const state = {
      running: false,
      lineA: null,
      lineB: null,
      bouts: [],
      index: 0,
      completed: false,
      report: null,
    };

    let offBattle = null;
    let roundSeen = new Set();
    let tally = null;

    function emptyTally() {
      return {
        rounds: 0,
        first: { a: 0, b: 0 },
        moves: { a: { flex: 0, serve: 0, read: 0, guard: 0, signature: 0 }, b: { flex: 0, serve: 0, read: 0, guard: 0, signature: 0 } },
      };
    }

    /** Observe engine events. Read-only: nothing here influences the fight. */
    function observe(ev, match) {
      if (!state.running || !match || !tally) return;
      if (!roundSeen.has(match.round)) {
        roundSeen.add(match.round);
        tally.rounds++;
        if (match.lastFirst === 'a') tally.first.a++;
        else if (match.lastFirst === 'b') tally.first.b++;
      }
      if (ev && (ev.kind === 'damage' || ev.kind === 'guard') && ev.side && ev.move && tally.moves[ev.side]) {
        if (tally.moves[ev.side][ev.move] != null) tally.moves[ev.side][ev.move]++;
      }
    }

    function seriesFor(lineA, lineB) {
      if (lineA === 'Independent' || lineB === 'Independent') {
        return { ok: false, reason: 'Independent forms duel individually — they have no four-stage ladder to walk.' };
      }
      const A = Core.BATTLE_LINES[lineA];
      const B = Core.BATTLE_LINES[lineB];
      if (!A || !B) return { ok: false, reason: 'Unknown lineage.' };
      const labels = ['Starter', 'Stage II', 'Stage III', 'Mega'];
      const pairs = A.main.map((id, i) => ({ label: labels[i], a: id, b: B.main[i], kind: 'main' }));
      if (A.variant && B.variant) pairs.push({ label: 'Variant', a: A.variant, b: B.variant, kind: 'variant' });
      return { ok: true, pairs };
    }

    function start(lineA, lineB) {
      const plan = seriesFor(lineA, lineB);
      if (!plan.ok) {
        if (onStatus) onStatus('CIRCUIT UNAVAILABLE', plan.reason);
        return null;
      }
      state.running = true;
      state.completed = false;
      state.report = null;
      state.lineA = lineA;
      state.lineB = lineB;
      state.bouts = plan.pairs.map((p, i) => ({ ...p, index: i, result: null, metrics: null, tally: null }));
      state.index = 0;
      if (onStatus) onStatus('CIRCUIT ENGAGED', `${lineA} vs ${lineB} // ${state.bouts.length} bouts along the lineage route`);
      runBout(0);
      return state.bouts;
    }

    function runBout(i) {
      const bout = state.bouts[i];
      if (!bout) return finish();
      state.index = i;
      roundSeen = new Set();
      tally = emptyTally();

      // Move the player along the physical route before the fight.
      const route = world.routes[state.lineA];
      if (route && route.nodes[i]) {
        const n = route.nodes[i];
        const wp = n.world;
        if (opts.flyTo) opts.flyTo(wp[0], wp[1] + 9, n.entry.name);
      }

      adapter.setFighters(bout.a, bout.b);
      if (onBoutStart) onBoutStart(bout, i, state.bouts.length);
      if (onStatus) onStatus(`BOUT ${i + 1} / ${state.bouts.length}`, `${bout.label} // ${adapter.entry(bout.a).name} vs ${adapter.entry(bout.b).name}`);

      if (!offBattle) offBattle = adapter.on('battle', observe);
      watchForEnd(bout, i);
    }

    function watchForEnd(bout, i) {
      let guard = 0;
      const tick = () => {
        if (!state.running) return;
        const snap = adapter.battleSnapshot();
        if (snap && snap.ended) {
          recordResult(bout, snap, i);
          if (onBoutEnd) onBoutEnd(bout, i);
          if (i + 1 < state.bouts.length) {
            setTimeout(() => { if (state.running) runBout(i + 1); }, 900);
          } else {
            setTimeout(() => finish(), 700);
          }
          return;
        }
        if (++guard > 3600) { // ~60s safety valve; never a silent hang
          if (onStatus) onStatus('CIRCUIT HALTED', 'bout did not resolve');
          state.running = false;
          return;
        }
        setTimeout(tick, 250);
      };
      setTimeout(tick, 350);
    }

    function recordResult(bout, snap, i) {
      const m = adapter.App.battleState.match;
      const metrics = {
        a: m && m.a.metrics ? { ...m.a.metrics } : null,
        b: m && m.b.metrics ? { ...m.b.metrics } : null,
      };
      bout.result = {
        winner: snap.winner,
        rounds: snap.round,
        hpA: Math.ceil(snap.a.hp),
        hpB: Math.ceil(snap.b.hp),
        hpRatioA: snap.a.hpRatio,
        hpRatioB: snap.b.hpRatio,
        seed: snap.seed,
      };
      bout.metrics = metrics;
      bout.tally = { rounds: tally.rounds, first: { ...tally.first }, moves: { a: { ...tally.moves.a }, b: { ...tally.moves.b } } };
    }

    function finish() {
      state.running = false;
      state.completed = true;
      if (offBattle) { offBattle(); offBattle = null; }
      state.report = buildReport();
      if (onReport) onReport(state.report);
      return state.report;
    }

    /** Aggregate ONLY measured values. */
    function buildReport() {
      const bouts = state.bouts.filter((b) => b.result);
      let scoreA = 0, scoreB = 0;
      const totals = {
        a: { damage: 0, biggest: 0, counters: 0, readLocks: 0, flowBreaks: 0, guards: 0, signatures: 0, crits: 0, shielded: 0 },
        b: { damage: 0, biggest: 0, counters: 0, readLocks: 0, flowBreaks: 0, guards: 0, signatures: 0, crits: 0, shielded: 0 },
      };
      const first = { a: 0, b: 0 };
      const moves = {
        a: { flex: 0, serve: 0, read: 0, guard: 0, signature: 0 },
        b: { flex: 0, serve: 0, read: 0, guard: 0, signature: 0 },
      };
      let closest = null;
      let biggestHit = { side: null, value: 0, bout: null };
      let rounds = 0;

      for (const b of bouts) {
        if (b.result.winner === 'a') scoreA++;
        else if (b.result.winner === 'b') scoreB++;
        else { scoreA += 0.5; scoreB += 0.5; }
        rounds += b.result.rounds;

        for (const side of ['a', 'b']) {
          const m = b.metrics && b.metrics[side];
          if (m) {
            totals[side].damage += m.damage || 0;
            totals[side].biggest = Math.max(totals[side].biggest, m.biggest || 0);
            totals[side].counters += m.counters || 0;
            totals[side].readLocks += m.readLocks || 0;
            totals[side].flowBreaks += m.flowBreaks || 0;
            totals[side].guards += m.guards || 0;
            totals[side].signatures += m.signatures || 0;
            totals[side].crits += m.crits || 0;
            totals[side].shielded += m.shielded || 0;
            if ((m.biggest || 0) > biggestHit.value) {
              biggestHit = { side, value: m.biggest, bout: b.label };
            }
          }
          if (b.tally) {
            first[side] += b.tally.first[side] || 0;
            for (const k of Object.keys(moves[side])) moves[side][k] += b.tally.moves[side][k] || 0;
          }
        }

        const gap = Math.abs(b.result.hpRatioA - b.result.hpRatioB);
        if (!closest || gap < closest.gap) {
          closest = { gap, label: b.label, a: b.a, b: b.b, hpA: b.result.hpA, hpB: b.result.hpB };
        }
      }

      const dominant = (obj) => {
        const entries = Object.entries(obj).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
        const total = entries.reduce((s, e) => s + e[1], 0);
        return entries.slice(0, 3).map(([k, v]) => ({ move: k, count: v, share: total ? +(v / total).toFixed(2) : 0 }));
      };

      const firstTotal = first.a + first.b;
      return {
        lineA: state.lineA,
        lineB: state.lineB,
        bouts: state.bouts.map((b) => ({
          label: b.label,
          a: b.a, b: b.b,
          aName: adapter.entry(b.a)?.name, bName: adapter.entry(b.b)?.name,
          winner: b.result ? b.result.winner : null,
          winnerName: b.result && b.result.winner !== 'draw' ? adapter.entry(b.result.winner === 'a' ? b.a : b.b)?.name : null,
          rounds: b.result ? b.result.rounds : null,
          hpA: b.result ? b.result.hpA : null,
          hpB: b.result ? b.result.hpB : null,
          seed: b.result ? b.result.seed : null,
        })),
        score: { a: scoreA, b: scoreB },
        rounds,
        totals,
        initiative: {
          a: first.a, b: first.b,
          aShare: firstTotal ? +(first.a / firstTotal).toFixed(2) : 0,
          bShare: firstTotal ? +(first.b / firstTotal).toFixed(2) : 0,
        },
        biggestHit,
        closestBout: closest,
        vectorTendencies: { a: dominant(moves.a), b: dominant(moves.b), raw: moves },
      };
    }

    function cancel() {
      state.running = false;
      if (offBattle) { offBattle(); offBattle = null; }
      if (onStatus) onStatus('CIRCUIT ABORTED', 'progression stopped');
    }

    function dispose() { cancel(); }

    return { state, start, cancel, finish, buildReport, seriesFor, dispose, get report() { return state.report; } };
  }

  C.createCircuitMode = createCircuitMode;
})(window.GayDexCircuit);
