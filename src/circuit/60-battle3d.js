/* ---------------------------------------------------------------------------
 * GayDex: Circuit — battle visualisation.
 *
 * Lane: threejs-project-engineer.
 *
 * STRICT RULE: this module consumes battle state and events. It never decides
 * damage, never rolls RNG, never resolves a round. Every number it draws is
 * read off the live match produced by `src/battle-core.js`, and every effect is
 * triggered by an event the engine already emitted.
 *
 * It also *is* `window.gayDexBattle3D`, so the existing call sites in app.js
 * (setScene / setState / pulse / setQuality / setMotion) keep working — they
 * now drive real Three.js instead of a raw WebGL fullscreen shader.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp, lerp } = C.util;

  function createBattleLayer(THREE, opts = {}) {
    const { runtime, world, assets } = opts;
    const disposables = [];
    const track = (x) => { disposables.push(x); return x; };

    const group = new THREE.Group();
    group.name = 'battle-arena';
    group.visible = false;
    world.root.add(group);

    /* ---- arena shell --------------------------------------------------- */
    const floorMat = track(new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(0xff4db8) },
        uColorB: { value: new THREE.Color(0xffc14a) },
        uShock: { value: 0 },      // 0..1 travelling FLEX wave
        uShockDir: { value: 1 },   // +1 from A, -1 from B
        uHype: { value: 0 },
        uScene: { value: 0 },      // 0 prism, 1 aqua, 2 pride, 3 emerald
        uPulse: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform float uTime, uShock, uShockDir, uHype, uScene, uPulse;',
        'uniform vec3 uColorA, uColorB;',
        'void main(){',
        '  vec2 p = vUv - 0.5;',
        '  float r = length(p);',
        '  vec3 base = vec3(0.02,0.025,0.06);',
        // Faction halves.
        '  float side = smoothstep(-0.02, 0.02, p.x * uShockDir);',
        '  base += mix(uColorB, uColorA, side) * 0.10;',
        // Concentric arena rings.
        '  float rings = smoothstep(0.48, 0.5, abs(fract(r * 9.0) - 0.5));',
        '  base += mix(uColorA, uColorB, 0.5) * rings * 0.35;',
        // FLEX: pressure travelling through the floor.
        '  float d = (p.x * uShockDir) + 0.5;',
        '  float wave = exp(-pow((d - uShock) * 7.0, 2.0));',
        '  base += mix(uColorA, uColorB, 1.0 - side) * wave * 1.5 * (1.0 - uShock);',
        // Scene character.
        '  if (uScene > 0.5 && uScene < 1.5) {',
        '    base += uColorA * pow(abs(sin(p.y * 34.0 + uTime * 1.6)), 6.0) * 0.35;',
        '  } else if (uScene > 1.5 && uScene < 2.5) {',
        '    base += mix(uColorA, uColorB, 0.5) * pow(abs(sin(r * 26.0 - uTime * 2.2)), 8.0) * (0.3 + uHype);',
        '  } else if (uScene > 2.5) {',
        '    vec2 g = abs(fract(vUv * 12.0) - 0.5);',
        '    base += vec3(0.2,0.9,0.5) * smoothstep(0.45,0.5,max(g.x,g.y)) * 0.30;',
        '  } else {',
        '    vec2 g = abs(fract(vUv * 20.0) - 0.5);',
        '    base += vec3(0.3,0.9,1.0) * smoothstep(0.47,0.5,max(g.x,g.y)) * 0.28;',
        '  }',
        '  base *= 1.0 + uHype * 0.7 + uPulse * 1.2;',
        '  float a = smoothstep(0.52, 0.30, r);',
        '  gl_FragColor = vec4(base, a);',
        '}',
      ].join('\n'),
    }));
    const floor = new THREE.Mesh(track(new THREE.CircleGeometry(13, 64)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.06;
    group.add(floor);

    const arenaLight = new THREE.PointLight(0xffffff, 24, 46, 1.9);
    arenaLight.position.set(0, 14, 0);
    group.add(arenaLight);

    const rim = new THREE.Mesh(
      track(new THREE.TorusGeometry(13, 0.22, 8, 90)),
      track(new THREE.MeshBasicMaterial({ color: 0x9fc2ff, transparent: true, opacity: 0.55, toneMapped: false })),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.1;
    group.add(rim);

    /* ---- combatant rigs ------------------------------------------------ */
    function makeRig(side) {
      const g = new THREE.Group();
      g.position.set(side === 'a' ? -5.2 : 5.2, 0, 0);
      g.rotation.y = side === 'a' ? Math.PI / 2 : -Math.PI / 2;
      group.add(g);

      const tex = assets.get('');
      const portraitMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0xffffff, 'portrait'), tex);
      const portrait = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), portraitMat);
      portrait.position.y = 2.6;
      portrait.scale.set(4.1, 5.2, 1);
      g.add(portrait);

      const rimMat = assets.cloneMaterialFor(assets.specimenMaterial(tex, 0xffffff, 'rim'), tex);
      const rimMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), rimMat);
      rimMesh.position.set(0, 2.6, -0.2);
      rimMesh.scale.set(4.6, 5.6, 1);
      g.add(rimMesh);

      const pad = new THREE.Mesh(
        track(new THREE.CylinderGeometry(2.5, 2.8, 0.28, 28)),
        track(new THREE.MeshStandardMaterial({ color: 0x101634, roughness: 0.4, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.4 })),
      );
      pad.position.y = 0.14;
      pad.receiveShadow = true;
      g.add(pad);

      // GUARD: a spatial defensive shell that visibly destabilises with fatigue.
      const guardMat = track(new THREE.MeshBasicMaterial({
        color: 0x9df2c1, transparent: true, opacity: 0, wireframe: true, depthWrite: false, toneMapped: false,
      }));
      const guard = new THREE.Mesh(track(new THREE.IcosahedronGeometry(3.3, 1)), guardMat);
      guard.position.y = 2.6;
      guard.visible = false;
      g.add(guard);

      // FLOW: four arc segments that complete a visible circuit.
      const flowSegs = [];
      for (let i = 0; i < 4; i++) {
        const m = track(new THREE.MeshBasicMaterial({ color: 0x42e7ff, transparent: true, opacity: 0.12, toneMapped: false }));
        const seg = new THREE.Mesh(track(new THREE.TorusGeometry(3.0, 0.13, 6, 24, Math.PI / 2.35)), m);
        seg.rotation.x = -Math.PI / 2;
        seg.rotation.z = (i / 4) * Math.PI * 2;
        seg.position.y = 0.45;
        g.add(seg);
        flowSegs.push({ mesh: seg, mat: m });
      }

      // READ: prediction lattice + ghost of the anticipated vector.
      const readMat = track(new THREE.MeshBasicMaterial({ color: 0x42e7ff, transparent: true, opacity: 0, wireframe: true, depthWrite: false, toneMapped: false }));
      const readLattice = new THREE.Mesh(track(new THREE.BoxGeometry(5.4, 6.2, 3.4, 4, 5, 3)), readMat);
      readLattice.position.y = 3.0;
      readLattice.visible = false;
      g.add(readLattice);

      const ghostMat = track(new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      const ghost = new THREE.Mesh(track(new THREE.PlaneGeometry(4.1, 5.2)), ghostMat);
      ghost.position.set(0, 2.6, 1.1);
      ghost.visible = false;
      g.add(ghost);

      // HYPE: a column of energy that fills to 100%.
      const hypeMat = track(new THREE.MeshBasicMaterial({ color: 0xffc14a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const hype = new THREE.Mesh(track(new THREE.CylinderGeometry(2.9, 2.9, 8, 20, 1, true)), hypeMat);
      hype.position.y = 4;
      hype.scale.y = 0.01;
      g.add(hype);

      return {
        group: g, portrait, rimMesh, pad, guard, guardMat, flowSegs,
        readLattice, readMat, ghost, ghostMat, hype, hypeMat,
        tex: null, lunge: 0, hit: 0, guardShow: 0, readShow: 0, flowFlash: 0, sigFlash: 0,
        baseX: g.position.x, color: 0xffffff,
      };
    }

    const rigs = { a: makeRig('a'), b: makeRig('b') };

    /* ---- shared FX pool ------------------------------------------------ */
    const SHARDS = 220;
    const shardGeo = track(new THREE.TetrahedronGeometry(0.26, 0));
    const shardMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shards.frustumCulled = false;
    shards.count = 0;
    group.add(shards);
    const shardState = [];
    for (let i = 0; i < SHARDS; i++) shardState.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1 });
    const dummy = new THREE.Object3D();

    function spawnShards(from, to, color, count, speed, size) {
      let made = 0;
      for (let i = 0; i < SHARDS && made < count; i++) {
        const s = shardState[i];
        if (s.life > 0) continue;
        s.life = s.max = 0.55 + Math.random() * 0.35;
        s.p.copy(from);
        const dir = new THREE.Vector3().subVectors(to, from).normalize();
        s.v.copy(dir).multiplyScalar(speed * (0.7 + Math.random() * 0.6));
        s.v.x += (Math.random() - 0.5) * speed * 0.55;
        s.v.y += (Math.random() - 0.2) * speed * 0.5;
        s.v.z += (Math.random() - 0.5) * speed * 0.55;
        s.s = size * (0.6 + Math.random() * 0.9);
        made++;
      }
      shardMat.color.setHex(color);
    }

    // Shockwave rings (arena pulse, FLOW BREAK, signature).
    const shockRings = [];
    for (let i = 0; i < 6; i++) {
      const m = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
      const r = new THREE.Mesh(track(new THREE.TorusGeometry(1, 0.1, 6, 64)), m);
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.2;
      r.visible = false;
      group.add(r);
      shockRings.push({ mesh: r, mat: m, life: 0, max: 1, scale: 1 });
    }
    function shockwave(color, scale, dur) {
      const r = shockRings.find((x) => x.life <= 0) || shockRings[0];
      r.life = r.max = dur || 0.85;
      r.scale = scale || 1;
      r.mat.color.setHex(color);
      r.mesh.visible = true;
    }

    /* ---- state --------------------------------------------------------- */
    let snap = null;
    let sceneId = 'prism';
    let active = false;
    let mounted = false;
    let reducedMotion = false;
    let quality = C.QUALITY.auto;
    let shock = { t: 1, dir: 1 };
    let cameraHome = null;
    let hypePeak = 0;
    let signatureReadyAnnounced = { a: false, b: false };

    const SCENE_INDEX = { prism: 0, aqua: 1, pride: 2, forest: 3 };

    function setScene(id) {
      sceneId = C.DISTRICT_TO_SCENE[id] && C.SCENE_TO_DISTRICT[id] ? id : (C.SCENE_TO_DISTRICT[id] ? id : sceneId);
      floorMat.uniforms.uScene.value = SCENE_INDEX[sceneId] ?? 0;
      const col = C.DISTRICTS[C.SCENE_TO_DISTRICT[sceneId] || 'prism'].color;
      rim.material.color.setHex(col);
      arenaLight.color.setHex(col);
    }

    function setState(matchSnapshot) {
      snap = matchSnapshot;
      if (!matchSnapshot) return;
      for (const side of ['a', 'b']) {
        const s = matchSnapshot[side];
        const rig = rigs[side];
        rig.color = s.color;
        rig.pad.material.emissive.setHex(s.color);
        rig.hypeMat.color.setHex(s.signatureReady ? 0xffffff : 0xffc14a);
        rig.flowSegs.forEach((f) => f.mat.color.setHex(s.color));
      }
      floorMat.uniforms.uColorA.value.setHex(matchSnapshot.a.color);
      floorMat.uniforms.uColorB.value.setHex(matchSnapshot.b.color);
    }

    function setPortraits(entryA, entryB) {
      for (const [side, e] of [['a', entryA], ['b', entryB]]) {
        if (!e) continue;
        const rig = rigs[side];
        const tex = assets.get(e.img);
        rig.portrait.material.map = tex;
        rig.portrait.material.needsUpdate = true;
        rig.rimMesh.material.uniforms.uMap.value = tex;
        rig.rimMesh.material.uniforms.uTint.value.setHex(C.LINE_COLOR[e.line] || 0x42e7ff);
        rig.tex = tex;
        // Apply true aspect so canonical art is never stretched.
        const img = tex && tex.image;
        if (img && img.width && img.height) {
          const asp = img.width / img.height;
          rig.portrait.scale.set(5.2 * asp, 5.2, 1);
          rig.rimMesh.scale.set(5.2 * asp * 1.12, 5.6, 1);
          rig.ghost.scale.copy(rig.portrait.scale);
        }
      }
    }

    /* ---- event consumption (never recomputation) ------------------------ */
    const TYPE_COLOR = { force: 0xffc14a, style: 0xff4db8, insight: 0x42e7ff, guard: 0x9df2c1, signature: 0xffffff };

    function onEvent(ev) {
      if (!ev || !active) return;
      if (ev.kind === 'arena') {
        shockwave(0xffffff, 1.6, 1.0);
        floorMat.uniforms.uPulse.value = 1;
        if (world.districts[C.SCENE_TO_DISTRICT[sceneId] || 'prism']) {
          const d = world.districts[C.SCENE_TO_DISTRICT[sceneId]];
          if (d.setHype) d.setHype(1);
        }
        return;
      }
      if (ev.kind === 'guard') {
        const rig = rigs[ev.side || 'a'];
        rig.guardShow = 1;
        rig.guard.visible = true;
        shockwave(0x9df2c1, 0.55, 0.6);
        return;
      }
      if (ev.kind === 'win') {
        shockwave(0xffffff, 1.8, 1.3);
        const w = snap && snap.winner;
        if (w === 'a' || w === 'b') {
          const rig = rigs[w];
          spawnShards(new THREE.Vector3(rig.baseX, 3, 0), new THREE.Vector3(rig.baseX, 9, 0), 0xffffff, quality.particles > 400 ? 60 : 24, 6, 1.2);
        }
        return;
      }
      if (ev.kind !== 'damage') return;

      const atk = rigs[ev.side];
      const def = rigs[ev.side === 'a' ? 'b' : 'a'];
      const color = TYPE_COLOR[ev.type] || 0xffffff;
      const special = ev.move === 'signature';
      const from = new THREE.Vector3(atk.baseX, 2.8, 0);
      const to = new THREE.Vector3(def.baseX, 2.8, 0);

      atk.lunge = 1;
      def.hit = special ? 1.4 : 1;

      // FLEX: pressure travels through the floor.
      if (ev.type === 'force') {
        shock = { t: 0, dir: ev.side === 'a' ? 1 : -1 };
      }
      // SERVE: elegant refracted trail + camera accent.
      if (ev.type === 'style') {
        spawnShards(from, to, color, special ? 46 : 22, 15, 0.8);
        shockwave(color, 0.8, 0.7);
      }
      // READ / READ LOCK: anticipation, not just a damage number.
      if (ev.type === 'insight' || ev.predicted) {
        def.readShow = ev.predicted ? 1.6 : 1;
        def.readLattice.visible = true;
        def.ghost.visible = true;
      }
      // FLOW BREAK: the completed circuit discharges.
      if (ev.flowBurst) {
        atk.flowFlash = 1;
        shockwave(atk.color, 1.25, 0.9);
        spawnShards(new THREE.Vector3(atk.baseX, 0.5, 0), new THREE.Vector3(atk.baseX, 8, 0), 0x42e7ff, 34, 9, 1.0);
      }
      // SIGNATURE: noticeably stronger, but bounded so frames survive.
      if (special) {
        atk.sigFlash = 1;
        shockwave(0xffffff, 1.5, 1.0);
        spawnShards(from, to, 0xffffff, quality.particles > 400 ? 70 : 30, 20, 1.3);
        floorMat.uniforms.uPulse.value = 1.2;
      } else {
        spawnShards(from, to, color, quality.particles > 400 ? 26 : 12, 13, 0.75);
      }
    }

    /* ---- lifecycle ----------------------------------------------------- */
    function mount() {
      if (mounted) return;
      mounted = true;
      const d = C.DISTRICTS[C.SCENE_TO_DISTRICT[sceneId] || 'prism'];
      group.position.set(d.center[0], 0, d.center[1]);
      group.visible = true;
      if (world.districts.pride) world.districts.pride.setCrowdCount(quality.crowd);
    }

    function enter(opts2 = {}) {
      mount();
      active = true;
      if (opts2.entryA && opts2.entryB) setPortraits(opts2.entryA, opts2.entryB);
      hypePeak = 0;
      signatureReadyAnnounced = { a: false, b: false };
      group.visible = true;
      shockwave(0xffffff, 1.2, 0.8);
    }

    function exit() {
      active = false;
      group.visible = false;
      for (const r of shockRings) { r.life = 0; r.mesh.visible = false; }
      for (const s of shardState) s.life = 0;
      shards.count = 0;
      for (const rig of Object.values(rigs)) {
        rig.guardShow = rig.readShow = rig.lunge = rig.hit = rig.flowFlash = rig.sigFlash = 0;
        rig.guard.visible = false;
        rig.readLattice.visible = false;
        rig.ghost.visible = false;
        rig.group.position.x = rig.baseX;
      }
    }

    function setQualityMode(mode) {
      quality = C.QUALITY[mode] || C.QUALITY.auto;
    }
    function setMotion(reduced) { reducedMotion = !!reduced; }

    /** Soft global pulse used by the existing app.js call sites. */
    function pulse(hex, strength) {
      let c = 0xffffff;
      if (typeof hex === 'string' && hex[0] === '#') c = parseInt(hex.slice(1), 16) || 0xffffff;
      shockwave(c, 0.9 + (strength || 0.5) * 0.5, 0.7);
      floorMat.uniforms.uPulse.value = Math.max(floorMat.uniforms.uPulse.value, (strength || 0.5) * 0.8);
    }

    /* ---- per-frame ----------------------------------------------------- */
    function update(dt, t, anim) {
      if (!active || !snap) return;
      const animScale = reducedMotion ? 0.25 : anim;

      floorMat.uniforms.uTime.value = t;
      floorMat.uniforms.uPulse.value = Math.max(0, floorMat.uniforms.uPulse.value - dt * 2.4);

      if (shock.t < 1) {
        shock.t = Math.min(1, shock.t + dt * 2.4);
        floorMat.uniforms.uShock.value = shock.t;
        floorMat.uniforms.uShockDir.value = shock.dir;
      } else {
        floorMat.uniforms.uShock.value = 1;
      }

      let maxHype = 0;
      for (const side of ['a', 'b']) {
        const s = snap[side];
        const rig = rigs[side];
        const hypeN = clamp(s.hype / 100, 0, 1);
        maxHype = Math.max(maxHype, hypeN);

        // HYPE column + environment response.
        rig.hype.scale.y = damp(rig.hype.scale.y, 0.02 + hypeN * 1, 5, dt);
        rig.hypeMat.opacity = 0.12 + hypeN * 0.5;
        rig.hype.rotation.y += dt * (0.6 + hypeN * 2.4) * animScale;

        // 100% Hype must clearly read as SIGNATURE READY.
        if (s.signatureReady) {
          rig.hypeMat.color.setHex(0xffffff);
          rig.hypeMat.opacity = 0.55 + Math.sin(t * 9) * 0.25 * animScale;
          rig.rimMesh.material.uniforms.uEnergy.value = 2.2 + Math.sin(t * 7) * 0.6;
        } else {
          rig.hypeMat.color.setHex(0xffc14a);
          rig.rimMesh.material.uniforms.uEnergy.value = 0.6 + hypeN * 0.9;
        }

        // FLOW circuit segments complete as combo builds.
        rig.flowSegs.forEach((f, i) => {
          const on = s.combo > i ? 1 : 0;
          f.mat.opacity = damp(f.mat.opacity, 0.10 + on * 0.85 + rig.flowFlash * 0.6, 8, dt);
          f.mesh.rotation.z += dt * (0.2 + on * 0.9) * animScale;
          f.mesh.scale.setScalar(1 + on * 0.04 + rig.flowFlash * 0.12);
        });
        rig.flowFlash = Math.max(0, rig.flowFlash - dt * 2.2);

        // GUARD field, destabilising with fatigue.
        const fatigue = s.guardFatigue || 0;
        const wantGuard = rig.guardShow > 0 || (s.lastMove === 'guard');
        rig.guardShow = Math.max(0, rig.guardShow - dt * 1.1);
        if (wantGuard || rig.guardShow > 0) {
          rig.guard.visible = true;
          const instab = fatigue * 0.22;
          rig.guardMat.opacity = damp(rig.guardMat.opacity, 0.20 + rig.guardShow * 0.45 - fatigue * 0.05, 7, dt);
          rig.guardMat.color.setHex(fatigue >= 2 ? 0xff9d6c : 0x9df2c1);
          rig.guard.rotation.y += dt * (0.7 + fatigue * 1.4) * animScale;
          rig.guard.rotation.x = Math.sin(t * (3 + fatigue * 4)) * instab * animScale;
          rig.guard.scale.setScalar(1 + Math.sin(t * (4 + fatigue * 5)) * instab * 0.5 * animScale);
        } else {
          rig.guard.visible = false;
          rig.guardMat.opacity = damp(rig.guardMat.opacity, 0, 6, dt);
        }

        // READ / READ LOCK anticipation.
        rig.readShow = Math.max(0, rig.readShow - dt * 1.4);
        if (rig.readShow > 0) {
          rig.readLattice.visible = true;
          rig.ghost.visible = true;
          rig.readMat.opacity = 0.18 + rig.readShow * 0.3;
          rig.readLattice.rotation.y += dt * 1.1 * animScale;
          rig.ghostMat.opacity = 0.10 + rig.readShow * 0.16;
          rig.ghost.position.z = 1.1 + Math.sin(t * 3) * 0.25 * animScale;
        } else {
          rig.readLattice.visible = false;
          rig.ghost.visible = false;
        }

        // Lunge / hit response.
        rig.lunge = Math.max(0, rig.lunge - dt * 3.2);
        rig.hit = Math.max(0, rig.hit - dt * 3.0);
        const dirSign = side === 'a' ? 1 : -1;
        rig.group.position.x = rig.baseX + dirSign * rig.lunge * 1.5 - dirSign * rig.hit * 0.55;
        rig.group.position.y = Math.abs(Math.sin(rig.hit * Math.PI)) * 0.22 * animScale;
        rig.portrait.position.x = rig.hit > 0 ? Math.sin(t * 42) * rig.hit * 0.14 * animScale : 0;
        rig.rimMesh.position.x = rig.portrait.position.x;
        rig.rimMesh.material.uniforms.uTime.value = t;
        rig.sigFlash = Math.max(0, rig.sigFlash - dt * 1.6);

        // Low-HP danger tint.
        const danger = s.hpRatio < 0.28 ? 1 : 0;
        rig.pad.material.emissiveIntensity = 0.35 + hypeN * 0.5 + danger * (0.4 + Math.sin(t * 6) * 0.3 * animScale);
      }

      // Environment reacts to Hype (Pride crowd, floor, light).
      floorMat.uniforms.uHype.value = damp(floorMat.uniforms.uHype.value, maxHype, 3, dt);
      arenaLight.intensity = 18 + maxHype * 30;
      const pride = world.districts.pride;
      if (pride && pride.setHype) pride.setHype(maxHype);
      const aqua = world.districts.aqua;
      if (aqua && aqua.setFlow) aqua.setFlow(clamp(Math.max(snap.a.combo, snap.b.combo) / 4, 0, 1));
      const emerald = world.districts.emerald;
      if (emerald && emerald.setRecovery) {
        emerald.setRecovery(clamp(1 - Math.min(snap.a.hpRatio, snap.b.hpRatio), 0, 1));
      }

      // Shard integration.
      let live = 0;
      for (let i = 0; i < SHARDS; i++) {
        const s = shardState[i];
        if (s.life <= 0) continue;
        s.life -= dt;
        s.v.y -= dt * 12;
        s.p.addScaledVector(s.v, dt);
        dummy.position.copy(s.p);
        dummy.rotation.set(t * 4 + i, t * 3 + i * 0.7, 0);
        dummy.scale.setScalar(Math.max(0.01, s.s * (s.life / s.max)));
        dummy.updateMatrix();
        shards.setMatrixAt(live++, dummy.matrix);
      }
      shards.count = live;
      if (live) shards.instanceMatrix.needsUpdate = true;

      // Shock rings.
      for (const r of shockRings) {
        if (r.life <= 0) continue;
        r.life -= dt;
        const k = 1 - r.life / r.max;
        r.mesh.scale.setScalar(0.4 + k * 12 * r.scale);
        r.mat.opacity = Math.max(0, (1 - k) * 0.85);
        if (r.life <= 0) { r.mesh.visible = false; r.mat.opacity = 0; }
      }

      hypePeak = Math.max(hypePeak, maxHype);
    }

    function dispose() {
      exit();
      for (const d of disposables) { try { d.dispose(); } catch { /* gone */ } }
      disposables.length = 0;
      if (group.parent) group.parent.remove(group);
      group.clear();
    }

    return {
      THREE, group, rigs,
      setScene, setState, setPortraits, onEvent, update,
      mount, enter, exit, pulse, setQualityMode, setMotion, dispose,
      get active() { return active; },
      get hypePeak() { return hypePeak; },
      get sceneId() { return sceneId; },
      get liveShards() { return shards.count; },
    };
  }

  C.createBattleLayer = createBattleLayer;
})(window.GayDexCircuit);
