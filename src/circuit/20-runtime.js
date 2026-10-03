/* ---------------------------------------------------------------------------
 * GayDex: Circuit — Three.js runtime.
 *
 * Lane: threejs-project-engineer (renderer/lifecycle) +
 *       threejs-performance-lifecycle-auditor (telemetry, adaptive quality) +
 *       threejs-version-migration-manager (all THREE.* usage is behind this
 *       module and the builders, so a future three upgrade is a contained
 *       change rather than a rewrite).
 *
 * Owns exactly one WebGLRenderer, exactly one requestAnimationFrame loop, one
 * scene and one camera.  Everything else subscribes via onFrame().
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp } = C.util;

  /**
   * @param {typeof THREE} THREE
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { quality:'auto'|'high'|'eco', onTelemetry, onContextLost, onContextRestored }
   */
  function createRuntime(THREE, canvas, opts = {}) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias !== false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x04050e, 1);
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070a1a, 0.0062);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 620);
    camera.position.set(0, C.RIG.eyeHeight, 0);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    /* ---- mode / quality ------------------------------------------------ */
    let mode = C.QUALITY[opts.quality] ? opts.quality : 'auto';
    /** auto may walk the ladder at runtime; `tier` is what is actually applied. */
    let tier = mode === 'auto' ? 'auto' : mode;
    let quality = { ...C.QUALITY[tier] };
    const reducedMotion = { value: false };

    /* ---- lifecycle blockers -------------------------------------------
     * Rendering happens only when the canvas is on screen, the tab is visible
     * and no transition has explicitly suspended us. */
    const blockers = new Set();
    let raf = 0;
    let running = false;
    let contextLost = false;
    let disposed = false;

    const subscribers = [];
    function onFrame(fn) { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; }

    let last = 0;
    let time = 0;
    const frameTimes = [];
    let emaFrame = 16.7;
    let fps = 60;
    let telemetryTimer = 0;

    /* ---- sizing -------------------------------------------------------- */
    let width = 1, height = 1;
    let dpr = 1;

    function computeDpr() {
      const [lo, hi] = quality.dpr;
      const device = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
      return clamp(device, lo, hi);
    }

    function resize() {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width || canvas.clientWidth || 2));
      const h = Math.max(2, Math.round(rect.height || canvas.clientHeight || 2));
      const nextDpr = computeDpr();
      if (w === width && h === height && Math.abs(nextDpr - dpr) < 0.01) return;
      width = w; height = h; dpr = nextDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    /* ---- adaptive quality governor ------------------------------------
     * AUTO observes real frame cost and steps the ladder conservatively.
     * Wide dead zone (23ms down / 12.5ms up) + minimum dwell prevents the
     * classic oscillation where quality flip-flops every second. */
    const governor = {
      downMs: 23, upMs: 12.5, samples: 42, dwell: 4.2, sinceChange: 99,
      lowStreak: 0, highStreak: 0, changes: 0, history: [],
    };

    function applyTier(next, reason) {
      if (next === tier) return false;
      const prev = tier;
      tier = next;
      quality = { ...C.QUALITY[tier] };
      renderer.shadowMap.enabled = !!quality.shadows;
      renderer.shadowMap.needsUpdate = true;
      resize();
      governor.changes++;
      governor.sinceChange = 0;
      governor.history.push({ from: prev, to: next, reason, at: time });
      if (governor.history.length > 12) governor.history.shift();
      return true;
    }

    function stepTier(dir) {
      const i = C.QUALITY_STEPS.indexOf(tier);
      const next = C.QUALITY_STEPS[clamp(i + dir, 0, C.QUALITY_STEPS.length - 1)];
      return applyTier(next, dir < 0 ? 'frame budget exceeded' : 'headroom recovered');
    }

    function govern(dt) {
      governor.sinceChange += dt;
      if (mode !== 'auto' || governor.sinceChange < governor.dwell || frameTimes.length < governor.samples) return;
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      if (avg > governor.downMs) { governor.lowStreak++; governor.highStreak = 0; }
      else if (avg < governor.upMs) { governor.highStreak++; governor.lowStreak = 0; }
      else { governor.lowStreak = 0; governor.highStreak = 0; }
      if (governor.lowStreak >= 2) { governor.lowStreak = 0; if (stepTier(-1)) frameTimes.length = 0; }
      else if (governor.highStreak >= 4) { governor.highStreak = 0; if (stepTier(1)) frameTimes.length = 0; }
    }

    function setQuality(next) {
      if (!C.QUALITY[next]) return;
      mode = next;
      applyTier(next, 'user selection');
      governor.sinceChange = 99;
      governor.lowStreak = governor.highStreak = 0;
    }

    function setReducedMotion(v) { reducedMotion.value = !!v; }

    /* ---- loop ---------------------------------------------------------- */
    function tick(now) {
      raf = 0;
      if (disposed || !running) return;
      const dtRaw = last ? (now - last) / 1000 : 0.016;
      last = now;
      const dt = Math.min(0.05, Math.max(0.0005, dtRaw));
      time += dt;
      emaFrame = emaFrame * 0.9 + dtRaw * 1000 * 0.1;
      frameTimes.push(dtRaw * 1000);
      if (frameTimes.length > 120) frameTimes.shift();
      fps = 1 / Math.max(0.0005, emaFrame / 1000);

      // Adaptive motion scaling: ECO and reduced motion both slow ambient
      // animation, but reduced motion never changes graphics quality.
      const anim = reducedMotion.value ? 0.15 : quality.animationScale;

      resize();
      for (let i = 0; i < subscribers.length; i++) {
        try { subscribers[i](dt, time, anim, quality); } catch (err) { report(err); }
      }
      govern(dt);
      renderer.render(scene, camera);

      telemetryTimer += dt;
      if (telemetryTimer > 0.5) { telemetryTimer = 0; emitTelemetry(); }

      raf = requestAnimationFrame(tick);
    }

    const listeners = { error: [], contextLost: [], contextRestored: [] };
    function report(err) { listeners.error.forEach((f) => f(err)); }

    function emitTelemetry() {
      if (!listeners.telemetry) return;
      const info = renderer.info;
      listeners.telemetry({
        fps: Math.round(fps),
        frameMs: +emaFrame.toFixed(1),
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        programs: info.programs ? info.programs.length : 0,
        dpr: +dpr.toFixed(2),
        tier,
        mode,
        qualityLabel: quality.label,
        shadowMap: !!quality.shadows,
        subscribers: subscribers.length,
        running,
        contextLost,
        version: THREE.REVISION,
      });
    }
    listeners.telemetry = opts.onTelemetry || null;
    function onTelemetry(fn) { listeners.telemetry = fn; }
    function onError(fn) { listeners.error.push(fn); }

    /* ---- start / stop -------------------------------------------------- */
    function evaluate() {
      const shouldRun = !disposed && !contextLost && blockers.size === 0;
      if (shouldRun && !running) {
        running = true;
        last = 0;
        resize();
        raf = requestAnimationFrame(tick);
      } else if (!shouldRun && running) {
        running = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }
    }

    function suspend(reason) { blockers.add(reason || 'manual'); evaluate(); }
    function resume(reason) { blockers.delete(reason || 'manual'); evaluate(); }
    function isRunning() { return running; }

    /* ---- observers ----------------------------------------------------- */
    let resizeObserver = null, intersectionObserver = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(canvas.parentElement);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        const visible = entries[0] ? entries[0].isIntersecting : true;
        if (visible) resume('offscreen'); else suspend('offscreen');
      }, { threshold: 0.01 });
      intersectionObserver.observe(canvas);
    }
    function onVisibility() {
      if (typeof document === 'undefined') return;
      if (document.hidden) suspend('hidden-tab'); else resume('hidden-tab');
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    /* ---- context loss -------------------------------------------------- */
    function handleLost(e) {
      if (e && e.preventDefault) e.preventDefault();
      contextLost = true;
      evaluate();
      (opts.onContextLost || (() => {}))();
      listeners.contextLost.forEach((f) => f());
    }
    function handleRestored() {
      contextLost = false;
      // three re-uploads GPU resources on the next render; force a resize so
      // the drawing buffer matches the element again.
      width = height = 0;
      resize();
      evaluate();
      (opts.onContextRestored || (() => {}))();
      listeners.contextRestored.forEach((f) => f());
    }
    canvas.addEventListener('webglcontextlost', handleLost, { passive: false });
    canvas.addEventListener('webglcontextrestored', handleRestored);

    /* ---- boot ---------------------------------------------------------- */
    renderer.shadowMap.enabled = !!quality.shadows;
    resize();
    evaluate();

    function dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (resizeObserver) resizeObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
      subscribers.length = 0;
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach((m) => m && m.dispose());
      });
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss?.();
    }

    return {
      THREE, renderer, scene, camera,
      onFrame, onTelemetry, onError,
      resize, suspend, resume, isRunning, setQuality, setReducedMotion,
      get quality() { return quality; },
      get tier() { return tier; },
      get mode() { return mode; },
      get maxAnisotropy() { return maxAnisotropy; },
      get time() { return time; },
      get fps() { return fps; },
      get governor() { return governor; },
      get contextLost() { return contextLost; },
      get disposed() { return disposed; },
      get blockers() { return [...blockers]; },
      dispose,
    };
  }

  C.createRuntime = createRuntime;
})(window.GayDexCircuit);
