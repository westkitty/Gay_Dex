/* ---------------------------------------------------------------------------
 * GayDex: Circuit — boot, wiring, camera choreography, fallback.
 *
 * Lane: threejs-project-engineer + threejs-performance-lifecycle-auditor.
 *
 * Owns: startup, feature detection, the explore/inspect/battle camera
 * director, DOM wiring, telemetry presentation, and the static fallback path
 * used when Three.js or WebGL2 is unavailable.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp } = C.util;
  const $ = (s) => document.querySelector(s);

  /**
   * Explain, visibly, why the 3D world is unavailable.
   *
   * The notice lives outside #circuitRoot (which is [hidden] in this state) —
   * nesting it inside the world root, as it once was, meant nobody without
   * WebGL2 ever read it. It is dismissible and never blocks the static
   * terminal, which is fully functional.
   */
  function showFallback(reason) {
    const fb = document.querySelector('#circuitFallback');
    if (!fb) return;
    fb.dataset.reason = String(reason || 'unavailable');
    fb.innerHTML = '<strong>Circuit offline — this browser has no WebGL2.</strong>'
      + `<br>Reported: ${reason ? String(reason) : 'unsupported'}.`
      + '<br>The 3D world is the only thing missing. The atlas, Lineage Atlas, Compare Deck, Evolution Lab and Battle Terminal below all work exactly as normal.'
      + '<div class="circuit-fallback-actions"><button type="button" class="circuit-btn primary" id="circuitFallbackClose">Continue without 3D</button></div>';
    fb.hidden = false;
    const close = fb.querySelector('#circuitFallbackClose');
    if (close) close.addEventListener('click', () => { fb.hidden = true; });
  }

  function detectSupport() {
    if (!C.hasThree()) return { ok: false, reason: 'three.js did not load' };
    if (typeof document === 'undefined') return { ok: false, reason: 'no document' };
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return { ok: false, reason: 'WebGL2 unavailable' };
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { ok: true, revision: window.THREE.REVISION };
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
  }

  /**
   * Boot the Circuit.
   *
   * @param {object} [opts] Test seams. Production always calls `boot()` with no
   *   arguments, which detects real WebGL2 support and builds every subsystem
   *   from the real factories. The seams exist so the boot wiring itself — the
   *   camera director, inspector, navigator, battle dock, toasts and teardown —
   *   can be executed headlessly against a stubbed renderer, because a GPU is
   *   the one thing a test runner cannot provide.
   *   @param {object} [opts.support]   Skip WebGL2 probing (result of detectSupport()).
   *   @param {object} [opts.factories] Override individual `C.createX` factories.
   */
  function boot(opts = {}) {
    const App = window.GayDexApp;
    const F = {
      createRuntime: C.createRuntime,
      createWorld: C.createWorld,
      createSpecimenField: C.createSpecimenField,
      createCompareRing: C.createCompareRing,
      createSpatialLab: C.createSpatialLab,
      createBattleLayer: C.createBattleLayer,
      createInput: C.createInput,
      ...(opts.factories || {}),
    };
    const support = opts.support || detectSupport();
    const root = $('#circuitRoot');
    const enterBtn = $('#circuitEnterBtn');
    const pill = $('#enginePill');

    if (!support.ok) {
      if (pill) pill.innerHTML = '3D <strong>static fallback</strong>';
      // Stay clickable: a disabled control hides the only explanation a user
      // would get. Clicking now re-opens the notice.
      if (enterBtn) {
        enterBtn.disabled = false;
        enterBtn.innerHTML = '⬢ <strong>Why is 3D off?</strong>';
        enterBtn.addEventListener('click', () => showFallback(support.reason));
      }
      const st = $('#engineStatus');
      if (st) st.textContent = 'HOLO ENGINE: STATIC FALLBACK';
      showFallback(support.reason);
      return null;
    }

    const THREE = window.THREE;
    if (pill) pill.innerHTML = `3D <strong>three r${support.revision}</strong>`;

    const adapter = C.createAdapter(App);
    const canvas = $('#circuitCanvas');

    const runtime = F.createRuntime(THREE, canvas, {
      quality: adapter.prefs.quality,
      onContextLost: () => toast('WebGL context lost — suspending the Circuit.', 'warn'),
      onContextRestored: () => toast('WebGL context restored — resuming.', 'ok'),
    });

    const assets = C.createAssets(THREE, { textureBudget: 26, labelBudget: 44 });
    assets.setAnisotropy(Math.min(4, runtime.maxAnisotropy));
    runtime.setReducedMotion(reducedWanted());

    const world = F.createWorld(THREE, { assets });

    // Evolution geography. The pad positions are authored in C.ROUTES; the
    // forms standing on them come from the canonical lineage tables, so the
    // world can never disagree with the dex about who evolves into whom.
    const LINES = adapter.BattleCore ? adapter.BattleCore.BATTLE_LINES : {};
    for (const line of Object.keys(C.ROUTES)) {
      world.buildRoute(line, (id) => adapter.entry(id), LINES[line]);
    }

    // Specimens placed on their lineage routes.
    const specimens = F.createSpecimenField(THREE, { assets, world });
    for (const [line, route] of Object.entries(world.routes)) {
      for (const n of route.nodes) specimens.add(n.entry, n.world, { district: route.district, line });
    }
    // Any canonical entry not on a route still gets a home (defensive).
    for (const e of adapter.entries()) {
      if (specimens.get(e.id)) continue;
      const d = C.DISTRICTS.prism;
      specimens.add(e, [d.center[0] + (Math.random() - 0.5) * 20, d.center[1] + 20], { district: 'prism', line: e.line });
    }
    for (const e of adapter.entries()) specimens.setDiscovered(e.id, adapter.isDiscovered(e.id));

    const compare = F.createCompareRing(THREE, { world, assets, entryOf: (id) => adapter.entry(id) });
    const lab = F.createSpatialLab(THREE, { world, assets, adapter });
    const battle = F.createBattleLayer(THREE, { runtime, world, assets });

    /* ---- camera director ---------------------------------------------- */
    const director = {
      mode: 'explore',
      fly: null,
      saved: null,
      shake: 0,
      battleAngle: 0,
    };

    function flyTo(x, z, label, opts2 = {}) {
      const yaw = opts2.yaw != null ? opts2.yaw : Math.atan2(-x, -z);
      director.fly = {
        from: { x: runtime.camera.position.x, z: runtime.camera.position.z, yaw: input.rig.yaw },
        to: { x, z, yaw },
        t: 0,
        dur: opts2.dur || (reducedWanted() ? 0.01 : 1.15),
        arc: reducedWanted() ? 0 : (opts2.arc == null ? 4 : opts2.arc),
        label: label || null,
        then: opts2.then || null,
      };
      director.mode = 'fly';
      input.setEnabled(false);
    }

    function updateDirector(dt, t, anim) {
      if (director.shake > 0) {
        director.shake = Math.max(0, director.shake - dt * 2.6);
        const s = director.shake * 0.16 * (reducedWanted() ? 0.2 : 1);
        runtime.camera.position.x += (Math.random() - 0.5) * s;
        runtime.camera.position.y += (Math.random() - 0.5) * s * 0.6;
      }
      if (director.mode === 'fly' && director.fly) {
        const f = director.fly;
        f.t = Math.min(1, f.t + dt / Math.max(0.01, f.dur));
        const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
        input.teleport(
          f.from.x + (f.to.x - f.from.x) * k,
          f.from.z + (f.to.z - f.from.z) * k,
          f.from.yaw + shortAngle(f.from.yaw, f.to.yaw) * k,
        );
        runtime.camera.position.y = C.RIG.eyeHeight + Math.sin(Math.PI * k) * f.arc;
        if (f.t >= 1) {
          const then = f.then;
          director.fly = null;
          director.mode = 'explore';
          input.setEnabled(true);
          if (then) then();
        }
        return;
      }
      if (director.mode === 'battle') {
        director.battleAngle += dt * (reducedWanted() ? 0.02 : 0.09);
        const d = C.DISTRICTS[C.SCENE_TO_DISTRICT[battle.sceneId] || 'prism'];
        const r = 17.5;
        const snap = adapter.battleSnapshot();
        const hype = snap ? Math.max(snap.a.hype, snap.b.hype) / 100 : 0;
        const wobble = Math.sin(director.battleAngle) * (1.6 + hype * 1.1);
        runtime.camera.position.set(d.center[0] + wobble, 6.4 + Math.sin(director.battleAngle * 0.7) * 0.5, d.center[1] + r);
        runtime.camera.lookAt(d.center[0], 3.2, d.center[1]);
      }
    }

    function shortAngle(a, b) {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    /* ---- input --------------------------------------------------------- */
    const input = F.createInput(THREE, {
      runtime, canvas,
      getTargets: undefined,
      onTarget: (kind, id) => renderPrompt(kind, id),
      onInteract: (kind, id) => handleInteract(kind, id),
      onEscape: () => handleEscape(),
      onWarp: (district) => warpTo(district),
      onStick: (phase, x, y) => {
        const knob = $('#circuitStickKnob');
        if (!knob) return;
        if (phase === 'end') knob.style.transform = 'translate(0,0)';
        else knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
      },
    });
    input.setTargets(() => collectTargets());

    function collectTargets() {
      const out = specimens.hitTargets.slice();
      const nexus = world.root.getObjectByName('district-nexus');
      world.root.traverse((o) => { if (o.userData && (o.userData.kind === 'gateway' || o.userData.kind === 'lab-dial')) out.push(o); });
      return out;
    }

    /* ---- interaction --------------------------------------------------- */
    let inspecting = null;
    /** Element that opened the inspector, so focus can be handed back. */
    let inspectorReturnFocus = null;

    function handleInteract(kind, id) {
      if (kind === 'specimen') { openInspector(id); return; }
      if (kind === 'gateway') { warpTo(id); return; }
      if (kind === 'lab-dial') {
        const r = lab.cycleDial(id != null ? Number(id) : 0, 1);
        if (r) toast(`LAB // ${r.key.toUpperCase()} → ${r.value.toUpperCase()}`, 'ok');
        renderLabResults();
        return;
      }
    }

    function handleEscape() {
      if (inspecting) { closeInspector(); return; }
      if ($('#circuitNavigator') && !$('#circuitNavigator').hidden) { toggleNavigator(false); return; }
      if (battle.active) { exitBattle(); return; }
      if (root && !root.hidden && adapter.prefs.entered) { exitCircuit(); }
    }

    function openInspector(id) {
      const e = adapter.entry(id);
      if (!e) return;
      const fresh = adapter.scan(id);
      if (fresh) {
        specimens.setDiscovered(id, true);
        toast(`SCANNED // ${e.name} added to observed forms`, 'ok');
        refreshNavigator();
      }
      inspecting = id;
      specimens.setInspecting(id);
      adapter.select(id);
      const pos = specimens.positionOf(id);
      if (pos) flyTo(pos[0] + 6.5, pos[1] + 8.5, e.name, { yaw: Math.atan2(pos[0] - (pos[0] + 6.5), pos[1] - (pos[1] + 8.5)), dur: 0.8 });
      renderInspector(e);
      const panel = $('#circuitInspector');
      if (panel) {
        // Remember where focus came from so closing the dialog gives it back
        // instead of dumping the user at the top of the document.
        if (panel.hidden) inspectorReturnFocus = document.activeElement;
        panel.hidden = false;
        const c = $('#circuitInspectorClose');
        if (c) c.focus();
      }
    }

    function closeInspector() {
      if (inspecting) specimens.setInspecting(inspecting, false);
      inspecting = null;
      const panel = $('#circuitInspector');
      const wasOpen = panel && !panel.hidden;
      if (panel) panel.hidden = true;
      input.clearTarget();
      renderPrompt(null, null);
      if (wasOpen && inspectorReturnFocus && typeof inspectorReturnFocus.focus === 'function' && document.contains(inspectorReturnFocus)) {
        inspectorReturnFocus.focus();
      }
      inspectorReturnFocus = null;
    }

    function renderInspector(e) {
      if (!e) return;
      const img = $('#circuitInspectorImg');
      if (img) { img.src = e.img; img.alt = `Illustrated ${e.name}`; }
      const nameEl = $('#circuitInspectorName');
      if (nameEl) nameEl.textContent = e.name;
      const eb = $('#circuitInspectorEyebrow');
      if (eb) eb.textContent = `#${String(e.num).padStart(3, '0')} // ${e.line.toUpperCase()} // ${e.stage.toUpperCase()}`;
      const d = $('#circuitInspectorDesc');
      if (d) d.textContent = e.desc;
      const facts = $('#circuitInspectorFacts');
      if (facts) {
        facts.innerHTML = [
          ['Lineage', e.line], ['Form / stage', e.stage], ['Designation', e.designation],
          ['Rarity', e.rarity], ['Build', e.build], ['Body hair', e.hair], ['Life stage', e.age], ['Vibe', e.vibe],
        ].map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
      }
      const stats = $('#circuitInspectorStats');
      if (stats) {
        stats.innerHTML = App.statNames.map((n, i) => `<div class="circuit-stat"><span>${escapeHtml(n)}</span><span class="track"><i style="width:${e.stats[i]}%"></i></span><b>${e.stats[i]}</b></div>`).join('');
      }
      const tr = $('#circuitInspectorTraits');
      if (tr) tr.innerHTML = e.traits.map((x) => `<span class="circuit-trait">${escapeHtml(x)}</span>`).join('');
      const lin = $('#circuitInspectorLineage');
      if (lin) {
        lin.innerHTML = `<b>Evolution route</b><div class="circuit-route">${e.evo.map((id, i) => {
          const x = adapter.entry(id);
          return `<button type="button" class="circuit-route-node${id === e.id ? ' current' : ''}" data-route-id="${escapeHtml(id)}">${escapeHtml(x ? x.name : id)}${i < e.evo.length - 1 ? ' →' : ''}</button>`;
        }).join('')}</div><small>${escapeHtml(App.lineagePassive(e))} · ${escapeHtml(App.stagePassive(e)[0])}: ${escapeHtml(App.stagePassive(e)[1])}</small>`;
        lin.querySelectorAll('[data-route-id]').forEach((b) => b.addEventListener('click', () => {
          const tid = b.dataset.routeId;
          closeInspector();
          const p = specimens.positionOf(tid);
          if (p) flyTo(p[0] + 6.5, p[1] + 8.5, tid, { dur: 0.9, then: () => openInspector(tid) });
          else openInspector(tid);
        }));
      }
      const acts = $('#circuitInspectorActions');
      if (acts) {
        const pinned = adapter.compareIds().includes(e.id);
        acts.innerHTML = `
          <button type="button" class="circuit-btn" id="ciCompare">${pinned ? '⊖ Unpin from compare' : '⊕ Pin to compare'}</button>
          <button type="button" class="circuit-btn primary" id="ciChallenge">⚔ Challenge this form</button>
          <button type="button" class="circuit-btn" id="ciRoute">⌖ Go to lineage route</button>
          <button type="button" class="circuit-btn" id="ciAtlas">☰ Open in atlas</button>`;
        $('#ciCompare').addEventListener('click', () => { adapter.toggleCompare(e.id); refreshCompare(); renderInspector(e); });
        $('#ciChallenge').addEventListener('click', () => startBattle(e.id));
        $('#ciRoute').addEventListener('click', () => {
          const route = world.routes[e.line];
          closeInspector();
          if (route && route.nodes.length) flyTo(route.nodes[0].world[0] + 8, route.nodes[0].world[1] + 12, `${e.line} route`, { dur: 1.0 });
          else warpTo(districtForLine(e.line));
        });
        $('#ciAtlas').addEventListener('click', () => { exitCircuit(); adapter.select(e.id); const at = $('#atlas'); if (at) at.scrollIntoView({ block: 'start' }); });
      }
    }

    /* ---- prompt / HUD -------------------------------------------------- */
    function renderPrompt(kind, id) {
      const el = $('#circuitPrompt');
      if (!el) return;
      if (!kind || !id) { el.hidden = true; el.textContent = ''; return; }
      if (kind === 'specimen') {
        const e = adapter.entry(id);
        if (!e) { el.hidden = true; return; }
        const seen = adapter.isDiscovered(id);
        el.hidden = false;
        el.innerHTML = `<b>${escapeHtml(e.name.toUpperCase())}</b><small>${escapeHtml(e.line)} · ${escapeHtml(e.stage)}${seen ? ' · observed' : ' · unscanned'}</small><span class="circuit-key">E / CLICK — ${seen ? 'INSPECT' : 'SCAN'}</span>`;
        return;
      }
      if (kind === 'gateway') {
        const d = C.DISTRICTS[id];
        el.hidden = false;
        el.innerHTML = `<b>${escapeHtml(d ? d.name.toUpperCase() : 'GATEWAY')}</b><small>${escapeHtml(d ? d.blurb : '')}</small><span class="circuit-key">E / CLICK — TRAVEL</span>`;
        return;
      }
      if (kind === 'lab-dial') {
        el.hidden = false;
        el.innerHTML = `<b>EVOLUTION LAB // ${escapeHtml(String(id).toUpperCase())}</b><small>cycles the same input as the conventional lab form</small><span class="circuit-key">E / CLICK — ADJUST</span>`;
      }
    }

    let toastTimer = 0;
    function toast(msg, kind) {
      const el = $('#circuitToast');
      if (!el) return;
      el.textContent = msg;
      el.dataset.kind = kind || 'info';
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    /* ---- districts / travel -------------------------------------------- */
    function districtForLine(line) {
      const map = { Twink: 'prism', Otter: 'aqua', Cub: 'emerald', Independent: 'pride' };
      return map[line] || 'nexus';
    }

    function warpTo(id) {
      const d = C.DISTRICTS[id];
      if (!d) return;
      flyTo(d.center[0], d.center[1] + (id === 'nexus' ? 24 : 20), d.name, {
        dur: reducedWanted() ? 0.01 : 1.0,
        arc: id === 'nexus' ? 2.5 : 5.5,
        then: () => {
          adapter.prefs.lastDistrict = id;
          world.pulseRipple(d.center[0], d.center[1]);
          world.pulseFocus(1);
        },
      });
      setDistrictCard(id);
    }

    function setDistrictCard(id) {
      const d = C.DISTRICTS[id] || C.DISTRICTS.nexus;
      const n = $('#circuitDistrictName');
      const b = $('#circuitDistrictBlurb');
      if (n) n.textContent = d.name.toUpperCase();
      if (b) b.textContent = d.blurb;
      world.setActiveDistrict(id);
    }

    /* ---- world <-> battle ---------------------------------------------- */
    function startBattle(playerId) {
      const me = adapter.entry(playerId || adapter.selectedId());
      if (!me) return;
      const rival = adapter.pickRival(me);
      if (!rival) return;
      const sceneId = C.DISTRICT_TO_SCENE[districtForLine(me.line)] || 'prism';
      adapter.setBattleScene(sceneId);
      battle.setScene(sceneId);

      director.saved = {
        x: runtime.camera.position.x,
        z: runtime.camera.position.z,
        yaw: input.rig.yaw,
        district: world.activeDistrict,
        selected: adapter.selectedId(),
      };

      const d = C.DISTRICTS[C.SCENE_TO_DISTRICT[sceneId]];
      closeInspector();
      flyTo(d.center[0], d.center[1] + 17.5, 'arena', {
        dur: reducedWanted() ? 0.01 : 1.3,
        arc: 4.2,
        then: () => {
          adapter.setFighters(me.id, rival.id);
          battle.enter({ entryA: me, entryB: rival });
          director.mode = 'battle';
          input.setEnabled(false);
          renderBattleHud();
          const hud = $('#circuitBattleHud');
          if (hud) hud.hidden = false;
          adapter.emitLifecycle('enter', { a: me.id, b: rival.id });
        },
      });
    }

    function exitBattle() {
      battle.exit();
      director.mode = 'explore';
      const hud = $('#circuitBattleHud');
      if (hud) hud.hidden = true;
      const s = director.saved;
      if (s) {
        flyTo(s.x, s.z, 'return', { yaw: s.yaw, dur: reducedWanted() ? 0.01 : 0.9, arc: 3, then: () => { setDistrictCard(s.district); world.pulseFocus(0.7); } });
      } else {
        input.setEnabled(true);
      }
      adapter.emitLifecycle('exit', {});
    }

    function renderBattleHud() {
      const snap = adapter.battleSnapshot();
      const wrap = $('#circuitBattleHud');
      if (!wrap || !snap) return;
      const card = (s, side) => {
        const ready = s.signatureReady;
        return `<div class="circuit-fighter-card ${side}" style="--fc:#${s.color.toString(16).padStart(6, '0')}">
          <b>${escapeHtml(s.name)}</b>
          <small>${escapeHtml(s.line)} // ${escapeHtml(s.stage)}</small>
          <div class="circuit-bar hp"><i style="width:${Math.round(s.hpRatio * 100)}%"></i></div>
          <div class="circuit-bar hype ${ready ? 'ready' : ''}"><i style="width:${Math.round(s.hype)}%"></i></div>
          <div class="circuit-fighter-meta">HP ${Math.ceil(s.hp)}/${s.maxHp}${s.shield ? ` +${Math.round(s.shield)}` : ''} · FLOW x${s.combo}${s.guardFatigue ? ` · FATIGUE ${s.guardFatigue}` : ''}${ready ? ' · <b>SIGNATURE READY</b>' : ''}</div>
        </div>`;
      };
      $('#circuitFighterA').innerHTML = card(snap.a, 'a');
      $('#circuitFighterB').innerHTML = card(snap.b, 'b');
      const center = $('#circuitBattleCenter');
      if (center) {
        center.innerHTML = snap.ended
          ? `<b>${snap.winner === 'draw' ? 'DRAW' : escapeHtml(adapter.entry(snap.winner === 'a' ? snap.a.id : snap.b.id)?.name || '')} WINS</b><small>${snap.round} rounds · seed ${snap.seed}</small>`
          : `<b>ROUND ${snap.round}</b><small>seed ${snap.seed}${snap.cpuB ? ` · CPU ${escapeHtml(snap.cpuSkill)}` : ''}</small>`;
      }
      const moves = $('#circuitBattleMoves');
      if (moves) {
        const KEYS = { flex: '1', serve: '2', read: '3', guard: '4', signature: '5' };
        moves.innerHTML = ['flex', 'serve', 'read', 'guard', 'signature'].map((id) => {
          const m = adapter.BattleCore.BATTLE_MOVES[id];
          const sig = id === 'signature' ? adapter.BattleCore.signatureSpec({ entry: adapter.entry(snap.a.id), stats: snap.a.stats }, () => 0.35) : null;
          const label = sig ? sig.name : m.name;
          const disabled = snap.ended || (id === 'signature' && !snap.a.signatureReady);
          return `<button type="button" class="circuit-move${id === 'signature' ? ' signature' : ''}${snap.moveA === id ? ' active' : ''}" data-move="${id}" ${disabled ? 'disabled' : ''}><strong>${escapeHtml(label)}<span>${KEYS[id]}</span></strong><small>${escapeHtml(m.hint)}</small></button>`;
        }).join('') + `<button type="button" class="circuit-move resolve" id="circuitResolve">RESOLVE ROUND</button>
          <button type="button" class="circuit-move ghost" id="circuitAuto">AUTO</button>
          <button type="button" class="circuit-move ghost" id="circuitLeave">LEAVE ARENA</button>`;
        moves.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
          adapter.App.battleState.moveA = b.dataset.move;
          adapter.App.selectEntry(adapter.App.battleState.idA, false);
          const btn = document.querySelector(`[data-battle-side="a"][data-battle-move="${b.dataset.move}"]`);
          if (btn) btn.click();
          renderBattleHud();
        }));
        const r = $('#circuitResolve');
        if (r) r.addEventListener('click', async () => { r.disabled = true; await adapter.resolveRound(); renderBattleHud(); });
        const a = $('#circuitAuto');
        if (a) a.addEventListener('click', async () => { a.disabled = true; await adapter.autoBattle(); renderBattleHud(); });
        const l = $('#circuitLeave');
        if (l) l.addEventListener('click', () => exitBattle());
      }
      const bar = $('#circuitBattleBar');
      if (bar) {
        bar.innerHTML = `<span class="circuit-chip">SEED ${snap.seed}</span><span class="circuit-chip">${escapeHtml((C.DISTRICTS[C.SCENE_TO_DISTRICT[snap.scene]] || {}).name || snap.scene)}</span>` +
          (snap.ended ? `<button type="button" class="circuit-chip" id="circuitReportBtn">MATCH REPORT</button>` : '') +
          `<button type="button" class="circuit-chip" id="circuitCircuitBtn">RUN CIRCUIT</button>`;
        const rb = $('#circuitReportBtn');
        if (rb) rb.addEventListener('click', () => { exitCircuit(); const el = $('#battleMatchReport'); if (el) el.scrollIntoView({ block: 'center' }); });
        const cb = $('#circuitCircuitBtn');
        if (cb) cb.addEventListener('click', () => {
          const snap2 = adapter.battleSnapshot();
          if (!snap2) return;
          circuitMode.start(adapter.entry(snap2.a.id).line, adapter.entry(snap2.b.id).line);
        });
      }
    }

    /* ---- compare + lab -------------------------------------------------- */
    function refreshCompare() {
      const ids = adapter.compareIds();
      if (!ids.length) { compare.hide(); return; }
      const d = C.DISTRICTS[world.activeDistrict] || C.DISTRICTS.nexus;
      const p = runtime.camera.position;
      compare.show(ids, [p.x + Math.sin(input.rig.yaw) * 9, p.z + Math.cos(input.rig.yaw) * 9]);
      void d;
    }

    function renderLabResults() {
      const res = lab.results;
      const panel = $('#circuitInspector');
      if (!res.length) return;
      toast(`LAB // nearest: ${res.map((r) => r.name).join(' · ')}`, 'ok');
      void panel;
    }

    /* ---- navigator ------------------------------------------------------ */
    function refreshNavigator() {
      const body = $('#circuitNavBody');
      if (!body) return;
      const groups = [
        ['Transit', [['nexus', 'Transit Nexus'], ['prism', 'Prism Dome'], ['aqua', 'Aqua Pulse Bay'], ['pride', 'Pride Circuit'], ['emerald', 'Emerald Relay']], 'district'],
      ];
      let html = '';
      for (const [title, items, kind] of groups) {
        html += `<div class="circuit-nav-group"><h3>${escapeHtml(title)}</h3><div class="circuit-nav-items">` +
          items.map(([id, name]) => `<button type="button" class="circuit-nav-item" data-nav-kind="${kind}" data-nav-id="${escapeHtml(id)}">${escapeHtml(name)}</button>`).join('') +
          `</div></div>`;
      }
      for (const line of ['Twink', 'Cub', 'Otter', 'Independent']) {
        const list = adapter.entries().filter((e) => e.line === line);
        html += `<div class="circuit-nav-group"><h3>${escapeHtml(line)} lineage</h3><div class="circuit-nav-items">` +
          list.map((e) => `<button type="button" class="circuit-nav-item${adapter.isDiscovered(e.id) ? ' seen' : ''}" data-nav-kind="specimen" data-nav-id="${escapeHtml(e.id)}">${escapeHtml(e.name)}<small>${escapeHtml(e.stage)}${adapter.isDiscovered(e.id) ? '' : ' · unscanned'}</small></button>`).join('') +
          `</div></div>`;
      }
      html += `<div class="circuit-nav-group"><h3>Systems</h3><div class="circuit-nav-items">
        <button type="button" class="circuit-nav-item" data-nav-kind="action" data-nav-id="compare">⊕ Compare ring (${adapter.compareIds().length}/3)</button>
        <button type="button" class="circuit-nav-item" data-nav-kind="action" data-nav-id="lab">⚗ Evolution Lab</button>
        <button type="button" class="circuit-nav-item" data-nav-kind="action" data-nav-id="battle">⚔ Quick challenge</button>
        <button type="button" class="circuit-nav-item" data-nav-kind="action" data-nav-id="circuit">⌁ Run Circuit mode</button>
        <button type="button" class="circuit-nav-item" data-nav-kind="action" data-nav-id="exit">↩ Exit to atlas</button>
      </div></div>`;
      body.innerHTML = html;
      body.querySelectorAll('[data-nav-id]').forEach((b) => b.addEventListener('click', () => {
        const kind = b.dataset.navKind, id = b.dataset.navId;
        if (kind === 'district') { warpTo(id); toggleNavigator(false); return; }
        if (kind === 'specimen') { toggleNavigator(false); const p = specimens.positionOf(id); if (p) flyTo(p[0] + 6.5, p[1] + 8.5, id, { dur: 0.9, then: () => openInspector(id) }); else openInspector(id); return; }
        if (kind === 'action') {
          if (id === 'compare') { refreshCompare(); toast(adapter.compareIds().length ? 'Compare ring summoned' : 'Pin forms first (⊕ on any specimen)', 'info'); }
          else if (id === 'lab') { warpTo('prism'); lab.syncFromForm(); lab.run(); renderLabResults(); }
          else if (id === 'battle') { startBattle(adapter.selectedId()); }
          else if (id === 'circuit') {
            const s = adapter.battleSnapshot();
            const la = s ? adapter.entry(s.a.id).line : 'Twink';
            const lb = s ? adapter.entry(s.b.id).line : 'Cub';
            circuitMode.start(la, lb);
          }
          else if (id === 'exit') exitCircuit();
          toggleNavigator(false);
        }
      }));
    }

    function toggleNavigator(force) {
      const nav = $('#circuitNavigator');
      const btn = $('#circuitNavToggle');
      if (!nav) return;
      const open = force != null ? !!force : nav.hidden;
      nav.hidden = !open;
      if (btn) btn.setAttribute('aria-expanded', String(open));
      if (open) { refreshNavigator(); const first = nav.querySelector('button'); if (first) first.focus(); }
    }

    /* ---- quality / motion ---------------------------------------------- */
    function reducedWanted() {
      const sys = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      return adapter.prefs.motion === 'reduced' || (adapter.prefs.motion === 'auto' && sys);
    }

    function applyQuality(mode) {
      adapter.prefs.quality = mode;
      runtime.setQuality(mode);
      world.setQuality(runtime.quality);
      battle.setQualityMode(mode);
      const b = $('#circuitQualityBtn');
      if (b) b.innerHTML = `QUALITY <b>${C.QUALITY[mode].label}</b>`;
    }

    function applyMotion() {
      const r = reducedWanted();
      runtime.setReducedMotion(r);
      battle.setMotion(r);
      const b = $('#circuitMotionBtn');
      if (b) { b.innerHTML = `MOTION <b>${r ? 'REDUCED' : 'SYSTEM'}</b>`; b.setAttribute('aria-pressed', String(r)); }
      document.body.classList.toggle('circuit-reduced', r);
    }

    /* ---- telemetry ------------------------------------------------------ */
    runtime.onTelemetry((t) => {
      const el = $('#circuitTelemetry');
      if (el) {
        el.textContent = `THREE r${t.version} · ${t.fps} FPS · ${t.frameMs}ms · ${t.calls} calls · ${(t.triangles / 1000).toFixed(1)}k tris · ${t.textures} tex · ${t.geometries} geo · ${t.programs} prog · DPR ${t.dpr} · ${t.qualityLabel}`;
      }
      // Only the visible HUD is written; when it is closed the DOM layer's own
      // sampler is idle too, so nothing formats telemetry nobody is reading.
      const hud = $('#perfHud');
      if (hud && hud.classList.contains('show')) hud.innerHTML = `FPS ${t.fps}<br>CALLS ${t.calls}<br>TRIS ${(t.triangles / 1000).toFixed(1)}k<br>TEX ${t.textures}<br>GEO ${t.geometries}<br>PROG ${t.programs}<br>DPR ${t.dpr}<br>3D ${t.qualityLabel}`;
      const st = $('#engineStatus');
      if (st) st.textContent = `HOLO ENGINE: GAYDEX CIRCUIT // THREE r${t.version} // ${t.qualityLabel}`;
    });

    /* ---- frame ---------------------------------------------------------- */
    runtime.onFrame((dt, t, anim, q) => {
      updateDirector(dt, t, anim);
      if (director.mode !== 'battle' && director.mode !== 'fly') input.update(dt, t, anim);
      const nearId = specimens.update(dt, t, anim, q, runtime.camera);
      if (nearId && !inspecting && !battle.active && input.target && input.target.kind === 'specimen' && input.target.id !== nearId) {
        // Crosshair wins; nothing to do. Kept explicit for readability.
      }
      world.update(dt, t, anim, q);
      battle.update(dt, t, anim);
      compare.update(dt, t, anim, q, runtime.camera);
      lab.update(dt, t, anim, q, runtime.camera);
      const upd = assets.takeUpdated();
      if (upd) { /* textures upgraded in place; nothing else to do */ }
      // District tracking for the HUD card.
      const d = world.districtAt(runtime.camera.position.x, runtime.camera.position.z);
      if (d !== world.activeDistrict) { world.setActiveDistrict(d); setDistrictCard(d); }
      if (battle.active) renderBattleHudThrottled(t);
    });

    let lastHud = 0;
    function renderBattleHudThrottled(t) {
      if (t - lastHud < 0.25) return;
      lastHud = t;
      renderBattleHud();
    }

    /* ---- engine events -> 3D -------------------------------------------- */
    adapter.on('battle', (ev) => {
      battle.onEvent(ev);
      if (ev && ev.kind === 'damage') {
        director.shake = Math.min(1, director.shake + (ev.move === 'signature' ? 0.9 : 0.4));
        if (ev.move === 'signature' || ev.flowBurst) world.pulseFocus(ev.move === 'signature' ? 1.25 : 0.7);
      }
    });
    adapter.on('discovery', () => refreshNavigator());
    adapter.on('battleLifecycle', (phase) => { if (phase === 'exit') renderBattleHud(); });

    /* ---- legacy bridges --------------------------------------------------
     * app.js already calls these; they now drive Three.js. */
    window.gayDexBattle3D = {
      setScene: (s) => battle.setScene(s),
      setState: (m) => { if (!m) return; battle.setState(adapter.battleSnapshot()); battle.setPortraits(m.a.entry, m.b.entry); },
      pulse: (hex, s) => battle.pulse(hex, s),
      setQuality: (m) => battle.setQualityMode(m),
      setMotion: (r) => battle.setMotion(r),
      mount: () => battle.mount(),
      onEvent: (e) => battle.onEvent(e),
      dispose: () => {}, // disposed with the Circuit
      get active() { return battle.active; },
    };
    window.gayDex3D = {
      setEntry: (e) => { if (e) specimens.setSelected(e.id); },
      setBattlePair: (a, b) => battle.setPortraits(a, b),
      battlePulse: () => { director.shake = Math.min(1, director.shake + 0.35); },
      burst: () => { director.shake = Math.min(1, director.shake + 0.5); },
      dispose: () => {},
    };

    /* ---- circuit mode ---------------------------------------------------- */
    const circuitMode = C.createCircuitMode({
      adapter, world, runtime,
      flyTo: (x, z, label) => flyTo(x, z, label, { dur: 1.0 }),
      onStatus: (title, sub) => toast(`${title} // ${sub}`, 'info'),
      onBoutStart: () => renderBattleHud(),
      onBoutEnd: () => renderBattleHud(),
      onReport: (report) => showCircuitReport(report),
    });

    function showCircuitReport(report) {
      const panel = $('#circuitInspector');
      if (!panel) return;
      inspecting = null;
      panel.hidden = false;
      $('#circuitInspectorEyebrow').textContent = 'CIRCUIT REPORT // MEASURED';
      $('#circuitInspectorName').textContent = `${report.lineA} vs ${report.lineB}`;
      $('#circuitInspectorDesc').textContent = `${report.bouts.length} bouts · ${report.rounds} rounds · score ${report.score.a}–${report.score.b}. Every figure below was recorded by the battle engine during the run.`;
      const img = $('#circuitInspectorImg');
      if (img) { img.src = adapter.entry(report.bouts[0].a).img; img.alt = ''; }
      const facts = $('#circuitInspectorFacts');
      const tA = report.totals.a, tB = report.totals.b;
      if (facts) {
        facts.innerHTML = [
          ['Counters', `${tA.counters} / ${tB.counters}`],
          ['Read locks', `${tA.readLocks} / ${tB.readLocks}`],
          ['Flow breaks', `${tA.flowBreaks} / ${tB.flowBreaks}`],
          ['Guard uses', `${tA.guards} / ${tB.guards}`],
          ['Signatures', `${tA.signatures} / ${tB.signatures}`],
          ['Crits', `${tA.crits} / ${tB.crits}`],
          ['Damage', `${tA.damage} / ${tB.damage}`],
          ['Shielded', `${tA.shielded} / ${tB.shielded}`],
          ['Biggest hit', `${report.biggestHit.value} by ${report.biggestHit.side === 'a' ? report.lineA : report.lineB}${report.biggestHit.bout ? ` (${report.biggestHit.bout})` : ''}`],
          ['Initiative share', `${Math.round(report.initiative.aShare * 100)}% / ${Math.round(report.initiative.bShare * 100)}% of ${report.initiative.a + report.initiative.b} exchanges`],
          ['Closest bout', report.closestBout ? `${report.closestBout.label} — ${report.closestBout.hpA}/${report.closestBout.hpB} HP` : '—'],
          [`${report.lineA} vectors`, report.vectorTendencies.a.map((v) => `${v.move} ${v.count}`).join(' · ') || '—'],
          [`${report.lineB} vectors`, report.vectorTendencies.b.map((v) => `${v.move} ${v.count}`).join(' · ') || '—'],
        ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
      }
      const st = $('#circuitInspectorStats');
      if (st) {
        st.innerHTML = report.bouts.map((b, i) => `<div class="circuit-stat"><span>Bout ${i + 1} · ${escapeHtml(b.label)}</span><span class="track"><i style="width:${b.winner === 'a' ? 100 : b.winner === 'b' ? 0 : 50}%"></i></span><b>${escapeHtml(b.winnerName || 'DRAW')}</b></div>`).join('');
      }
      const tr = $('#circuitInspectorTraits');
      if (tr) tr.innerHTML = '';
      const lin = $('#circuitInspectorLineage');
      if (lin) lin.innerHTML = '';
      const acts = $('#circuitInspectorActions');
      if (acts) acts.innerHTML = `<button type="button" class="circuit-btn" id="ciCloseReport">Close report</button>`;
      const cr = $('#ciCloseReport');
      if (cr) cr.addEventListener('click', () => { panel.hidden = true; });
    }

    /* ---- enter / exit ---------------------------------------------------- */
    function enterCircuit() {
      if (!root) return;
      root.hidden = false;
      document.body.classList.add('circuit-on');
      adapter.prefs.entered = true;
      if (enterBtn) { enterBtn.setAttribute('aria-pressed', 'true'); enterBtn.innerHTML = '⬢ <strong>Exit the Circuit</strong>'; }
      runtime.resume('user');
      applyQuality(adapter.prefs.quality);
      applyMotion();
      setDistrictCard(adapter.prefs.lastDistrict);
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      const tc = $('#circuitTouch');
      if (tc) tc.hidden = !touch;
      refreshNavigator();
      refreshCompare();
      const saved = adapter.prefs.camera;
      if (saved && typeof saved.x === 'number') input.teleport(saved.x, saved.z, saved.yaw);
      else warpTo(adapter.prefs.lastDistrict);
      toast('GAYDEX CIRCUIT ONLINE // WASD move · drag look · E scan · Tab cycle · F1–F4 travel · Esc back', 'ok');
    }

    function exitCircuit() {
      if (!root) return;
      adapter.prefs.camera = { x: runtime.camera.position.x, z: runtime.camera.position.z, yaw: input.rig.yaw };
      if (battle.active) battle.exit();
      root.hidden = true;
      document.body.classList.remove('circuit-on');
      adapter.prefs.entered = false;
      if (enterBtn) { enterBtn.setAttribute('aria-pressed', 'false'); enterBtn.innerHTML = '⬢ <strong>Enter the Circuit</strong>'; }
      runtime.suspend('user');
      closeInspector();
    }

    /* ---- DOM wiring ------------------------------------------------------ */
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    if (enterBtn) enterBtn.addEventListener('click', () => { if (root.hidden) enterCircuit(); else exitCircuit(); });
    const ex = $('#circuitExit');
    if (ex) ex.addEventListener('click', () => exitCircuit());
    const qb = $('#circuitQualityBtn');
    if (qb) qb.addEventListener('click', () => {
      const i = C.QUALITY_STEPS.indexOf(adapter.prefs.quality);
      applyQuality(C.QUALITY_STEPS[(i + 1) % C.QUALITY_STEPS.length]);
      toast(`QUALITY ${C.QUALITY[adapter.prefs.quality].label}`, 'info');
    });
    const mb = $('#circuitMotionBtn');
    if (mb) mb.addEventListener('click', () => {
      adapter.prefs.motion = reducedWanted() ? 'auto' : 'reduced';
      applyMotion();
      toast(`MOTION ${reducedWanted() ? 'REDUCED' : 'SYSTEM'} — independent of graphics quality`, 'info');
    });
    const sb = $('#circuitSfxBtn');
    if (sb) sb.addEventListener('click', () => {
      const b = $('#battleSfx');
      if (b) b.click();
      const on = b ? b.getAttribute('aria-pressed') === 'true' : true;
      sb.setAttribute('aria-pressed', String(on));
      sb.innerHTML = `${on ? '🔊' : '🔇'} <b>SFX</b>`;
    });
    const nt = $('#circuitNavToggle');
    if (nt) nt.addEventListener('click', () => toggleNavigator());
    const nc = $('#circuitNavClose');
    if (nc) nc.addEventListener('click', () => toggleNavigator(false));
    const ic = $('#circuitInspectorClose');
    if (ic) ic.addEventListener('click', () => closeInspector());
    const ti = $('#circuitTouchInteract');
    if (ti) ti.addEventListener('click', () => { const t = input.target; if (t) handleInteract(t.kind, t.id); });
    const tx = $('#circuitTouchIndex');
    if (tx) tx.addEventListener('click', () => toggleNavigator());

    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener?.('change', () => { if (adapter.prefs.motion === 'auto') applyMotion(); });
    }
    window.addEventListener('beforeunload', () => dispose(), { once: true });

    /* ---- boot ------------------------------------------------------------ */
    world.setQuality(runtime.quality);
    battle.setScene(C.DISTRICT_TO_SCENE[districtForLine(adapter.lineOf(adapter.entry(adapter.selectedId())))] || 'prism');
    runtime.suspend('user');
    input.setEnabled(false);

    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      input.dispose();
      circuitMode.dispose();
      lab.dispose();
      compare.dispose();
      battle.dispose();
      specimens.dispose();
      world.dispose();
      assets.dispose();
      runtime.dispose();
    }

    const api = {
      THREE, runtime, assets, world, specimens, input, battle, compare, lab, circuitMode, adapter, director,
      enterCircuit, exitCircuit, warpTo, openInspector, closeInspector, startBattle, exitBattle,
      applyQuality, applyMotion, toast, dispose, support,
      get active() { return !!root && !root.hidden; },
    };
    window.GayDexCircuit.api = api;

    // Auto-enter unless the user previously left.
    if (adapter.prefs.entered) enterCircuit();
    return api;
  }

  C.boot = boot;
  C.detectSupport = detectSupport;
  C.showFallback = showFallback;
})(window.GayDexCircuit);

/* ---------------------------------------------------------------------------
 * Startup. Runs after app.js has published window.GayDexApp. Any failure here
 * must degrade to the static path, never break the catalog or battle terminal.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';
  function start() {
    try {
      const api = C.boot();
      if (!api) window.GayDexCircuitState = { ok: false, reason: 'unsupported' };
      else window.GayDexCircuitState = { ok: true, revision: api.support.revision };
      window.dispatchEvent(new CustomEvent('gaydex:circuit-ready', { detail: window.GayDexCircuitState }));
    } catch (err) {
      console.error('[GayDex Circuit] boot failed — falling back to the static terminal.', err);
      window.GayDexCircuitState = { ok: false, reason: String((err && err.message) || err) };
      const root = document.querySelector('#circuitRoot');
      if (root) root.hidden = true;
      document.body.classList.remove('circuit-on');
      showFallback(`startup error: ${(err && err.message) || err}`);
      const pill = document.querySelector('#enginePill');
      if (pill) pill.innerHTML = '3D <strong>static fallback</strong>';
      window.dispatchEvent(new CustomEvent('gaydex:circuit-ready', { detail: window.GayDexCircuitState }));
    }
  }
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window.GayDexCircuit);
