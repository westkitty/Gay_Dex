/* ---------------------------------------------------------------------------
 * GayDex: Circuit — asset pipeline.
 *
 * Lane: threejs-asset-pipeline.
 *
 * Rules this module enforces:
 *   1. Every runtime texture comes from an asset already embedded in the
 *      artifact (canonical GayDex portraits + the ten arena avatar sprites) or
 *      is generated locally from canvas 2D.  Nothing is downloaded at runtime,
 *      so the single-file artifact keeps working offline and there is no
 *      third-party licence or provenance question to answer.
 *   2. Textures are cached, budgeted and LRU-evicted.  Eviction disposes the
 *      GPU resource; nothing accumulates.
 *   3. A texture handle is returned synchronously (1x1 transparent) and
 *      upgraded in place when the image decodes, so scene construction never
 *      blocks on decode and callers never hold a null.
 *   4. Optional future GLB props are supported through `registerModelLoader`,
 *      but no model is required or fetched today.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp } = C.util;

  function createAssets(THREE, opts = {}) {
    const budget = opts.textureBudget || 26;
    const labelBudget = opts.labelBudget || 40;

    /** @type {Map<string,{texture:THREE.Texture,image:HTMLImageElement,state:string,hits:number}>} */
    const textures = new Map();
    /** @type {Map<string,THREE.CanvasTexture>} */
    const labels = new Map();
    let anisotropyCap = 1;
    let disposed = false;
    const pending = [];
    const stats = { created: 0, evicted: 0, labels: 0, decodeFailures: 0, deferred: 0, decoded: 0 };

    function setAnisotropy(cap) { anisotropyCap = Math.max(1, cap | 0); }

    function placeholderTexture() {
      const t = new THREE.Texture();
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    }

    /**
     * Get (or create) a texture handle for an asset source.
     *
     * Synchronous handle, upgraded in place when the image decodes, so callers
     * never hold null and scene construction never blocks.
     *
     * `opts.defer` returns the handle WITHOUT starting the decode. That matters
     * for the nineteen specimen portraits: decoding all of them while the page
     * is still booting costs megabytes of bitmap memory and CPU time the player
     * has not asked for yet, and only one district is on screen anyway. Call
     * `ensure(src)` when the portrait actually needs to exist, or `prewarm()`
     * to trickle the rest in during idle time.
     */
    function get(src, opts = {}) {
      if (!src) return null;
      if (disposed) return null;
      const hit = textures.get(src);
      if (hit) {
        hit.hits++;
        promote(src);
        if (!opts.defer) ensure(src);
        return hit.texture;
      }

      const texture = placeholderTexture();
      const record = { texture, image: null, state: opts.defer ? 'queued' : 'loading', hits: 1, src };
      textures.set(src, record);
      stats.created++;
      if (opts.defer) stats.deferred++;
      evictIfNeeded();
      if (!opts.defer) startDecode(src, record);
      return texture;
    }

    /** Begin (or restart) the decode for an existing record. */
    function startDecode(src, record) {
      if (disposed || !record || record.state === 'loading' || record.state === 'ready') return;
      const texture = record.texture;
      record.state = 'loading';
      const img = new Image();
      img.decoding = 'async';
      record.image = img;
      img.onload = () => {
        if (disposed) return;
        const live = textures.get(src);
        if (!live || live.texture !== texture) return; // evicted before decode
        texture.image = img;
        texture.flipY = false;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = anisotropyCap;
        texture.needsUpdate = true;
        live.state = 'ready';
        stats.decoded++;
        pending.push(texture);
      };
      img.onerror = () => {
        stats.decodeFailures++;
        const live = textures.get(src);
        if (live) live.state = 'error';
      };
      img.src = src;
    }

    /** Make sure `src` is being decoded (no-op when it already is, or is done). */
    function ensure(src) {
      if (!src || disposed) return null;
      const rec = textures.get(src);
      if (!rec) { get(src); return textures.get(src).texture; }
      startDecode(src, rec);
      return rec.texture;
    }

    /* ---- idle prewarm ---------------------------------------------------
     * Walk a list of sources during idle time, a few per callback, so the
     * critical path stays light while nothing is ever missing later. Falls
     * back to a timer where requestIdleCallback does not exist. */
    let prewarmHandle = 0;
    let prewarmCancelled = false;
    function prewarm(sources, opts2 = {}) {
      const queue = [...new Set((sources || []).filter(Boolean))];
      const per = Math.max(1, opts2.perCallback || 4);
      prewarmCancelled = false;
      const schedule = typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(fn, { timeout: 900 })
        : (fn) => setTimeout(fn, 32);
      const step = () => {
        if (disposed || prewarmCancelled) return;
        for (let i = 0; i < per && queue.length; i++) ensure(queue.shift());
        if (queue.length) prewarmHandle = schedule(step);
        else prewarmHandle = 0;
      };
      prewarmHandle = schedule(step);
      return () => { prewarmCancelled = true; prewarmHandle = 0; };
    }

    /** Resolve when every queued decode has settled (used by tests/telemetry). */
    function statsSnapshot() {
      const out = { queued: 0, loading: 0, ready: 0, error: 0, evicted: 0 };
      textures.forEach((r) => { out[r.state] = (out[r.state] || 0) + 1; });
      return out;
    }

    /** Textures whose image just finished decoding; the runtime flushes this. */
    function takeUpdated() {
      if (!pending.length) return null;
      const out = pending.slice();
      pending.length = 0;
      return out;
    }

    function promote(src) {
      const rec = textures.get(src);
      if (!rec) return;
      textures.delete(src);
      textures.set(src, rec); // re-insert = most recently used
    }

    function evictIfNeeded() {
      while (textures.size > budget) {
        const oldestKey = textures.keys().next().value;
        if (oldestKey === undefined) break;
        const rec = textures.get(oldestKey);
        textures.delete(oldestKey);
        if (rec) {
          rec.state = 'evicted';
          rec.texture.dispose();
          stats.evicted++;
        }
      }
    }

    /* ---- spatial typography --------------------------------------------
     * Labels are drawn with canvas 2D and cached. They are the readable half
     * of "spatial typography" — crisp, cheap, and never re-rendered per frame. */
    function label(key, text, o = {}) {
      if (typeof document === 'undefined') return null;
      if (disposed) return null;
      const cacheKey = `${key}|${text}|${o.color || '#ffffff'}|${o.size || 64}|${o.sub || ''}`;
      const hit = labels.get(cacheKey);
      if (hit) return hit;

      const size = o.size || 64;
      const pad = Math.round(size * 0.35);
      const sub = o.sub || '';
      const measure = document.createElement('canvas').getContext('2d');
      const font = `${o.weight || 700} ${size}px ${o.font || 'ui-monospace, SFMono-Regular, Menlo, monospace'}`;
      measure.font = font;
      const w = Math.ceil(Math.max(measure.measureText(text).width, sub ? measure.measureText(sub).width * 0.62 : 0)) + pad * 2;
      const h = Math.ceil(size * (sub ? 1.62 : 1.28)) + (o.box ? pad : 0);

      const cv = document.createElement('canvas');
      cv.width = Math.min(2048, Math.max(64, w));
      cv.height = Math.min(1024, Math.max(32, h));
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (o.box) {
        ctx.fillStyle = o.boxColor || 'rgba(6,10,26,0.72)';
        roundRect(ctx, 2, 2, cv.width - 4, cv.height - 4, Math.round(size * 0.22));
        ctx.fill();
        ctx.strokeStyle = o.color || '#ffffff';
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (o.glow !== false) {
        ctx.shadowColor = o.color || '#ffffff';
        ctx.shadowBlur = size * 0.35;
      }
      ctx.fillStyle = o.color || '#ffffff';
      ctx.fillText(text, cv.width / 2, sub ? cv.height * 0.38 : cv.height / 2);
      if (sub) {
        ctx.shadowBlur = 0;
        ctx.font = `500 ${Math.round(size * 0.42)}px ${o.font || 'ui-monospace, monospace'}`;
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = o.subColor || '#9fb0d8';
        ctx.fillText(sub, cv.width / 2, cv.height * 0.76);
      }

      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropyCap;
      tex.userData.aspect = cv.width / cv.height;
      labels.set(cacheKey, tex);
      stats.labels++;
      while (labels.size > labelBudget) {
        const oldest = labels.keys().next().value;
        labels.get(oldest).dispose();
        labels.delete(oldest);
        stats.evicted++;
      }
      return tex;
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ---- shared materials ----------------------------------------------
     * Specimen presentation is 2.5D: a transparent canonical portrait plane
     * over an additive rim/holo plane. Both are cached per (texture, tint) so
     * nineteen specimens do not mean thirty-eight unique programs. */
    const materialCache = new Map();

    function specimenMaterial(texture, tintHex, variant) {
      const key = `${tintHex}:${variant}`;
      let m = materialCache.get(key);
      if (m) { if (m.userData.textures && !m.userData.textures.has(texture)) m.userData.textures.add(texture); return m; }
      const [r, g, b] = C.util.hexToRgb(tintHex);
      if (variant === 'rim') {
        m = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: {
            uMap: { value: texture },
            uTint: { value: new THREE.Color(r, g, b) },
            uTime: { value: 0 },
            uEnergy: { value: 1 },
            uOpacity: { value: 0.55 },
          },
          vertexShader: [
            'varying vec2 vUv;',
            'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          ].join('\n'),
          fragmentShader: [
            'precision highp float;',
            'varying vec2 vUv;',
            'uniform sampler2D uMap; uniform vec3 uTint; uniform float uTime; uniform float uEnergy; uniform float uOpacity;',
            'void main(){',
            '  vec4 t = texture2D(uMap, vUv);',
            // Keep only the silhouette: rim energy lives on the alpha edge.
            '  float a = t.a;',
            '  float edge = smoothstep(0.02, 0.42, a) - smoothstep(0.55, 0.98, a);',
            '  float scan = 0.72 + 0.28 * sin((vUv.y * 46.0) - uTime * 2.4);',
            '  float body = a * (0.10 + 0.16 * scan);',
            '  vec3 col = uTint * (body + edge * 1.35 * uEnergy);',
            '  gl_FragColor = vec4(col, clamp(body + edge * 0.85, 0.0, 1.0) * uOpacity);',
            '}',
          ].join('\n'),
        });
      } else {
        m = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.02,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
          color: new THREE.Color(1, 1, 1),
        });
      }
      m.userData.textures = new Set([texture]);
      materialCache.set(key, m);
      return m;
    }

    /**
     * Re-point a cached shared material's texture. Materials are shared per
     * tint, so a specimen that changes portrait must not mutate the shared
     * material — callers instead use `cloneMaterialFor`.
     */
    function cloneMaterialFor(base, texture) {
      const m = base.clone();
      if (m.uniforms && m.uniforms.uMap) m.uniforms.uMap.value = texture;
      else m.map = texture;
      m.userData.shared = false;
      return m;
    }

    /* ---- optional GLB support ------------------------------------------
     * Future GLB specimens/props can be registered without touching gameplay.
     * Nothing is fetched unless a caller explicitly supplies a loader. */
    let modelLoader = null;
    function registerModelLoader(loader) { modelLoader = loader || null; }
    function loadModel(url, onReady) {
      if (!modelLoader) return null;
      const handle = { ready: false, object: null };
      try {
        modelLoader.load(url, (obj) => { handle.ready = true; handle.object = obj; onReady && onReady(obj); });
      } catch (err) { handle.error = err; }
      return handle;
    }

    function report(renderer) {
      const info = renderer && renderer.info;
      return {
        textures: textures.size,
        labels: labels.size,
        created: stats.created,
        evicted: stats.evicted,
        decodeFailures: stats.decodeFailures,
        gpuTextures: info ? info.memory.textures : null,
        gpuGeometries: info ? info.memory.geometries : null,
        programs: info && info.programs ? info.programs.length : null,
      };
    }

    function dispose() {
      disposed = true;
      prewarmCancelled = true;
      prewarmHandle = 0;
      textures.forEach((rec) => {
        if (rec.image) { rec.image.onload = null; rec.image.onerror = null; }
        rec.texture.dispose();
      });
      textures.clear();
      labels.forEach((t) => t.dispose());
      labels.clear();
      materialCache.forEach((m) => m.dispose());
      materialCache.clear();
      pending.length = 0;
    }

    return {
      get, ensure, prewarm, statsSnapshot, takeUpdated, label, specimenMaterial, cloneMaterialFor, setAnisotropy,
      registerModelLoader, loadModel, report, dispose,
      get stats() { return stats; },
      get count() { return textures.size; },
      get labelCount() { return labels.size; },
      get materialCount() { return materialCache.size; },
    };
  }

  C.createAssets = createAssets;
})(window.GayDexCircuit);
