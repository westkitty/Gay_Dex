/* ---------------------------------------------------------------------------
 * GayDex: Circuit — shared namespace, world constants, math + disposal utils.
 *
 * Lane: threejs-project-engineer (foundation) + threejs-asset-pipeline (budgets)
 *
 * Every Circuit module hangs off `window.GayDexCircuit` and owns exactly one
 * concern.  Nothing in here touches battle truth: that stays in
 * `src/battle-core.js`.
 * ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const C = (root.GayDexCircuit = root.GayDexCircuit || {});

  C.VERSION = '1.0.0';
  /** Pinned dependency. Verified at boot and surfaced in the HUD. */
  C.THREE_VERSION_EXPECTED = '186';

  /* ---- world geography --------------------------------------------------
   * A compact authored plan: four districts on a compass around a transit
   * nexus. Distances are deliberately short so nothing feels like a trek. */
  C.DISTRICTS = {
    nexus: { id: 'nexus', name: 'Transit Nexus', short: 'NEXUS', center: [0, 0], radius: 17, color: 0xbfd4ff, blurb: 'Route relay. Pick a district, or walk the spokes.' },
    prism: { id: 'prism', name: 'Prism Dome', short: 'PRISM', center: [0, -62], radius: 34, color: 0x42e7ff, line: 'Twink', blurb: 'Prediction lattice, lineage holograms, the Evolution Lab.' },
    aqua: { id: 'aqua', name: 'Aqua Pulse Bay', short: 'AQUA', center: [-62, 0], radius: 34, color: 0x3aa0ff, line: 'Otter', blurb: 'Flow state. Tide lanes and the Otter route.' },
    pride: { id: 'pride', name: 'Pride Circuit', short: 'PRIDE', center: [62, 0], radius: 34, color: 0xff4db8, line: 'Independent', blurb: 'Crowd circuit. Signatures, spectacle, the wild cards.' },
    emerald: { id: 'emerald', name: 'Emerald Relay', short: 'EMERALD', center: [0, 62], radius: 34, color: 0x57e38c, line: 'Cub', blurb: 'Grounded pressure. Guard, recovery, the Cub route.' },
  };

  /** Battle scene id <-> district id. The engine's scene names are canonical. */
  C.SCENE_TO_DISTRICT = { prism: 'prism', aqua: 'aqua', pride: 'pride', forest: 'emerald' };
  C.DISTRICT_TO_SCENE = { prism: 'prism', aqua: 'aqua', pride: 'pride', emerald: 'forest' };

  C.LINE_COLOR = { Twink: 0xff4db8, Cub: 0xffc14a, Otter: 0x57e38c, Independent: 0x7a82ff };

  /** Specimen presentation scale (world units). */
  C.SPECIMEN = { height: 3.4, hitRadius: 2.35, scanRange: 15, labelY: 2.5 };

  /** Camera rig limits. */
  C.RIG = {
    eyeHeight: 2.05,
    walkSpeed: 17,
    runSpeed: 27,
    turnSpeed: 2.5,
    pitchLimit: [ -0.62, 0.42 ],
    bounds: 104,
    dragSensitivity: 0.0032,
  };

  /* ---- quality ---------------------------------------------------------
   * AUTO / HIGH / ECO map to real rendering cost. Reduced motion is a
   * separate, orthogonal switch and is never derived from these. */
  C.QUALITY = {
    high: {
      label: 'HIGH', dpr: [1, 2.0], shadows: true, shadowMapSize: 1024,
      crowd: 420, particles: 900, trees: 64, waterSegments: 96,
      lattice: 1, anisotropy: 4, bloomSprites: true, animationScale: 1,
    },
    auto: {
      label: 'AUTO', dpr: [1, 1.5], shadows: true, shadowMapSize: 768,
      crowd: 260, particles: 520, trees: 44, waterSegments: 72,
      lattice: 1, anisotropy: 2, bloomSprites: true, animationScale: 1,
    },
    eco: {
      label: 'ECO', dpr: [0.65, 1.0], shadows: false, shadowMapSize: 0,
      crowd: 90, particles: 180, trees: 20, waterSegments: 40,
      lattice: 0, anisotropy: 1, bloomSprites: false, animationScale: 0.55,
    },
  };
  C.QUALITY_STEPS = ['eco', 'auto', 'high'];

  /* ---- math utils ------------------------------------------------------ */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  /** Frame-rate independent exponential smoothing. */
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;

  function hexToRgb(hex) {
    const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** Deterministic hash for stable pseudo-random scatter (no Math.random drift). */
  function hash01(n) {
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ---- resource lifecycle ---------------------------------------------
   * One place that knows how to tear a subtree down, so nothing leaks. */
  function disposeSubtree(object3d, { disposeGeometry = true, disposeMaterial = true } = {}) {
    const seen = new Set();
    object3d.traverse((o) => {
      if (disposeGeometry && o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
        }
        m.dispose();
      }
    });
    if (object3d.parent) object3d.parent.remove(object3d);
    object3d.clear?.();
    return seen.size;
  }

  /** Bookkeeping for "did we leak?" assertions in tests and the HUD. */
  function createLedger() {
    const items = new Set();
    return {
      add(x) { if (x) items.add(x); return x; },
      drop(x) { items.delete(x); },
      get size() { return items.size; },
      clear() { items.clear(); },
      list() { return [...items]; },
    };
  }

  C.util = { clamp, lerp, damp, smoothstep, hexToRgb, hash01, TAU, disposeSubtree, createLedger };

  /** Guard used by every module so a partial Circuit degrades instead of throwing. */
  C.hasThree = () => !!(root.THREE && root.THREE.WebGLRenderer && root.THREE.REVISION);
})(typeof window !== 'undefined' ? window : globalThis);
