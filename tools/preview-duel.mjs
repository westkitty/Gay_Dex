/**
 * Visual proof for the fight-vector duel card (no browser required).
 *
 * There is no browser in this sandbox, so this probe boots the real shipped
 * artifact in jsdom, records the 2D canvas calls the production code actually
 * makes (real coordinates, real colours, real strings), and replays them into
 * the repository's own software rasteriser to produce PNGs.
 *
 * Honest caveat: text is drawn with tools/make-icons.mjs's 5x7 pixel font at
 * the size the card asked for, not with a browser font, so glyph shapes differ
 * from a real browser while positions, sizes and colours do not.
 *
 * Run: npm run preview:duel   (writes PNGs to ./preview-out, which is ignored)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, encodePng } from './make-icons.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || join(ROOT, 'preview-out');
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(join(ROOT, 'node_modules', 'jsdom'));
const HTML = readFileSync(join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html'), 'utf8');
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- recording context */

const parseColor = (v) => {
  const s = String(v || '#000').trim();
  let m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(',').map((n) => parseFloat(n));
    const a = p.length > 3 ? p[3] : 1;
    return { hex: ((Math.round(p[0]) << 16) | (Math.round(p[1]) << 8) | Math.round(p[2])), a };
  }
  m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3) return { hex: parseInt(h.split('').map((c) => c + c).join(''), 16), a: 1 };
    if (h.length === 4) return { hex: parseInt(h.slice(0, 3).split('').map((c) => c + c).join(''), 16), a: parseInt(h[3] + h[3], 16) / 255 };
    if (h.length === 6) return { hex: parseInt(h, 16), a: 1 };
    return { hex: parseInt(h.slice(0, 6), 16), a: parseInt(h.slice(6), 16) / 255 };
  }
  return { hex: 0x000000, a: 1 };
};

const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');

/** Mirrors the canvas API calls duelDraw makes, keeping style state. */
function recordingContext() {
  const ops = [];
  let path = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px x', textAlign: 'left', lineCap: 'butt', dash: [] };
  const ctx = {
    ops,
    canvas: { width: 640, height: 300 },
    beginPath() { path = []; },
    closePath() { path.closed = true; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    arc(x, y, r, a0, a1) { path.push({ arc: [x, y, r, a0 == null ? 0 : a0, a1 == null ? Math.PI * 2 : a1] }); },
    fill() { ops.push({ op: 'fill', path: path.slice(), color: parseColor(state.fillStyle) }); },
    stroke() { ops.push({ op: 'stroke', path: path.slice(), color: parseColor(state.strokeStyle), w: state.lineWidth, dash: state.dash.slice() }); },
    fillText(text, x, y) {
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] || '10');
      ops.push({ op: 'text', text: String(text), x, y, size, align: state.textAlign, color: parseColor(state.fillStyle) });
    },
    clearRect(x, y, w, h) { ops.push({ op: 'clear', x, y, w, h }); },
    setLineDash(d) { state.dash = d ? d.slice() : []; },
    save() {}, restore() {}, translate() {}, setTransform() {},
    measureText: (t) => ({ width: String(t).length * 7 }),
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'lineCap']) {
    Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { state[k] = v; } });
  }
  return ctx;
}

function launch() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  let rec = null;
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/gaydex.html',
    virtualConsole: vc,
    beforeParse(window) {
      window.devicePixelRatio = 2; // exercise the high-DPI backing-store path
      window.matchMedia = (q) => ({
        media: q, matches: false, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent: () => false,
      });
      class RO { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} }
      window.ResizeObserver = RO;
      window.IntersectionObserver = class extends RO {
        constructor(cb, opts) { super(cb); this.opts = opts; }
        observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
      };
      if (!window.CSS) window.CSS = {};
      if (!window.CSS.escape) window.CSS.escape = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== '2d') return null;
        if (this.id === 'duelCanvas') { if (!rec) { rec = recordingContext(); this.__ctx = rec; } return this.__ctx; }
        return new Proxy({}, {
          get(t, k) {
            if (k === 'canvas') return { width: 64, height: 64 };
            if (k === 'measureText') return () => ({ width: 120 });
            if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
            if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
            return () => {};
          },
          set() { return true; },
        });
      };
    },
  });
  return { window: dom.window, errors, ops: () => rec.ops };
}

/* ------------------------------------------------------------ raster replay */

const circlePoly = (x, y, r, a0 = 0, a1 = Math.PI * 2) => {
  const pts = [], n = 64;
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return pts;
};

function segQuad([ax, ay], [bx, by], w) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * w / 2, ny = dx / len * w / 2;
  return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
}

function replay(ops, { width = 640, height = 300 } = {}) {
  const c = canvas(width, height, { supersample: 2 });
  c.rect(0, 0, width, height, '#0b0f24'); // the card's own panel background
  for (const o of ops) {
    if (o.op === 'clear') continue; // the probe paints the panel first
    const alpha = o.color.a;
    const paint = (pts, fill) => {
      if (!pts.length) return;
      if (fill) c.poly(pts, hexStr(o.color.hex), alpha);
      else {
        // strokes arrive as one polyline, sometimes dashed
        const dash = o.dash && o.dash.length ? o.dash : null;
        if (!dash) {
          for (let i = 0; i + 1 < pts.length; i++) c.poly(segQuad(pts[i], pts[i + 1], o.w), hexStr(o.color.hex), alpha);
        } else {
          const d = o.dash;
          let di = 0, drem = d[0], on = true;
          for (let i = 0; i + 1 < pts.length; i++) {
            let [ax, ay] = pts[i]; const [bx, by] = pts[i + 1];
            let remain = Math.hypot(bx - ax, by - ay);
            if (remain < 1e-6) continue;
            const ux = (bx - ax) / remain, uy = (by - ay) / remain;
            while (remain > 1e-6) {
              const take = Math.min(remain, Math.max(0.01, drem));
              if (on) c.poly(segQuad([ax, ay], [ax + ux * take, ay + uy * take], o.w), hexStr(o.color.hex), alpha);
              ax += ux * take; ay += uy * take; remain -= take; drem -= take;
              if (drem <= 1e-6) { di = (di + 1) % d.length; drem = d[di]; on = !on; }
            }
          }
        }
      }
    };
    if (o.op === 'fill' || o.op === 'stroke') {
      const pts = [];
      for (const p of o.path) {
        if (Array.isArray(p)) pts.push(p);
        else if (p && p.arc) {
          const seg = circlePoly(p.arc[0], p.arc[1], p.arc[2], p.arc[3], p.arc[4]);
          for (const q of seg) pts.push(q);
        }
      }
      if (o.op === 'fill' && o.path.closed === undefined && pts.length > 2 && o.path.length > 2) { /* polygon by default */ }
      paint(pts, o.op === 'fill');
    } else if (o.op === 'text') {
      const scale = Math.max(1, Math.round(o.size / 7));
      const w = String(o.text).length * 6 * scale;
      const x = o.align === 'center' ? o.x - w / 2 : o.x;
      c.text(o.text, x, o.y - 7 * scale + 1, scale, hexStr(o.color.hex), { tracking: scale });
    }
  }
  return c;
}

/** The card repaints by clearing first, so the last clear starts a whole frame. */
const lastFrame = (all) => {
  for (let i = all.length - 1; i >= 0; i--) if (all[i].op === 'clear') return all.slice(i);
  return all.slice();
};

const write = (name, c) => {
  mkdirSync(OUT, { recursive: true });
  const px = c.done();
  const buf = encodePng(c.width, c.height, px);
  writeFileSync(join(OUT, name), buf);
  return { name, bytes: buf.length };
};

const main = async () => {
  const { window, errors, ops } = launch();
  await settle(300);
  const App = window.GayDexApp;
  if (!App) { console.error('boot failed', errors.slice(0, 5)); process.exit(1); }
  const shots = [];

  for (const [id, label] of [['bear', 'bear'], ['twink', 'twink'], ['silver-otter', 'silver-otter']]) {
    const entry = App.dex.find((e) => e.id === id);
    App.renderDuelCard(entry);
    await settle(500); // let the 420 ms morph settle on the final geometry
    const model = App.duelModel(id);
    const c = replay(lastFrame(ops()));
    shots.push(write(`duel-${label}-vs-${model.rival.id}.png`, c));
  }

  // A LIVE frame: run an auto battle and snapshot the last frame the card
  // painted while the match was still in progress.
  const App2 = App;
  App2.resetBattle();
  await settle(160);
  const match = App2.battleState.match;
  const livePromise = App2.autoBattle();
  let liveShot = null, rounds = new Set();
  while (!match.ended) {
    rounds.add(match.round);
    if (window.document.querySelector('#duelCard').classList.contains('live')) {
      const slice = lastFrame(ops());
      liveShot = { slice, round: match.round, hp: window.document.querySelector('#duelCaption').textContent.trim() };
    }
    await settle(30);
  }
  await livePromise;
  await settle(140);
  if (liveShot) {
    shots.push(write(`duel-live-round${liveShot.round}.png`, replay(liveShot.slice)));
    shots.push({ name: `duel-live-round${liveShot.round}.png`, caption: liveShot.hp, rounds: [...rounds].sort((x, y) => x - y) });
  }
  shots.push(write('duel-after-match.png', replay(lastFrame(ops()))));

  console.log(JSON.stringify({ shots, errors, ops: ops().length }, null, 2));
  window.close();
};

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
