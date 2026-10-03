/* ---------------------------------------------------------------------------
 * GayDex: Circuit — input.
 *
 * Lane: threejs-project-engineer (raycasting, interaction, touch).
 *
 * Desktop: WASD / arrows to move, drag or Q/E to look, Shift to run,
 *          E / Enter / Space / click to interact, Tab to cycle targets,
 *          F1–F4 to warp, Esc to go back.
 * Touch:   left-half drag = virtual stick, right-half drag = look,
 *          tap = target/interact, plus on-screen buttons.
 *
 * Interaction always goes through real raycasting against deliberately
 * oversized hit volumes, so nothing is a pixel hunt. Every spatial action also
 * has an accessible DOM equivalent in the navigator.
 * ------------------------------------------------------------------------ */
(function (C) {
  'use strict';

  const { clamp, damp } = C.util;

  function createInput(THREE, opts = {}) {
    const { runtime, canvas, onInteract, onTarget, onEscape, onWarp } = opts;
    const camera = runtime.camera;

    const rig = {
      pos: new THREE.Vector3(0, C.RIG.eyeHeight, 26),
      yaw: Math.PI,
      pitch: -0.05,
      yawTarget: Math.PI,
      pitchTarget: -0.05,
      velocity: new THREE.Vector3(),
      grounded: true,
    };

    const keys = new Set();
    const raycaster = new THREE.Raycaster();
    raycaster.far = 90;
    const ndc = new THREE.Vector2(0, 0);
    const tmpV = new THREE.Vector3();

    let enabled = false;
    let touchMode = false;
    let targetId = null;
    let targetKind = null;
    let targetRef = null;
    let dragging = false;
    let dragPointer = -1;
    let lastX = 0, lastY = 0;
    let pointerNdc = new THREE.Vector2(0, 0);
    let hoverFromPointer = false;

    // Virtual stick state (touch).
    const stick = { active: false, id: -1, x: 0, y: 0, ox: 0, oy: 0 };
    const look = { active: false, id: -1, x: 0, y: 0 };

    let getTargets = () => [];

    function setTargets(fn) { getTargets = typeof fn === 'function' ? fn : () => []; }

    /* ---- targeting ----------------------------------------------------- */
    function pick(nx, ny) {
      ndc.set(nx, ny);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(getTargets(), false);
      if (!hits.length) return null;
      const ud = hits[0].object.userData || {};
      if (!ud.kind) return null;
      return { kind: ud.kind, id: ud.id || ud.district || ud.label, ref: ud.ref || hits[0].object, label: ud.label || '', distance: hits[0].distance, index: ud.index };
    }

    function cycleTarget(dir) {
      const list = getTargets().filter((o) => o.userData && o.userData.kind === 'specimen');
      if (!list.length) return null;
      const ids = list.map((o) => o.userData.id);
      let i = ids.indexOf(targetId);
      i = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length;
      setTarget('specimen', ids[i]);
      return ids[i];
    }

    function setTarget(kind, id) {
      const changed = kind !== targetKind || id !== targetId;
      targetKind = kind;
      targetId = id;
      if (changed && onTarget) onTarget(kind, id);
      return changed;
    }

    function clearTarget() {
      if (targetId === null && targetKind === null) return;
      targetKind = null; targetId = null;
      if (onTarget) onTarget(null, null);
    }

    /* ---- keyboard ------------------------------------------------------ */
    function onKeyDown(e) {
      if (!enabled) return;
      const t = e.target;
      if (t && t.closest && t.closest('input,select,textarea,button,a,[contenteditable="true"]')) return;

      if (e.key === 'Escape') { if (onEscape) onEscape(); return; }
      if (e.key === 'Tab') { e.preventDefault(); cycleTarget(e.shiftKey ? -1 : 1); return; }

      const warp = { F1: 'prism', F2: 'aqua', F3: 'pride', F4: 'emerald' }[e.key];
      if (warp) { e.preventDefault(); if (onWarp) onWarp(warp); return; }

      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
        if (targetId) { e.preventDefault(); interact(); }
        return;
      }
      keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    }

    function onKeyUp(e) { keys.delete(e.code); }
    function onBlur() { keys.clear(); stick.active = false; look.active = false; }

    /* ---- pointer (mouse / pen / touch) --------------------------------- */
    function localNdc(e) {
      const r = canvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      ];
    }

    function isTouch(e) { return e.pointerType === 'touch'; }

    function onPointerDown(e) {
      if (!enabled) return;
      canvas.setPointerCapture?.(e.pointerId);
      if (isTouch(e)) {
        touchMode = true;
        const r = canvas.getBoundingClientRect();
        const leftHalf = e.clientX - r.left < r.width * 0.45;
        if (leftHalf && !stick.active) {
          stick.active = true; stick.id = e.pointerId;
          stick.ox = e.clientX; stick.oy = e.clientY; stick.x = 0; stick.y = 0;
          if (opts.onStick) opts.onStick('start', 0, 0);
        } else if (!look.active) {
          look.active = true; look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
        }
        return;
      }
      dragging = true;
      dragPointer = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      const [nx, ny] = localNdc(e);
      pointerNdc.set(nx, ny);
      const hit = pick(nx, ny);
      if (hit) setTarget(hit.kind, hit.id);
    }

    function onPointerMove(e) {
      if (!enabled) return;
      if (isTouch(e)) {
        if (stick.active && e.pointerId === stick.id) {
          const dx = (e.clientX - stick.ox) / 58;
          const dy = (e.clientY - stick.oy) / 58;
          const len = Math.hypot(dx, dy) || 1;
          const k = len > 1 ? 1 / len : 1;
          stick.x = dx * k; stick.y = dy * k;
          if (opts.onStick) opts.onStick('move', stick.x, stick.y);
        } else if (look.active && e.pointerId === look.id) {
          const dx = e.clientX - look.x, dy = e.clientY - look.y;
          look.x = e.clientX; look.y = e.clientY;
          rig.yawTarget -= dx * C.RIG.dragSensitivity * 1.35;
          rig.pitchTarget = clamp(rig.pitchTarget - dy * C.RIG.dragSensitivity, C.RIG.pitchLimit[0], C.RIG.pitchLimit[1]);
        }
        return;
      }
      const [nx, ny] = localNdc(e);
      pointerNdc.set(nx, ny);
      hoverFromPointer = true;
      if (dragging && e.pointerId === dragPointer) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        rig.yawTarget -= dx * C.RIG.dragSensitivity;
        rig.pitchTarget = clamp(rig.pitchTarget - dy * C.RIG.dragSensitivity, C.RIG.pitchLimit[0], C.RIG.pitchLimit[1]);
      }
    }

    function onPointerUp(e) {
      if (!enabled) return;
      canvas.releasePointerCapture?.(e.pointerId);
      if (isTouch(e)) {
        if (stick.active && e.pointerId === stick.id) {
          stick.active = false; stick.x = stick.y = 0;
          if (opts.onStick) opts.onStick('end', 0, 0);
        } else if (look.active && e.pointerId === look.id) {
          look.active = false;
          // Tap (no meaningful drag) = target / interact.
          const hit = pick(pointerNdc.x, pointerNdc.y);
          if (hit) { setTarget(hit.kind, hit.id); if (hit.kind !== 'specimen') interact(); }
        }
        return;
      }
      if (dragging && e.pointerId === dragPointer) {
        const moved = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
        dragging = false; dragPointer = -1;
        if (moved < 3 && targetId) interact();
      }
    }

    function onWheel(e) {
      if (!enabled) return;
      e.preventDefault();
      // Wheel nudges pitch slightly and dollies the eye height — a small,
      // bounded affordance, never a free-fly that can lose the player.
      rig.pitchTarget = clamp(rig.pitchTarget - e.deltaY * 0.00035, C.RIG.pitchLimit[0], C.RIG.pitchLimit[1]);
    }

    /* ---- interaction --------------------------------------------------- */
    function interact() {
      if (!targetId) return false;
      if (onInteract) onInteract(targetKind, targetId);
      return true;
    }

    /* ---- per-frame ----------------------------------------------------- */
    function update(dt, t, anim) {
      if (!enabled) return;

      // Input vector: keyboard + virtual stick.
      let ix = 0, iz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
      if (keys.has('KeyA')) ix -= 1;
      if (keys.has('KeyD')) ix += 1;
      if (keys.has('ArrowLeft')) rig.yawTarget += dt * C.RIG.turnSpeed;
      if (keys.has('ArrowRight')) rig.yawTarget -= dt * C.RIG.turnSpeed;
      if (keys.has('KeyQ')) rig.yawTarget += dt * C.RIG.turnSpeed * 1.6;
      if (keys.has('KeyE') === false && keys.has('KeyR')) rig.yawTarget -= dt * C.RIG.turnSpeed * 1.6;
      ix += stick.x; iz += stick.y;

      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; }
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = (run ? C.RIG.runSpeed : C.RIG.walkSpeed) * (anim < 0.5 ? 0.85 : 1);

      const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
      const wx = (ix * cos - iz * sin) * speed;
      const wz = (ix * sin + iz * cos) * speed;
      rig.velocity.x = damp(rig.velocity.x, wx, 9, dt);
      rig.velocity.z = damp(rig.velocity.z, wz, 9, dt);
      rig.pos.x += rig.velocity.x * dt;
      rig.pos.z += rig.velocity.z * dt;

      const lim = C.RIG.bounds;
      rig.pos.x = clamp(rig.pos.x, -lim, lim);
      rig.pos.z = clamp(rig.pos.z, -lim, lim);

      // Head bob while walking; suppressed under reduced motion.
      const moving = Math.hypot(rig.velocity.x, rig.velocity.z) > 0.6;
      const bob = moving ? Math.sin(t * (run ? 13 : 9)) * 0.055 * anim : 0;

      rig.yaw = damp(rig.yaw, rig.yawTarget, 12, dt);
      rig.pitch = damp(rig.pitch, rig.pitchTarget, 12, dt);

      camera.position.set(rig.pos.x, C.RIG.eyeHeight + bob, rig.pos.z);
      tmpV.set(
        camera.position.x + Math.sin(rig.yaw) * Math.cos(rig.pitch),
        camera.position.y + Math.sin(rig.pitch),
        camera.position.z + Math.cos(rig.yaw) * Math.cos(rig.pitch),
      );
      camera.lookAt(tmpV);

      // Crosshair targeting wins over pointer hover while walking.
      const hit = pick(0, 0) || (hoverFromPointer ? pick(pointerNdc.x, pointerNdc.y) : null);
      if (hit) setTarget(hit.kind, hit.id);
      else if (targetId && !stick.active) {
        // Keep an explicit Tab/click selection until the player moves on.
        if (!keys.size && !dragging) { /* hold */ } else clearTarget();
      }
    }

    /* ---- wiring -------------------------------------------------------- */
    const cleanups = [];
    function bind() {
      const d = typeof document !== 'undefined' ? document : null;
      if (!d) return;
      d.addEventListener('keydown', onKeyDown);
      d.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      cleanups.push(() => {
        d.removeEventListener('keydown', onKeyDown);
        d.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
      });
    }

    function setEnabled(v) {
      enabled = !!v;
      if (!enabled) { keys.clear(); stick.active = false; look.active = false; dragging = false; }
    }

    function teleport(x, z, yaw) {
      rig.pos.set(x, C.RIG.eyeHeight, z);
      rig.velocity.set(0, 0, 0);
      if (typeof yaw === 'number') { rig.yaw = rig.yawTarget = yaw; }
      camera.position.copy(rig.pos);
    }

    function dispose() {
      setEnabled(false);
      cleanups.forEach((f) => f());
      cleanups.length = 0;
    }

    bind();

    return {
      rig, setTargets, setEnabled, teleport, cycleTarget, setTarget, clearTarget,
      interact, update, dispose, pick,
      get enabled() { return enabled; },
      get target() { return targetKind ? { kind: targetKind, id: targetId } : null; },
      get touchMode() { return touchMode; },
      get stick() { return stick; },
      state: { keys, dragging, stick, look },
    };
  }

  C.createInput = createInput;
})(window.GayDexCircuit);
