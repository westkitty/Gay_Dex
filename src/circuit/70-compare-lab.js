/* ---------------------------------------------------------------------------
 * GayDex: Circuit — spatial compare ring + spatial Evolution Lab.
 *
 * Lane: threejs-project-engineer.
 *
 * Compare: up to three pinned forms are summoned around a readable ring. The
 * numbers stay in the DOM table (numerical readability is never traded for
 * spectacle); the 3D ring is the presentation of the same pinned set.
 *
 * Lab: the Prism Dome scanner is a spatial front-end onto the SAME scoring
 * function the conventional form uses. Spatial and conventional inputs must
 * produce identical candidates, because both call `labCandidates`.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp, TAU } = C.util;

  function createCompareRing(THREE, opts = {}) {
    const { world, assets, entryOf } = opts;
    /** Accept either a canonical id or an already-resolved entry. */
    const resolve = (x) => (typeof x === 'string' ? (entryOf ? entryOf(x) : null) : x) || null;
    const disposables = [];
    const track = (x) => { disposables.push(x); return x; };

    const group = new THREE.Group();
    group.name = 'compare-ring';
    group.visible = false;
    world.root.add(group);

    const ring = new THREE.Mesh(
      track(new THREE.TorusGeometry(6.4, 0.16, 8, 90)),
      track(new THREE.MeshBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.7, toneMapped: false })),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);

    const plate = new THREE.Mesh(
      track(new THREE.CircleGeometry(6.4, 64)),
      track(new THREE.MeshStandardMaterial({ color: 0x0b1030, roughness: 0.35, metalness: 0.6, emissive: 0x12214d, emissiveIntensity: 0.6, transparent: true, opacity: 0.92 })),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.12;
    plate.receiveShadow = true;
    group.add(plate);

    const slots = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const tex = assets.get('');
      const portraitMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0xffffff, 'portrait'), tex);
      const portrait = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), portraitMat);
      portrait.position.y = 1.9;
      portrait.scale.set(2.6, 3.3, 1);
      g.add(portrait);
      const rimMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0xffffff, 'rim'), tex);
      const rimMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), rimMat);
      rimMesh.position.set(0, 1.9, -0.16);
      rimMesh.scale.set(2.9, 3.5, 1);
      g.add(rimMesh);
      const pad = new THREE.Mesh(
        track(new THREE.CylinderGeometry(1.5, 1.7, 0.24, 24)),
        track(new THREE.MeshStandardMaterial({ color: 0x101634, roughness: 0.4, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.4 })),
      );
      pad.position.y = 0.12;
      group.add(pad);
      let label = null;
      group.add(g);
      slots.push({ group: g, portrait, rimMesh, pad, label, entry: null, angle: 0 });
    }

    let active = false;

    function show(ids, center) {
      const list = (ids || []).map(resolve).filter(Boolean).slice(0, 3);
      if (!list.length) { hide(); return; }
      group.position.set(center[0], 0, center[1]);
      group.visible = true;
      active = true;
      const n = Math.max(1, list.length);
      slots.forEach((slot, i) => {
        const e = list[i] || null;
        slot.entry = e;
        slot.group.visible = !!e;
        slot.pad.visible = !!e;
        if (!e) { if (slot.label) { slot.label.visible = false; } return; }
        const a = (i / n) * TAU - Math.PI / 2;
        slot.angle = a;
        slot.group.position.set(Math.cos(a) * 4.1, 0, Math.sin(a) * 4.1);
        slot.pad.position.set(slot.group.position.x, 0.12, slot.group.position.z);
        const tex = assets.get(e.img);
        slot.portrait.material.map = tex;
        slot.portrait.material.needsUpdate = true;
        slot.rimMesh.material.uniforms.uMap.value = tex;
        const col = C.LINE_COLOR[e.line] || 0x42e7ff;
        slot.rimMesh.material.uniforms.uTint.value.setHex(col);
        slot.pad.material.emissive.setHex(col);
        const img = tex && tex.image;
        if (img && img.width && img.height) {
          const asp = img.width / img.height;
          slot.portrait.scale.set(3.3 * asp, 3.3, 1);
          slot.rimMesh.scale.set(3.3 * asp * 1.1, 3.5, 1);
        }
        if (slot.label) { group.remove(slot.label); slot.label.material.map?.dispose?.(); slot.label.material.dispose(); slot.label = null; }
        const lt = assets.label('cmp-' + e.id, e.name.toUpperCase(), { color: '#eaf2ff', sub: `${e.line} · ${e.stage} · ${e.rarity}`, size: 58, box: true });
        if (lt) {
          const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, toneMapped: false })));
          const asp = lt.userData.aspect || 4;
          s.scale.set(asp * 1.7, 1.7, 1);
          s.position.set(slot.group.position.x, 4.5, slot.group.position.z);
          group.add(s);
          slot.label = s;
        }
      });
    }

    function hide() {
      active = false;
      group.visible = false;
      slots.forEach((s) => { s.entry = null; });
    }

    function update(dt, t, anim, q, camera) {
      if (!active) return;
      ring.rotation.z += dt * 0.18 * anim;
      ring.material.opacity = 0.55 + Math.sin(t * 1.4) * 0.15 * anim;
      for (const s of slots) {
        if (!s.entry || !s.group.visible) continue;
        if (camera) {
          const want = Math.atan2(camera.position.x - (group.position.x + s.group.position.x), camera.position.z - (group.position.z + s.group.position.z));
          s.group.rotation.y = damp(s.group.rotation.y, want, 6, dt);
        }
        s.portrait.position.y = 1.9 + Math.sin(t * 1.2 + s.angle) * 0.08 * anim;
        s.rimMesh.position.y = s.portrait.position.y;
        s.rimMesh.material.uniforms.uTime.value = t;
        s.rimMesh.material.uniforms.uEnergy.value = 0.9;
      }
    }

    function dispose() {
      hide();
      for (const d of disposables) { try { d.dispose(); } catch { /* gone */ } }
      disposables.length = 0;
      if (group.parent) group.parent.remove(group);
      group.clear();
    }

    return { THREE, group, show, hide, update, dispose, get active() { return active; } };
  }

  /* ==================================================================== *
   * SPATIAL EVOLUTION LAB
   * ==================================================================== */
  function createSpatialLab(THREE, opts = {}) {
    const { world, assets, adapter } = opts;
    const disposables = [];
    const track = (x) => { disposables.push(x); return x; };
    const console_ = world.districts.prism && world.districts.prism.lab;

    const DIAL_KEYS = ['build', 'hair', 'age', 'vibe'];
    /** Option lists mirror the conventional <select> elements exactly. */
    const OPTIONS = {
      build: ['slim', 'athletic', 'soft', 'large', 'variable'],
      hair: ['smooth', 'light', 'hairy', 'silver', 'variable'],
      age: ['young', 'adult', 'mature', 'silver'],
      vibe: ['boyish', 'sporty', 'rugged', 'daddy', 'neutral'],
    };

    const group = new THREE.Group();
    group.name = 'lab-holograms';
    if (console_) {
      group.position.copy(console_.group.position);
      group.position.y = 0;
      world.districts.prism.group.add(group);
    } else {
      world.root.add(group);
    }

    const holos = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const tex = assets.get('');
      const portraitMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0x42e7ff, 'portrait'), tex);
      const portrait = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), portraitMat);
      portrait.position.y = 1.6;
      portrait.scale.set(2.1, 2.7, 1);
      g.add(portrait);
      const rimMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0x42e7ff, 'rim'), rimTexOr(tex));
      const rimMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), rimMat);
      rimMesh.position.set(0, 1.6, -0.14);
      rimMesh.scale.set(2.3, 2.9, 1);
      g.add(rimMesh);
      g.visible = false;
      group.add(g);
      holos.push({ group: g, portrait, rimMesh, label: null, entry: null, score: 0 });
    }
    function rimTexOr(tex) { return tex; }

    let state = { build: OPTIONS.build[0], hair: OPTIONS.hair[0], age: OPTIONS.age[0], vibe: OPTIONS.vibe[0] };
    let results = [];
    let active = false;

    /** Sync from the conventional form so both paths always agree. */
    function syncFromForm() {
      const v = adapter.labVals();
      for (const k of DIAL_KEYS) if (v[k] != null) state[k] = v[k];
    }

    function cycleDial(index, dir) {
      const key = DIAL_KEYS[index];
      if (!key) return null;
      syncFromForm();
      const list = OPTIONS[key];
      const i = list.indexOf(state[key]);
      state[key] = list[(i + (dir > 0 ? 1 : -1) + list.length) % list.length];
      adapter.setLabVals({ [key]: state[key] });
      run();
      return { key, value: state[key] };
    }

    function run() {
      results = adapter.labCandidates(state) || [];
      if (console_) console_.pulse();
      active = true;
      holos.forEach((h, i) => {
        const r = results[i];
        h.entry = r ? r[0] : null;
        h.score = r ? r[1] : 0;
        h.group.visible = !!r;
        if (!r) { if (h.label) h.label.visible = false; return; }
        const e = r[0];
        const a = (-1 + i) * 0.62;
        h.group.position.set(Math.sin(a) * 4.6, 0, Math.cos(a) * 4.6 - 1.5);
        h.group.rotation.y = -a;
        const tex = assets.get(e.img);
        h.portrait.material.map = tex;
        h.portrait.material.needsUpdate = true;
        h.rimMesh.material.uniforms.uMap.value = tex;
        h.rimMesh.material.uniforms.uTint.value.setHex(C.LINE_COLOR[e.line] || 0x42e7ff);
        const img = tex && tex.image;
        if (img && img.width && img.height) {
          const asp = img.width / img.height;
          h.portrait.scale.set(2.7 * asp, 2.7, 1);
          h.rimMesh.scale.set(2.7 * asp * 1.1, 2.9, 1);
        }
        if (h.label) { group.remove(h.label); h.label.material.dispose(); h.label = null; }
        const lt = assets.label('labres-' + e.id, `${i + 1}. ${e.name.toUpperCase()}`, {
          color: '#d8fbff', sub: `match ${r[1]} · ${e.designation}`, size: 54, box: true,
        });
        if (lt) {
          const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, toneMapped: false })));
          const asp = lt.userData.aspect || 4;
          s.scale.set(asp * 1.6, 1.6, 1);
          s.position.set(h.group.position.x, 3.7, h.group.position.z);
          group.add(s);
          h.label = s;
        }
      });
      return results.map((r) => ({ id: r[0].id, score: r[1] }));
    }

    function hide() {
      active = false;
      holos.forEach((h) => { h.group.visible = false; h.entry = null; if (h.label) h.label.visible = false; });
    }

    function update(dt, t, anim, q, camera) {
      if (!active) return;
      for (const h of holos) {
        if (!h.entry) continue;
        h.portrait.position.y = 1.6 + Math.sin(t * 1.3 + h.score) * 0.07 * anim;
        h.rimMesh.position.y = h.portrait.position.y;
        h.rimMesh.material.uniforms.uTime.value = t;
        h.rimMesh.material.uniforms.uEnergy.value = 1.1;
      }
    }

    function dispose() {
      hide();
      for (const d of disposables) { try { d.dispose(); } catch { /* gone */ } }
      disposables.length = 0;
      if (group.parent) group.parent.remove(group);
      group.clear();
    }

    return {
      THREE, group, holos, cycleDial, run, hide, update, dispose, syncFromForm,
      get state() { return { ...state }; },
      get results() { return results.map((r) => ({ id: r[0].id, name: r[0].name, score: r[1] })); },
      get active() { return active; },
      DIAL_KEYS, OPTIONS,
    };
  }

  C.createCompareRing = createCompareRing;
  C.createSpatialLab = createSpatialLab;
})(window.GayDexCircuit);
