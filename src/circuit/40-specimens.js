/* ---------------------------------------------------------------------------
 * GayDex: Circuit — specimens.
 *
 * Lane: threejs-asset-pipeline (portrait textures) + threejs-project-engineer
 *       (presentation, hit testing).
 *
 * Deliberate choice: canonical GayDex portraits stay recognisably canonical.
 * They are presented as polished 2.5D spatial specimens — a transparent
 * portrait plane over an additive rim/hologram plane, on a plinth, with a
 * spatial label and a generous invisible hit region — inside a real 3D world.
 * No generic 3D humans, and a future GLB model can replace `portrait` without
 * any gameplay change.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp, TAU } = C.util;

  function createSpecimenField(THREE, opts = {}) {
    const assets = opts.assets;
    const world = opts.world;
    const root = new THREE.Group();
    root.name = 'specimens';
    world.root.add(root);

    const specimens = new Map();
    const hitTargets = [];
    const disposables = [];
    const track = (x) => { disposables.push(x); return x; };

    // Shared geometry: every specimen reuses these, so 19 specimens cost
    // 4 geometries, not 76.
    const portraitGeo = track(new THREE.PlaneGeometry(1, 1));
    const ringGeo = track(new THREE.TorusGeometry(1.55, 0.075, 6, 48));
    const plinthGeo = track(new THREE.CylinderGeometry(1.75, 2.05, 0.32, 24));
    const beamGeo = track(new THREE.CylinderGeometry(1.9, 1.9, 9, 20, 1, true));
    const hitGeo = track(new THREE.SphereGeometry(C.SPECIMEN.hitRadius, 12, 10));
    const hitMat = track(new THREE.MeshBasicMaterial({ visible: false }));

    /**
     * @param {object} entry canonical GayDex entry
     * @param {number[]} worldPos [x, z]
     * @param {object} meta { district, line, routeNode }
     */
    function add(entry, worldPos, meta = {}) {
      if (specimens.has(entry.id)) return specimens.get(entry.id);

      const color = C.LINE_COLOR[entry.line] || 0x42e7ff;
      const group = new THREE.Group();
      group.position.set(worldPos[0], 0, worldPos[1]);
      group.name = 'specimen-' + entry.id;
      root.add(group);

      const portraitTex = assets.get(entry.img);
      const rimTex = portraitTex;

      // Portrait plane (canonical art, transparent).
      const portraitMat = assets.cloneMaterialFor(assets.specimenMaterial(portraitTex, color, 'portrait'), portraitTex);
      const portrait = new THREE.Mesh(portraitGeo, portraitMat);
      portrait.position.y = C.SPECIMEN.height * 0.56;
      portrait.scale.set(C.SPECIMEN.height * 0.78, C.SPECIMEN.height, 1);
      group.add(portrait);

      // Rim / hologram plane, slightly behind and larger.
      const rimMat = assets.cloneMaterialFor(assets.specimenMaterial(rimTex, color, 'rim'), rimTex);
      const rim = new THREE.Mesh(portraitGeo, rimMat);
      rim.position.set(0, C.SPECIMEN.height * 0.56, -0.22);
      rim.scale.set(C.SPECIMEN.height * 0.92, C.SPECIMEN.height * 1.12, 1);
      group.add(rim);

      // Depth-separated backing glow.
      const glow = new THREE.Mesh(
        track(new THREE.PlaneGeometry(1, 1)),
        track(new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
          depthWrite: false, toneMapped: false,
        })),
      );
      glow.position.set(0, C.SPECIMEN.height * 0.56, -0.55);
      glow.scale.set(C.SPECIMEN.height * 1.5, C.SPECIMEN.height * 1.5, 1);
      group.add(glow);

      // Support geometry: plinth, ring, holo beam.
      const plinth = new THREE.Mesh(plinthGeo, track(new THREE.MeshStandardMaterial({
        color: 0x101634, roughness: 0.4, metalness: 0.6, emissive: color, emissiveIntensity: 0.3,
      })));
      plinth.position.y = 0.16;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const ring = new THREE.Mesh(ringGeo, track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, toneMapped: false })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.38;
      group.add(ring);

      const beam = new THREE.Mesh(beamGeo, track(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })));
      beam.position.y = 4.5;
      group.add(beam);

      // Spatial label.
      let labelSprite = null;
      const labelTex = assets.label('spec-' + entry.id, entry.name.toUpperCase(), {
        color: '#eaf2ff', sub: `${entry.line} · ${entry.stage}`, size: 62, box: true,
      });
      if (labelTex) {
        labelSprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false, toneMapped: false })));
        const asp = labelTex.userData.aspect || 4;
        labelSprite.scale.set(asp * 1.9, 1.9, 1);
        labelSprite.position.y = C.SPECIMEN.labelY + 1.9;
        group.add(labelSprite);
      }

      // Generous invisible hit region — never a pixel hunt.
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = C.SPECIMEN.height * 0.55;
      hit.userData = { kind: 'specimen', id: entry.id, ref: group };
      group.add(hit);
      hitTargets.push(hit);

      const rec = {
        id: entry.id, entry, group, portrait, rim, glow, plinth, ring, beam,
        labelSprite, hit, color, meta,
        discovered: false, selected: false, hovered: false, inspecting: false,
        near: 0, aspectApplied: false, bob: Math.random() * TAU,
      };
      specimens.set(entry.id, rec);
      return rec;
    }

    /** Undiscovered specimens are rim-only holograms; scanning reveals the art. */
    function setDiscovered(id, v) {
      const s = specimens.get(id);
      if (!s) return;
      s.discovered = !!v;
      s.portrait.visible = s.discovered;
      s.glow.material.opacity = s.discovered ? 0.16 : 0.05;
      s.rim.material.uniforms.uOpacity.value = s.discovered ? 0.55 : 0.95;
      if (s.labelSprite) s.labelSprite.material.opacity = s.discovered ? 1 : 0.55;
    }

    function setSelected(id) {
      for (const s of specimens.values()) s.selected = s.id === id;
    }

    function setInspecting(id) {
      for (const s of specimens.values()) s.inspecting = s.id === id;
    }

    /** Apply the true image aspect once the texture has decoded. */
    function applyAspect(s) {
      const img = s.portrait.material.map && s.portrait.material.map.image;
      if (!img || !img.width || !img.height) return false;
      const aspect = img.width / img.height;
      const h = C.SPECIMEN.height;
      s.portrait.scale.set(h * aspect, h, 1);
      s.rim.scale.set(h * aspect * 1.14, h * 1.12, 1);
      s.aspectApplied = true;
      return true;
    }

    let cameraRef = null;
    let nearest = null;

    function update(dt, t, anim, q, camera) {
      cameraRef = camera || cameraRef;
      let bestId = null, bestDist = C.SPECIMEN.scanRange;

      for (const s of specimens.values()) {
        if (!s.aspectApplied) applyAspect(s);

        const dx = s.group.position.x - (cameraRef ? cameraRef.position.x : 0);
        const dz = s.group.position.z - (cameraRef ? cameraRef.position.z : 0);
        const dist = Math.hypot(dx, dz);

        // Constrained billboard: yaw only, so specimens never tip over.
        if (cameraRef) {
          const want = Math.atan2(cameraRef.position.x - s.group.position.x, cameraRef.position.z - s.group.position.z);
          s.group.rotation.y = damp(s.group.rotation.y, want, 6, dt);
        }

        const target = clamp(1 - dist / C.SPECIMEN.scanRange, 0, 1);
        s.near = damp(s.near, target, 5, dt);

        const inspect = s.inspecting ? 1 : 0;
        const lift = inspect ? 1.5 : 0;
        s.group.position.y = damp(s.group.position.y, lift, 4, dt);

        // Subtle parallax bob; suppressed under reduced motion.
        const bobAmt = anim * (0.10 + s.near * 0.06);
        s.portrait.position.y = C.SPECIMEN.height * 0.56 + Math.sin(t * 1.1 + s.bob) * bobAmt;
        s.rim.position.y = s.portrait.position.y;
        s.glow.position.y = s.portrait.position.y;

        const energy = 0.35 + s.near * 0.9 + (s.selected ? 0.5 : 0) + inspect * 0.6;
        s.rim.material.uniforms.uEnergy.value = energy;
        s.rim.material.uniforms.uTime.value = t;
        s.ring.material.opacity = 0.35 + s.near * 0.5 + (s.selected ? 0.25 : 0);
        s.ring.rotation.z += dt * (0.3 + s.near * 1.4) * anim;
        s.ring.scale.setScalar(1 + Math.sin(t * 1.6 + s.bob) * 0.02 * anim + s.near * 0.06);
        s.beam.material.opacity = 0.03 + s.near * 0.09 + inspect * 0.1;
        s.plinth.material.emissiveIntensity = 0.22 + s.near * 0.7 + (s.selected ? 0.4 : 0);
        if (s.labelSprite) {
          s.labelSprite.material.opacity = clamp((s.discovered ? 0.45 : 0.28) + s.near * 0.6 + (s.selected ? 0.3 : 0), 0, 1);
          const sc = 1 + s.near * 0.12;
          s.labelSprite.scale.set((s.labelSprite.material.map.userData.aspect || 4) * 1.9 * sc, 1.9 * sc, 1);
        }

        if (dist < bestDist) { bestDist = dist; bestId = s.id; }
      }

      nearest = bestId;
      return nearest;
    }

    function get(id) { return specimens.get(id) || null; }
    function all() { return [...specimens.values()]; }
    function positionOf(id) { const s = specimens.get(id); return s ? [s.group.position.x, s.group.position.z] : null; }

    function dispose() {
      for (const d of disposables) { try { d.dispose(); } catch { /* already gone */ } }
      disposables.length = 0;
      specimens.clear();
      hitTargets.length = 0;
      if (root.parent) root.parent.remove(root);
      root.clear();
    }

    return { THREE, root, add, setDiscovered, setSelected, setInspecting, update, get, all, positionOf, hitTargets, dispose, get nearestId() { return nearest; } };
  }

  C.createSpecimenField = createSpecimenField;
})(window.GayDexCircuit);
