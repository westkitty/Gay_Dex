/* ---------------------------------------------------------------------------
 * GayDex: Circuit — world geography.
 *
 * Lane: threejs-project-engineer (scene construction) +
 *       threejs-asset-pipeline (procedural geometry, no downloaded assets).
 *
 * Everything here is authored procedural geometry: no external models, no
 * texture downloads.  Repeated elements (crowd, trees, pylons, lattice struts,
 * holo motes) use InstancedMesh so the draw-call count stays flat while the
 * world still looks populated.
 *
 * Evolution is geography: each main lineage is a physical route through its
 * district, variants are side spurs that visibly branch off, Mega forms sit
 * behind a heavier gate, and the Independent forms are deliberately NOT a
 * ladder — they are a scattered pavilion, because they have no evolution line.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, lerp, damp, hash01, TAU } = C.util;

  /** Route anchors, in local district coordinates (before district offset). */
  const ROUTES = {
    Twink: {
      district: 'prism',
      // Starter -> Stage II -> Stage III -> Mega, with a visible branch.
      main: [[-19, -4], [-7.5, -7], [4.5, -5], [17, -2]],
      branch: { at: 0, to: [-2, 13] }, // Elder Twink forks off the Starter
      shape: 'lattice',
    },
    Otter: {
      district: 'aqua',
      main: [[-6, -19], [-9, -7], [-5, 5], [1, 18]],
      branch: { at: 1, to: [13, -1] }, // Silver Otter forks off Stage II
      shape: 'tidelane',
    },
    Cub: {
      district: 'emerald',
      main: [[-18, 5], [-6, 8], [6, 5], [18, 1]],
      branch: { at: 2, to: [3, -14] }, // Polar Bear forks off Stage III
      shape: 'relaypath',
    },
    Independent: {
      district: 'pride',
      // Explicitly not a ladder: four independent pads in a loose scatter.
      scatter: [[-13, -9], [11, -12], [-9, 12], [13, 9]],
      shape: 'pavilion',
    },
  };

  function createWorld(THREE, opts = {}) {
    const assets = opts.assets;
    const root = new THREE.Group();
    root.name = 'circuit-world';

    const disposables = [];
    const track = (x) => { disposables.push(x); return x; };
    const updaters = [];
    function addUpdater(scope, fn) { updaters.push({ scope, fn }); }

    /* ==================================================================== *
     * FOUNDATION — ground, sky, light, nexus, spokes
     * ==================================================================== */

    const groundMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRipple: { value: 0 },
        uRippleAt: { value: new THREE.Vector2(0, 0) },
        uDistrict: { value: new THREE.Vector3(0, 0, 0) },
        uDistrictColor: { value: new THREE.Color(0x42e7ff) },
        uPulse: { value: 0 },
      },
      vertexShader: [
        'varying vec2 vXZ;',
        'void main(){',
        '  vec4 wp = modelMatrix * vec4(position,1.0);',
        '  vXZ = wp.xz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vXZ;',
        'uniform float uTime; uniform float uRipple; uniform vec2 uRippleAt;',
        'uniform vec3 uDistrict; uniform vec3 uDistrictColor; uniform float uPulse;',
        // Cheap value noise for floor variation.
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
        'float vnoise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p);',
        '  f = f*f*(3.0-2.0*f);',
        '  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);',
        '}',
        'void main(){',
        '  float d = length(vXZ);',
        '  // Authoritative grid: fine near the player, coarser far out.',
        '  vec2 g = abs(fract(vXZ * 0.25) - 0.5);',
        '  float line = smoothstep(0.47, 0.5, max(g.x, g.y));',
        '  vec2 g2 = abs(fract(vXZ * 0.0625) - 0.5);',
        '  float line2 = smoothstep(0.485, 0.5, max(g2.x, g2.y));',
        '  float near = exp(-d * 0.012);',
        '  vec3 base = vec3(0.016, 0.020, 0.045);',
        '  base += vec3(0.10,0.16,0.34) * line * (0.10 + 0.55 * near);',
        '  base += uDistrictColor * line2 * 0.30;',
        '  base += vec3(0.02,0.03,0.07) * vnoise(vXZ * 0.09);',
        '  // District halo around the active centre.',
        '  float dh = length(vXZ - uDistrict);',
        '  base += uDistrictColor * 0.10 * exp(-dh * 0.035);',
        '  // Battle / scan ripple travelling outward.',
        '  float rd = abs(length(vXZ - uRippleAt) - uRipple * 46.0);',
        '  base += uDistrictColor * 0.55 * exp(-rd * 0.10) * (1.0 - smoothstep(0.0, 1.0, uRipple));',
        '  base *= 1.0 + uPulse * 0.5;',
        '  base *= smoothstep(135.0, 40.0, d) * 0.9 + 0.10;',
        '  gl_FragColor = vec4(base, 1.0);',
        '}',
      ].join('\n'),
    }));
    const groundGeo = track(new THREE.CircleGeometry(132, 96));
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    root.add(ground);

    // Sky dome + starfield.
    const skyGeo = track(new THREE.SphereGeometry(300, 32, 20));
    const skyMat = track(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color(0x05060f) }, uBottom: { value: new THREE.Color(0x141a3c) }, uAccent: { value: new THREE.Color(0x2a1f4d) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'precision mediump float; varying vec3 vP;',
        'uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uAccent;',
        'void main(){',
        '  float h = clamp(vP.y / 300.0 * 0.5 + 0.5, 0.0, 1.0);',
        '  vec3 c = mix(uBottom, uTop, smoothstep(0.35, 0.95, h));',
        '  c += uAccent * pow(1.0 - abs(h - 0.5) * 2.0, 3.0) * 0.7;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    }));
    root.add(new THREE.Mesh(skyGeo, skyMat));

    const starGeo = track(new THREE.BufferGeometry());
    {
      const N = 900;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const u = hash01(i * 3.1) * TAU;
        const v = 0.08 + hash01(i * 7.7) * 0.86;
        const r = 250 + hash01(i * 11.3) * 40;
        pos[i * 3] = Math.cos(u) * Math.sin(v * Math.PI) * r;
        pos[i * 3 + 1] = Math.cos(v * Math.PI) * r * 0.7 + 40;
        pos[i * 3 + 2] = Math.sin(u) * Math.sin(v * Math.PI) * r;
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    }
    const starMat = track(new THREE.PointsMaterial({ color: 0xa9c4ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false }));
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    root.add(stars);

    // Lighting: one hemisphere for base, one shadow-casting key, and four
    // district accents. Cheap, and it reads as "authored".
    const hemi = new THREE.HemisphereLight(0x9fb6ff, 0x0a0c1c, 0.62);
    root.add(hemi);
    const key = new THREE.DirectionalLight(0xdfe8ff, 0.85);
    key.position.set(28, 62, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 190;
    key.shadow.camera.left = -70; key.shadow.camera.right = 70;
    key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
    key.shadow.bias = -0.0016;
    root.add(key);
    root.add(key.target);

    /* ---- Nexus ---------------------------------------------------------- */
    const nexus = new THREE.Group();
    nexus.position.set(0, 0, 0);
    root.add(nexus);
    {
      const ringGeo = track(new THREE.TorusGeometry(15.5, 0.34, 10, 96));
      const ringMat = track(new THREE.MeshBasicMaterial({ color: 0x9fc2ff, transparent: true, opacity: 0.75, toneMapped: false }));
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      nexus.add(ring);

      const discGeo = track(new THREE.CircleGeometry(15.5, 64));
      const discMat = track(new THREE.MeshStandardMaterial({ color: 0x0d1230, roughness: 0.55, metalness: 0.35, emissive: 0x0b1436, emissiveIntensity: 0.6 }));
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.03;
      disc.receiveShadow = true;
      nexus.add(disc);

      // Gateway arches: one per district, clickable warps.
      const archGeo = track(new THREE.TorusGeometry(4.6, 0.3, 8, 40, Math.PI));
      const gateways = [];
      ['prism', 'aqua', 'pride', 'emerald'].forEach((id, i) => {
        const d = C.DISTRICTS[id];
        const ang = Math.atan2(d.center[0] - 0, d.center[1] - 0);
        const gx = Math.sin(ang) * 15.5, gz = Math.cos(ang) * 15.5;
        const mat = track(new THREE.MeshStandardMaterial({
          color: d.color, emissive: d.color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.92,
        }));
        const arch = new THREE.Mesh(archGeo, mat);
        arch.position.set(gx, 0, gz);
        arch.rotation.y = -ang;
        arch.castShadow = true;
        arch.userData = { kind: 'gateway', district: id, hitRadius: 4.2 };
        nexus.add(arch);

        // Generous invisible hit region — no pixel hunting.
        // Rotated a half-segment off the world axes: the spokes run exactly
        // along ±X/±Z, and an unrotated 12-segment cylinder has a triangle seam
        // sitting precisely in those planes, which a straight-on ray can slip
        // through without registering a triangle hit.
        const hit = new THREE.Mesh(track(new THREE.CylinderGeometry(4.2, 4.2, 6, 12)), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(gx, 3, gz);
        hit.rotation.y = Math.PI / 12;
        hit.userData = { kind: 'gateway', district: id, label: d.name, ref: arch };
        nexus.add(hit);

        if (assets) {
          const tex = assets.label('gw-' + id, d.short, { color: '#eaf2ff', sub: d.name, size: 72, box: true, boxColor: 'rgba(6,10,26,0.78)' });
          if (tex) {
            const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
            const asp = tex.userData.aspect || 4;
            s.scale.set(asp * 2.5, 2.5, 1);
            s.position.set(gx, 6.4, gz);
            nexus.add(s);
          }
        }
        gateways.push({ id, arch, mat, angle: ang });
      });

      // Central pylon: the route relay.
      const pylon = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.55, 1.5, 9, 8, 1, true)),
        track(new THREE.MeshStandardMaterial({ color: 0x1b2350, emissive: 0x4f7dff, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.8, transparent: true, opacity: 0.9, side: THREE.DoubleSide })),
      );
      pylon.position.y = 4.5;
      nexus.add(pylon);

      const orb = new THREE.Mesh(track(new THREE.IcosahedronGeometry(1.5, 1)), track(new THREE.MeshBasicMaterial({ color: 0xbfe0ff, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false })));
      orb.position.y = 10.6;
      nexus.add(orb);

      addUpdater('nexus', (dt, t, anim) => {
        orb.rotation.y += dt * 0.35 * anim;
        orb.rotation.x += dt * 0.17 * anim;
        pylon.rotation.y -= dt * 0.12 * anim;
        for (const g of gateways) {
          const focus = g.id === activeDistrict ? focusPulse : 0;
          g.mat.emissiveIntensity = 0.65 + Math.sin(t * 1.6 + g.angle * 2) * 0.28 * anim + focus * 2.6;
          const scale = 1 + focus * 0.12;
          g.arch.scale.setScalar(scale);
        }
      });
      nexus.userData.gateways = gateways;
    }

    // Spokes: emissive tubes from the nexus out to each district centre.
    {
      const spokeMat = track(new THREE.MeshBasicMaterial({ color: 0x6f8dff, transparent: true, opacity: 0.30, toneMapped: false }));
      for (const id of ['prism', 'aqua', 'pride', 'emerald']) {
        const d = C.DISTRICTS[id];
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.1, 0),
          new THREE.Vector3(d.center[0] * 0.5, 0.1, d.center[1] * 0.5),
          new THREE.Vector3(d.center[0] * 0.86, 0.1, d.center[1] * 0.86),
        ]);
        const geo = track(new THREE.TubeGeometry(curve, 24, 0.55, 6, false));
        const m = new THREE.Mesh(geo, spokeMat);
        root.add(m);
      }
    }

    /* ==================================================================== *
     * DISTRICTS
     * ==================================================================== */
    const districts = {};

    function districtGroup(id) {
      const g = new THREE.Group();
      const d = C.DISTRICTS[id];
      g.position.set(d.center[0], 0, d.center[1]);
      g.name = 'district-' + id;
      root.add(g);
      return g;
    }

    function pointLight(color, intensity, distance, y) {
      const l = new THREE.PointLight(color, intensity, distance, 1.8);
      l.position.set(0, y, 0);
      return l;
    }

    /* ---- PRISM DOME ----------------------------------------------------
     * Refracted geometry, luminous lattice, holographic evolutionary paths,
     * cyan/magenta spectral energy. Hosts the Twink route + Evolution Lab. */
    districts.prism = (function buildPrism() {
      const g = districtGroup('prism');
      const col = C.DISTRICTS.prism.color;
      const accent = 0xff4db8;

      g.add(pointLight(col, 22, 62, 13));
      const accentLight = pointLight(accent, 10, 44, 6);
      accentLight.position.set(-14, 6, 10);
      g.add(accentLight);

      // Geodesic lattice dome.
      const domeGeo = track(new THREE.IcosahedronGeometry(31, 2));
      const domeMat = track(new THREE.MeshBasicMaterial({ color: 0x63d8ff, wireframe: true, transparent: true, opacity: 0.20, toneMapped: false }));
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.y = 0;
      g.add(dome);

      // Inner refracting shell.
      const shell = new THREE.Mesh(
        track(new THREE.IcosahedronGeometry(24, 1)),
        track(new THREE.MeshPhysicalMaterial({
          color: 0x9fe9ff, transparent: true, opacity: 0.075, roughness: 0.05, metalness: 0,
          side: THREE.BackSide, depthWrite: false, transmission: 0, iridescence: 1, iridescenceIOR: 1.6,
        })),
      );
      g.add(shell);

      // Floor: hex-ish emissive plate.
      const plate = new THREE.Mesh(
        track(new THREE.CircleGeometry(30, 6)),
        track(new THREE.MeshStandardMaterial({ color: 0x0a1030, roughness: 0.35, metalness: 0.55, emissive: 0x0b2a44, emissiveIntensity: 0.55, transparent: true, opacity: 0.96 })),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.05;
      plate.receiveShadow = true;
      g.add(plate);

      const plateRing = new THREE.Mesh(track(new THREE.TorusGeometry(30, 0.22, 8, 80)), track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, toneMapped: false })));
      plateRing.rotation.x = -Math.PI / 2;
      plateRing.position.y = 0.08;
      g.add(plateRing);

      // Holographic motes (instanced).
      const motes = makeMotes(g, col, 220, 28, 16);

      // Scanning console: the spatial Evolution Lab machine.
      const lab = buildLabConsole(THREE, track, col, assets);
      lab.group.position.set(-20, 0, 16);
      lab.group.rotation.y = 0.6;
      g.add(lab.group);

      addUpdater('prism', (dt, t, anim, q) => {
        dome.rotation.y += dt * 0.028 * anim;
        shell.rotation.y -= dt * 0.045 * anim;
        domeMat.opacity = 0.15 + Math.sin(t * 0.8) * 0.05 * anim;
        accentLight.intensity = 8 + Math.sin(t * 1.3) * 3 * anim;
        motes.update(dt, t, anim, q);
        lab.update(dt, t, anim);
      });

      return { group: g, dome, shell, lab, motes, color: col };
    })();

    /* ---- AQUA PULSE BAY ------------------------------------------------
     * Translucent surfaces, reflective water-like floor, moving light, wave
     * propagation, visible Flow chains. Hosts the Otter route. */
    districts.aqua = (function buildAqua() {
      const g = districtGroup('aqua');
      const col = C.DISTRICTS.aqua.color;
      g.add(pointLight(col, 20, 60, 12));

      const water = new THREE.Mesh(
        track(new THREE.PlaneGeometry(60, 60, 72, 72)),
        track(new THREE.ShaderMaterial({
          transparent: true,
          uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(col) },
            uDeep: { value: new THREE.Color(0x04122c) },
            uFlow: { value: 0 },
            uAnim: { value: 1 },
          },
          vertexShader: [
            'uniform float uTime; uniform float uAnim;',
            'varying vec2 vUv; varying float vWave;',
            'void main(){',
            '  vUv = uv;',
            '  vec3 p = position;',
            '  float w = sin(p.x * 0.42 + uTime * 1.25) * 0.42 + sin(p.y * 0.31 - uTime * 0.95) * 0.36',
            '          + sin((p.x + p.y) * 0.19 + uTime * 0.6) * 0.30;',
            '  p.z += w * 0.55 * uAnim;',
            '  vWave = w;',
            '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
            '}',
          ].join('\n'),
          fragmentShader: [
            'precision highp float;',
            'varying vec2 vUv; varying float vWave;',
            'uniform vec3 uColor; uniform vec3 uDeep; uniform float uTime; uniform float uFlow;',
            'void main(){',
            '  vec2 g = abs(fract(vUv * 26.0) - 0.5);',
            '  float lane = smoothstep(0.44, 0.5, max(g.x, g.y));',
            '  float caustic = pow(abs(sin(vUv.x * 22.0 + uTime * 0.8) * sin(vUv.y * 19.0 - uTime * 0.6)), 3.0);',
            '  vec3 c = mix(uDeep, uColor, 0.28 + vWave * 0.22);',
            '  c += uColor * lane * 0.35;',
            '  c += uColor * caustic * 0.55;',
            // Flow chains: concentric bands that complete as Flow builds.
            '  float bands = sin(length(vUv - 0.5) * 78.0 - uTime * 2.4 - uFlow * 6.28);',
            '  c += uColor * smoothstep(0.72, 1.0, bands) * (0.20 + uFlow * 0.75);',
            '  float a = 0.82 - smoothstep(0.30, 0.52, length(vUv - 0.5)) * 0.55;',
            '  gl_FragColor = vec4(c, a);',
            '}',
          ].join('\n'),
        })),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.12;
      g.add(water);

      // Translucent pillars.
      const pillarGeo = track(new THREE.CylinderGeometry(0.7, 1.1, 12, 8, 1, true));
      const pillarMat = track(new THREE.MeshPhysicalMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const r = 24 + hash01(i * 5.3) * 5;
        const p = new THREE.Mesh(pillarGeo, pillarMat);
        p.position.set(Math.cos(a) * r, 6, Math.sin(a) * r);
        p.scale.y = 0.7 + hash01(i * 9.1) * 0.7;
        g.add(p);
      }

      const motes = makeMotes(g, 0x8fe6ff, 150, 26, 10);

      addUpdater('aqua', (dt, t, anim, q) => {
        water.material.uniforms.uTime.value = t;
        water.material.uniforms.uAnim.value = anim;
        motes.update(dt, t, anim, q);
      });

      return { group: g, water, motes, color: col, setFlow(v) { water.material.uniforms.uFlow.value = clamp(v, 0, 1); } };
    })();

    /* ---- PRIDE CIRCUIT -------------------------------------------------
     * Reactive architecture, luminous crowd abstraction, arena lighting,
     * escalating response to Hype. Hosts the Independent pavilion. */
    districts.pride = (function buildPride() {
      const g = districtGroup('pride');
      const col = C.DISTRICTS.pride.color;
      const arenaLight = pointLight(col, 26, 66, 16);
      g.add(arenaLight);

      // Bowl: a lathe profile, so the tiering is real geometry.
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector2(13 + t * 16, t * t * 9.5));
      }
      const bowl = new THREE.Mesh(
        track(new THREE.LatheGeometry(pts, 56)),
        track(new THREE.MeshStandardMaterial({ color: 0x150c2a, roughness: 0.75, metalness: 0.25, side: THREE.DoubleSide, emissive: 0x2a0d33, emissiveIntensity: 0.5 })),
      );
      bowl.receiveShadow = true;
      g.add(bowl);

      const floor = new THREE.Mesh(
        track(new THREE.CircleGeometry(13.4, 48)),
        track(new THREE.MeshStandardMaterial({ color: 0x12081f, roughness: 0.3, metalness: 0.7, emissive: col, emissiveIntensity: 0.22 })),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.06;
      floor.receiveShadow = true;
      g.add(floor);

      // Hype rings: emissive, escalate with Hype.
      const rings = [];
      for (let i = 0; i < 5; i++) {
        const r = 15 + i * 3.2;
        const m = track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, toneMapped: false }));
        const ring = new THREE.Mesh(track(new THREE.TorusGeometry(r, 0.16, 6, 90)), m);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.5 + i * 1.6;
        g.add(ring);
        rings.push({ mesh: ring, mat: m, base: r, i });
      }

      // Crowd abstraction: one InstancedMesh, bounded by quality tier.
      const crowdGeo = track(new THREE.BoxGeometry(0.62, 1.5, 0.62));
      const crowdMat = track(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, emissiveIntensity: 0.5 }));
      const CROWD_MAX = 520;
      const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD_MAX);
      crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crowd.frustumCulled = false;
      g.add(crowd);
      const crowdColors = new Float32Array(CROWD_MAX * 3);
      const crowdSeeds = new Float32Array(CROWD_MAX);
      const crowdPos = new Float32Array(CROWD_MAX * 3);
      const PALETTE = [0xff4db8, 0xffc14a, 0x57e38c, 0x42e7ff, 0x7a82ff, 0xff8a5c];
      {
        const c = new THREE.Color();
        for (let i = 0; i < CROWD_MAX; i++) {
          const tier = Math.floor(i / 60) % 5;
          const a = hash01(i * 2.7) * TAU;
          const r = 14.5 + tier * 3.2 + hash01(i * 4.1) * 1.2;
          const y = (tier / 5) * (tier / 5) * 9.5 + 0.9;
          crowdPos[i * 3] = Math.cos(a) * r;
          crowdPos[i * 3 + 1] = y;
          crowdPos[i * 3 + 2] = Math.sin(a) * r;
          crowdSeeds[i] = hash01(i * 8.9);
          c.setHex(PALETTE[i % PALETTE.length]);
          crowdColors[i * 3] = c.r; crowdColors[i * 3 + 1] = c.g; crowdColors[i * 3 + 2] = c.b;
        }
        crowd.instanceColor = new THREE.InstancedBufferAttribute(crowdColors, 3);
      }
      let crowdActive = 0;
      const dummy = new THREE.Object3D();

      function layoutCrowd(count, t, anim, hype) {
        const n = Math.min(CROWD_MAX, count | 0);
        for (let i = 0; i < n; i++) {
          const s = crowdSeeds[i];
          const bounce = hype > 0.02 ? Math.abs(Math.sin(t * (2.2 + s * 2.4) + s * 9)) * (0.35 + hype * 1.5) * anim : 0;
          dummy.position.set(crowdPos[i * 3], crowdPos[i * 3 + 1] + bounce, crowdPos[i * 3 + 2]);
          const sc = 0.85 + s * 0.35 + hype * 0.12;
          dummy.scale.set(sc, sc * (1 + bounce * 0.12), sc);
          dummy.rotation.y = s * TAU;
          dummy.updateMatrix();
          crowd.setMatrixAt(i, dummy.matrix);
        }
        crowd.count = n;
        crowd.instanceMatrix.needsUpdate = true;
        crowdActive = n;
      }
      layoutCrowd(260, 0, 1, 0);

      // Stage light cones.
      const cones = [];
      const coneGeo = track(new THREE.ConeGeometry(3.4, 16, 14, 1, true));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const m = track(new THREE.MeshBasicMaterial({ color: PALETTE[i % PALETTE.length], transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        const cone = new THREE.Mesh(coneGeo, m);
        cone.position.set(Math.cos(a) * 12, 8.5, Math.sin(a) * 12);
        cone.rotation.z = Math.cos(a) * 0.35;
        cone.rotation.x = -Math.sin(a) * 0.35;
        g.add(cone);
        cones.push({ mesh: cone, mat: m, a });
      }

      let hype = 0;
      let crowdAccum = 0;
      addUpdater('pride', (dt, t, anim, q) => {
        arenaLight.intensity = 18 + hype * 34 + Math.sin(t * 2.1) * 2 * anim;
        arenaLight.color.setHex(hype > 0.99 ? 0xffffff : col);
        for (const r of rings) {
          const on = clamp(hype * 5 - r.i, 0, 1);
          r.mat.opacity = 0.12 + on * 0.75;
          r.mesh.scale.setScalar(1 + Math.sin(t * (1.2 + r.i * 0.3)) * 0.012 * anim + on * 0.03);
          r.mesh.rotation.z += dt * (0.05 + r.i * 0.02) * anim;
        }
        for (const c of cones) {
          c.mat.opacity = 0.05 + hype * 0.14 + Math.sin(t * 1.7 + c.a * 3) * 0.02 * anim;
          c.mesh.rotation.y = Math.sin(t * 0.5 + c.a) * 0.25 * anim;
        }
        floor.material.emissiveIntensity = 0.18 + hype * 0.7;
        crowdAccum += dt;
        const crowdStep = q.crowd <= 90 ? 1 / 12 : 1 / 30;
        if (crowdAccum >= crowdStep) {
          layoutCrowd(q.crowd, t, anim, hype);
          crowdAccum = 0;
        }
      });

      return {
        group: g, crowd, rings, cones, arenaLight, color: col,
        setCrowdCount(n) { layoutCrowd(n, 0, 1, hype); },
        setHype(v) { hype = clamp(v, 0, 1); },
        get hype() { return hype; },
        get crowdActive() { return crowdActive; },
      };
    })();

    /* ---- EMERALD RELAY -------------------------------------------------
     * Garden/brutalist hybrid: paths, stone and concrete forms, vegetation,
     * green relay energy, visibly grounded geometry. Hosts the Cub route. */
    districts.emerald = (function buildEmerald() {
      const g = districtGroup('emerald');
      const col = C.DISTRICTS.emerald.color;
      g.add(pointLight(col, 18, 58, 12));
      const warm = pointLight(0xffd9a0, 8, 40, 7);
      warm.position.set(10, 7, -8);
      g.add(warm);

      // Ground plate: matte, grounded.
      const plate = new THREE.Mesh(
        track(new THREE.CircleGeometry(30, 48)),
        track(new THREE.MeshStandardMaterial({ color: 0x0d1a14, roughness: 0.92, metalness: 0.05, emissive: 0x08210f, emissiveIntensity: 0.35 })),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.04;
      plate.receiveShadow = true;
      g.add(plate);

      // Brutalist concrete forms (instanced).
      const blockGeo = track(new THREE.BoxGeometry(1, 1, 1));
      const blockMat = track(new THREE.MeshStandardMaterial({ color: 0x6d7180, roughness: 0.95, metalness: 0.02 }));
      const BLOCKS = 46;
      const blocks = new THREE.InstancedMesh(blockGeo, blockMat, BLOCKS);
      blocks.castShadow = true;
      blocks.receiveShadow = true;
      {
        const d = new THREE.Object3D();
        for (let i = 0; i < BLOCKS; i++) {
          const a = hash01(i * 3.3) * TAU;
          const r = 12 + hash01(i * 6.1) * 17;
          const h = 1.6 + hash01(i * 1.7) * 8.5;
          d.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
          d.rotation.y = hash01(i * 2.2) * TAU;
          d.scale.set(1.6 + hash01(i * 4.4) * 3.2, h, 1.6 + hash01(i * 5.5) * 3.2);
          d.updateMatrix();
          blocks.setMatrixAt(i, d.matrix);
        }
        blocks.instanceMatrix.needsUpdate = true;
      }
      g.add(blocks);

      // Winding relay path.
      const pathCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-26, 0.12, 8), new THREE.Vector3(-12, 0.12, 12),
        new THREE.Vector3(0, 0.12, 4), new THREE.Vector3(12, 0.12, 9),
        new THREE.Vector3(24, 0.12, 2),
      ]);
      const path = new THREE.Mesh(
        track(new THREE.TubeGeometry(pathCurve, 64, 1.5, 8, false)),
        track(new THREE.MeshStandardMaterial({ color: 0x2a2f2c, roughness: 0.85, metalness: 0.05, emissive: col, emissiveIntensity: 0.16 })),
      );
      path.receiveShadow = true;
      g.add(path);

      // Vegetation: two InstancedMeshes (trunk + canopy).
      const TREES = 64;
      const trunkGeo = track(new THREE.CylinderGeometry(0.18, 0.3, 2.6, 6));
      const canopyGeo = track(new THREE.ConeGeometry(1.5, 3.6, 7));
      const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }));
      const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0x2f7a4a, roughness: 0.85, emissive: 0x0d3a1e, emissiveIntensity: 0.35 }));
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
      const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, TREES);
      trunks.castShadow = canopies.castShadow = true;
      {
        const d = new THREE.Object3D();
        for (let i = 0; i < TREES; i++) {
          const a = hash01(i * 1.9 + 40) * TAU;
          const r = 14 + hash01(i * 7.3 + 11) * 15;
          const s = 0.7 + hash01(i * 3.7 + 5) * 0.9;
          d.position.set(Math.cos(a) * r, 1.3 * s, Math.sin(a) * r);
          d.rotation.set(0, hash01(i * 2.9) * TAU, 0);
          d.scale.setScalar(s);
          d.updateMatrix();
          trunks.setMatrixAt(i, d.matrix);
          d.position.y = (2.6 + 1.7) * s;
          d.updateMatrix();
          canopies.setMatrixAt(i, d.matrix);
        }
        trunks.instanceMatrix.needsUpdate = true;
        canopies.instanceMatrix.needsUpdate = true;
      }
      g.add(trunks, canopies);

      // Relay pylons: green energy columns that pulse along the path.
      const pylons = [];
      for (let i = 0; i < 8; i++) {
        const p = pathCurve.getPointAt(i / 7);
        const m = track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, toneMapped: false }));
        const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.16, 9, 6, 1, true)), m);
        beam.position.set(p.x, 4.5, p.z);
        g.add(beam);
        pylons.push({ beam, mat: m, phase: i / 8 });
      }

      let recovery = 0;
      addUpdater('emerald', (dt, t, anim, q) => {
        for (const p of pylons) {
          const w = (t * 0.22 * anim + p.phase) % 1;
          p.mat.opacity = 0.18 + Math.pow(1 - Math.abs(w - 0.5) * 2, 3) * 0.75 + recovery * 0.2;
        }
        path.material.emissiveIntensity = 0.12 + recovery * 0.5 + Math.sin(t * 0.9) * 0.03 * anim;
        const visible = Math.min(TREES, q.trees);
        trunks.count = visible;
        canopies.count = visible;
      });

      return {
        group: g, blocks, trunks, canopies, pylons, path, color: col,
        setRecovery(v) { recovery = clamp(v, 0, 1); },
      };
    })();

    /* ==================================================================== *
     * SHARED BUILDERS
     * ==================================================================== */

    /** Instanced floating motes — bounded particle-like ambience. */
    function makeMotes(parent, color, count, radius, height) {
      const geo = track(new THREE.SphereGeometry(0.075, 5, 4));
      const mat = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      parent.add(mesh);
      const seeds = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        seeds[i * 4] = hash01(i * 1.7) * TAU;
        seeds[i * 4 + 1] = 2 + hash01(i * 3.1) * radius;
        seeds[i * 4 + 2] = hash01(i * 5.9) * height;
        seeds[i * 4 + 3] = 0.4 + hash01(i * 7.7) * 1.4;
      }
      const d = new THREE.Object3D();
      let active = count;
      let accum = 0;
      return {
        mesh,
        update(dt, t, anim) {
          accum += dt;
          const step = anim < 0.3 ? 1 / 15 : 1 / 30;
          if (accum < step) return;
          accum = 0;
          for (let i = 0; i < active; i++) {
            const a = seeds[i * 4] + t * 0.12 * seeds[i * 4 + 3] * anim;
            const r = seeds[i * 4 + 1];
            d.position.set(Math.cos(a) * r, seeds[i * 4 + 2] + Math.sin(t * 0.7 * seeds[i * 4 + 3] + i) * 0.9 * anim, Math.sin(a) * r);
            const s = 0.6 + Math.sin(t * 2 + i) * 0.25 * anim;
            d.scale.setScalar(Math.max(0.15, s));
            d.updateMatrix();
            mesh.setMatrixAt(i, d.matrix);
          }
          mesh.count = active;
          mesh.instanceMatrix.needsUpdate = true;
        },
        setCount(n) { active = Math.min(count, Math.max(0, n | 0)); },
        get count() { return active; },
      };
    }

    /** Spatial Evolution Lab: a scanner/classification machine. */
    function buildLabConsole(THREE, track, color, assets) {
      const group = new THREE.Group();
      group.name = 'lab-console';

      const base = new THREE.Mesh(
        track(new THREE.CylinderGeometry(2.6, 3.2, 1.1, 10)),
        track(new THREE.MeshStandardMaterial({ color: 0x141a3c, roughness: 0.4, metalness: 0.7, emissive: color, emissiveIntensity: 0.28 })),
      );
      base.position.y = 0.55;
      base.castShadow = true;
      group.add(base);

      const column = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.5, 0.7, 3.4, 8)),
        track(new THREE.MeshStandardMaterial({ color: 0x1b2350, roughness: 0.35, metalness: 0.85, emissive: color, emissiveIntensity: 0.4 })),
      );
      column.position.y = 2.8;
      group.add(column);

      // Scanner bowl + rotating holo rings.
      const bowl = new THREE.Mesh(
        track(new THREE.SphereGeometry(2.1, 20, 12, 0, TAU, 0, Math.PI / 2)),
        track(new THREE.MeshPhysicalMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false })),
      );
      bowl.position.y = 4.6;
      group.add(bowl);

      const rings = [];
      for (let i = 0; i < 3; i++) {
        const m = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, toneMapped: false }));
        const r = new THREE.Mesh(track(new THREE.TorusGeometry(1.3 + i * 0.5, 0.05, 6, 48)), m);
        r.position.y = 4.6;
        r.rotation.x = Math.PI / 2 + i * 0.35;
        group.add(r);
        rings.push(r);
      }

      // Four dial pads = build / hair / life stage / energy.
      const dials = [];
      const dialLabels = ['BUILD', 'HAIR', 'STAGE', 'ENERGY'];
      const dialGeo = track(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 16));
      for (let i = 0; i < 4; i++) {
        const a = -0.9 + i * 0.6;
        const mat = track(new THREE.MeshStandardMaterial({ color: 0x222a5e, emissive: color, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.6 }));
        const dial = new THREE.Mesh(dialGeo, mat);
        dial.position.set(Math.sin(a) * 2.1, 1.25, Math.cos(a) * 2.1);
        dial.userData = { kind: 'lab-dial', index: i, label: dialLabels[i], hitRadius: 1.5, ref: dial };
        group.add(dial);
        const hit = new THREE.Mesh(track(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 8)), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.copy(dial.position);
        hit.userData = dial.userData;
        group.add(hit);
        if (assets) {
          const tex = assets.label('dial-' + i, dialLabels[i], { color: '#dfeaff', size: 52, box: true });
          if (tex) {
            const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
            const asp = tex.userData.aspect || 4;
            s.scale.set(asp * 1.05, 1.05, 1);
            s.position.set(dial.position.x, 2.3, dial.position.z);
            group.add(s);
          }
        }
        dials.push({ mesh: dial, mat, index: i });
      }

      if (assets) {
        const tex = assets.label('lab', 'EVOLUTION LAB', { color: '#8ff0ff', sub: 'classification simulator', size: 76, box: true });
        if (tex) {
          const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
          const asp = tex.userData.aspect || 4;
          s.scale.set(asp * 2.6, 2.6, 1);
          s.position.set(0, 7.6, 0);
          group.add(s);
        }
      }

      let scanPulse = 0;
      return {
        group, dials, rings,
        pulse() { scanPulse = 1; },
        update(dt, t, anim) {
          scanPulse = Math.max(0, scanPulse - dt * 0.9);
          rings.forEach((r, i) => {
            r.rotation.z += dt * (0.5 + i * 0.3) * anim;
            r.material.opacity = 0.35 + scanPulse * 0.55 + Math.sin(t * 2 + i) * 0.08 * anim;
          });
          bowl.material.opacity = 0.10 + scanPulse * 0.22;
          bowl.scale.setScalar(1 + scanPulse * 0.08);
          for (const d of dials) d.mat.emissiveIntensity = 0.35 + scanPulse * 0.9;
        },
      };
    }

    /* ==================================================================== *
     * EVOLUTION GEOGRAPHY
     * ==================================================================== */
    const routes = {};

    /**
     * Build the physical route for one lineage.
     *
     * ROUTES[line] supplies *where* the pads stand; the canonical engine
     * supplies *which* forms stand on them. Nothing here re-declares the
     * taxonomy — `lineage` is `BattleCore.BATTLE_LINES[line]` verbatim.
     *
     * @param {string} line
     * @param {(id:string)=>object} entryOf
     * @param {{main:string[],variant:?string}} [lineage] canonical id lists
     */
    function buildRoute(line, entryOf, lineage) {
      const cfg = ROUTES[line];
      if (!cfg) return null;
      const anchors = cfg.main || cfg.scatter || [];
      const idList = (lineage && lineage.main) || [];
      const variantId = (lineage && lineage.variant) || null;
      const dist = C.DISTRICTS[cfg.district];
      const color = C.LINE_COLOR[line] || 0x42e7ff;
      const g = new THREE.Group();
      g.name = 'route-' + line.toLowerCase();
      g.position.set(dist.center[0], 0, dist.center[1]);
      root.add(g);

      const nodes = [];

      // Path tube(s) between consecutive main stages.
      const pathMat = track(new THREE.MeshStandardMaterial({
        color: 0x0f1533, emissive: color, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.95,
      }));

      function tubeThrough(points, radius) {
        if (points.length < 2) return null;
        const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], 0.22, p[1])), false, 'catmullrom', 0.35);
        const mesh = new THREE.Mesh(track(new THREE.TubeGeometry(curve, Math.max(16, points.length * 14), radius, 7, false)), pathMat);
        g.add(mesh);
        return curve;
      }

      if (cfg.main) {
        tubeThrough(cfg.main, 0.42);
      }

      idList.forEach((id, i) => {
        const e = entryOf(id);
        const p = anchors[i];
        if (!e || !p) return;
        const isMega = e.stage === 'Mega';
        const node = buildRouteNode(THREE, track, assets, e, color, { mega: isMega, index: i });
        node.group.position.set(p[0], 0, p[1]);
        g.add(node.group);
        nodes.push({ id, entry: e, node, local: p, world: [dist.center[0] + p[0], dist.center[1] + p[1]] });
      });

      // Variant spur: visibly branches off the main path. The variant id comes
      // from the canonical lineage record — never re-declared here.
      if (cfg.branch && variantId && cfg.main) {
        const from = cfg.main[cfg.branch.at];
        const to = cfg.branch.to;
        const mid = [(from[0] + to[0]) / 2 + 3.5, (from[1] + to[1]) / 2 - 3.5];
        tubeThrough([from, mid, to], 0.26);
        const ve = entryOf(variantId);
        if (ve) {
          const node = buildRouteNode(THREE, track, assets, ve, color, { variant: true });
          node.group.position.set(to[0], 0, to[1]);
          g.add(node.group);
          nodes.push({ id: ve.id, entry: ve, node, local: to, world: [dist.center[0] + to[0], dist.center[1] + to[1]], variant: true });
          // "VARIANT" branch marker so the fork reads as intentional.
          if (assets) {
            const tex = assets.label('branch-' + line, 'VARIANT BRANCH', { color: '#ffd7f2', size: 46, box: true });
            if (tex) {
              const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })));
              const asp = tex.userData.aspect || 4;
              s.scale.set(asp * 1.5, 1.5, 1);
              s.position.set(mid[0], 3.4, mid[1]);
              g.add(s);
            }
          }
        }
      }

      // Route title.
      if (assets) {
        const tex = assets.label('route-' + line, `${line.toUpperCase()} LINEAGE ROUTE`, {
          color: '#ffffff', sub: cfg.main ? 'starter → stage ii → stage iii → mega' : 'independent forms · no ladder', size: 66, box: true,
        });
        if (tex) {
          const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
          const asp = tex.userData.aspect || 4;
          s.scale.set(asp * 3.4, 3.4, 1);
          s.position.set(0, 9.5, cfg.main ? -14 : 0);
          g.add(s);
        }
      }

      routes[line] = { line, district: cfg.district, nodes, group: g, shape: cfg.shape };
      return routes[line];
    }

    /** One pad on a lineage route, with its Mega gate where appropriate. */
    function buildRouteNode(THREE, track, assets, e, color, o = {}) {
      const group = new THREE.Group();
      const isMega = !!o.mega;
      const radius = isMega ? 4.2 : o.variant ? 2.6 : 3.1;

      const pad = new THREE.Mesh(
        track(new THREE.CylinderGeometry(radius, radius * 1.12, 0.34, isMega ? 8 : 28)),
        track(new THREE.MeshStandardMaterial({
          color: isMega ? 0x2a1140 : 0x101634, roughness: 0.35, metalness: 0.6,
          emissive: color, emissiveIntensity: isMega ? 0.85 : 0.4,
        })),
      );
      pad.position.y = 0.17;
      pad.receiveShadow = true;
      group.add(pad);

      const halo = new THREE.Mesh(
        track(new THREE.TorusGeometry(radius * 1.06, 0.11, 6, 64)),
        track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, toneMapped: false })),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.4;
      group.add(halo);

      // Mega forms get a dramatic gate instead of a plain ring.
      if (isMega) {
        const gateMat = track(new THREE.MeshStandardMaterial({ color: 0x3a1450, emissive: color, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.85, transparent: true, opacity: 0.92 }));
        for (const s of [-1, 1]) {
          const pillar = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 11, 0.9)), gateMat);
          pillar.position.set(s * radius * 1.25, 5.5, 0);
          pillar.castShadow = true;
          group.add(pillar);
        }
        const lintel = new THREE.Mesh(track(new THREE.BoxGeometry(radius * 2.9, 1.1, 1.1)), gateMat);
        lintel.position.y = 11;
        group.add(lintel);
        if (assets) {
          const tex = assets.label('mega-gate', 'MEGA GATE', { color: '#ffd9f6', size: 60, box: true });
          if (tex) {
            const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
            const asp = tex.userData.aspect || 4;
            s.scale.set(asp * 2.2, 2.2, 1);
            s.position.set(0, 12.8, 0);
            group.add(s);
          }
        }
      }

      return {
        group, pad, halo,
        update(dt, t, anim) {
          halo.rotation.z += dt * (isMega ? 0.5 : 0.22) * anim;
          halo.material.opacity = 0.5 + Math.sin(t * 1.8) * 0.2 * anim;
        },
      };
    }

    /* ---- world-level API ----------------------------------------------- */
    let activeDistrict = 'nexus';
    let ripple = { t: 1, at: new THREE.Vector2(0, 0) };
    let focusPulse = 0;
    let updateFrame = 0;

    /**
     * Which district owns this point? Nearest district whose radius contains
     * it; the transit nexus is the fallback for the spokes between them.
     */
    function districtAt(x, z) {
      let best = null, bestD = Infinity;
      for (const id of ['prism', 'aqua', 'pride', 'emerald']) {
        const d = C.DISTRICTS[id];
        const dist = Math.hypot(x - d.center[0], z - d.center[1]);
        if (dist < d.radius && dist < bestD) { best = id; bestD = dist; }
      }
      return best || 'nexus';
    }

    function setActiveDistrict(id) {
      const next = C.DISTRICTS[id] ? id : 'nexus';
      const changed = next !== activeDistrict;
      activeDistrict = next;
      const d = C.DISTRICTS[activeDistrict];
      groundMat.uniforms.uDistrict.value.set(d.center[0], 0, d.center[1]);
      groundMat.uniforms.uDistrictColor.value.setHex(d.color);
      if (changed) {
        focusPulse = 1;
        pulseRipple(d.center[0], d.center[1]);
      }
    }

    function pulseRipple(x, z) { ripple = { t: 0, at: new THREE.Vector2(x, z) }; }
    function pulseFocus(strength = 1) { focusPulse = Math.max(focusPulse, clamp(strength, 0, 1.5)); }
    let lastUpdateStats = { activeDistrict: 'nexus', updatersRun: 0, routeNodesUpdated: 0, frame: 0 };

    function update(dt, t, anim, q) {
      groundMat.uniforms.uTime.value = t;
      focusPulse = Math.max(0, focusPulse - dt * 1.8);
      groundMat.uniforms.uPulse.value = focusPulse * focusPulse;
      if (ripple.t < 1) {
        ripple.t = Math.min(1, ripple.t + dt * 0.85);
        groundMat.uniforms.uRipple.value = ripple.t;
        groundMat.uniforms.uRippleAt.value.copy(ripple.at);
      }
      stars.rotation.y += dt * 0.004 * anim;
      updateFrame++;
      const inactiveStride = activeDistrict === 'nexus' ? 2 : 8;
      let updatersRun = 0;
      for (let i = 0; i < updaters.length; i++) {
        const u = updaters[i];
        const hot = u.scope === 'nexus' || u.scope === activeDistrict;
        if (!hot && updateFrame % inactiveStride !== 0) continue;
        u.fn(hot ? dt : dt * inactiveStride, t, hot ? anim : anim * 0.45, q);
        updatersRun++;
      }
      let routeNodesUpdated = 0;
      for (const r of Object.values(routes)) {
        if (r.district !== activeDistrict && updateFrame % inactiveStride !== 0) continue;
        const routeAnim = r.district === activeDistrict ? anim : anim * 0.35;
        for (const n of r.nodes) {
          n.node.update(dt, t, routeAnim);
          routeNodesUpdated++;
        }
      }
      lastUpdateStats = { activeDistrict, updatersRun, routeNodesUpdated, frame: updateFrame };
    }

    function setQuality(q) {
      districts.pride.setCrowdCount(q.crowd);
      districts.prism.motes.setCount(q.particles > 400 ? 220 : q.particles > 200 ? 120 : 40);
      districts.aqua.motes.setCount(q.particles > 400 ? 150 : q.particles > 200 ? 80 : 26);
      key.castShadow = !!q.shadows;
      if (q.shadows && key.shadow.mapSize.width !== q.shadowMapSize) {
        key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
      domeVisible(!!q.lattice);
    }

    function domeVisible(v) {
      districts.prism.dome.visible = v;
      districts.prism.shell.visible = v;
    }

    function dispose() {
      for (const d of disposables) { try { d.dispose(); } catch { /* already gone */ } }
      disposables.length = 0;
      if (root.parent) root.parent.remove(root);
      root.clear();
    }

    return {
      THREE, root, districts, routes,
      buildRoute, districtAt, setActiveDistrict, get activeDistrict() { return activeDistrict; },
      pulseRipple, pulseFocus, update, setQuality, dispose,
      get updaters() { return updaters.length; },
      get updateStats() { return { ...lastUpdateStats }; },
      ROUTES,
    };
  }

  C.createWorld = createWorld;
  C.ROUTES = ROUTES;
})(window.GayDexCircuit);
