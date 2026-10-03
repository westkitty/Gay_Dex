#!/usr/bin/env node
/**
 * GayDex asset forge — app icon, touch icon and social card.
 *
 * GayDex ships as one HTML file with zero runtime dependencies, so its imagery
 * has to be authored here rather than imported. This tool draws the marks
 * procedurally (no fonts, no image libraries, no downloads) and writes:
 *
 *   src/shell/partials/head-icons.html   inline favicon/touch-icon data URIs,
 *                                        inlined into the artifact by the build
 *   assets/icon-512.png                  deployable app icon
 *   assets/og-card.png                   1200x630 social card
 *
 * The head fragment is part of the artifact, so `npm run build --check` fails
 * if the icons are stale: run `npm run icons` after changing this file.
 *
 * Provenance: 100% procedural, generated from this repository. MIT, same as
 * the rest of the project. Values are deterministic — the same input bytes
 * produce the same PNG every run.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------------ PNG --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of width*height*4 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- canvas --- */

/** Tiny software rasteriser: supersampled shapes into an RGBA buffer. */
export function canvas(width, height, opts = {}) {
  const ss = opts.supersample || 2;           // draw big, then box-filter down
  const w = width * ss, h = height * ss;
  const px = new Float32Array(w * h * 4);
  const hex = (c) => {
    const n = typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16) || 0;
    return [((n >> 16) & 255), ((n >> 8) & 255), (n & 255)];
  };
  const blend = (x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
    const i = (y * w + x) * 4;
    const inv = 1 - a;
    px[i] = px[i] * inv + r * a;
    px[i + 1] = px[i + 1] * inv + g * a;
    px[i + 2] = px[i + 2] * inv + b * a;
    px[i + 3] = px[i + 3] * inv + 255 * a;
  };
  const api = {
    width, height,
    rect(x, y, rw, rh, color, alpha = 1) {
      const [r, g, b] = hex(color);
      const x0 = Math.round(x * ss), y0 = Math.round(y * ss);
      const x1 = Math.round((x + rw) * ss), y1 = Math.round((y + rh) * ss);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blend(xx, yy, [r, g, b], alpha);
    },
    roundRect(x, y, rw, rh, radius, color, alpha = 1) {
      const [r, g, b] = hex(color);
      const x0 = x * ss, y0 = y * ss, x1 = (x + rw) * ss, y1 = (y + rh) * ss, rad = radius * ss;
      for (let yy = Math.floor(y0); yy < y1; yy++) {
        for (let xx = Math.floor(x0); xx < x1; xx++) {
          const cx = Math.min(Math.max(xx, x0 + rad), x1 - rad);
          const cy = Math.min(Math.max(yy, y0 + rad), y1 - rad);
          if ((xx - cx) ** 2 + (yy - cy) ** 2 > rad * rad) continue;
          blend(xx, yy, [r, g, b], alpha);
        }
      }
    },
    poly(points, color, alpha = 1) {
      const [r, g, b] = hex(color);
      const pts = points.map(([x, y]) => [x * ss, y * ss]);
      const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
      for (let yy = Math.floor(minY); yy <= maxY; yy++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + (yy - ay) / (by - ay) * (bx - ax));
        }
        xs.sort((a, b2) => a - b2);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          for (let xx = Math.ceil(xs[i]); xx <= Math.floor(xs[i + 1]); xx++) blend(xx, yy, [r, g, b], alpha);
        }
      }
    },
    /** Vertical/diagonal gradient fill clipped to nothing: used as a backdrop. */
    gradient(x, y, rw, rh, stops, alpha = 1) {
      for (let yy = Math.floor(y * ss); yy < (y + rh) * ss; yy++) {
        for (let xx = Math.floor(x * ss); xx < (x + rw) * ss; xx++) {
          const t = ((xx / ss - x) / rw + (yy / ss - y) / rh) / 2;
          const [c1, c2] = stops.length === 2 ? stops : [stops[0], stops[stops.length - 1]];
          const [r1, g1, b1] = hex(c1), [r2, g2, b2] = hex(c2);
          const k = Math.max(0, Math.min(1, t));
          blend(xx, yy, [r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k], alpha);
        }
      }
    },
    glow(cx, cy, radius, color, strength = 1) {
      const [r, g, b] = hex(color);
      const R = radius * ss;
      for (let yy = Math.floor(cy * ss - R); yy <= cy * ss + R; yy++) {
        for (let xx = Math.floor(cx * ss - R); xx <= cx * ss + R; xx++) {
          const d = Math.hypot(xx - cx * ss, yy - cy * ss) / R;
          if (d >= 1) continue;
          blend(xx, yy, [r, g, b], (1 - d) ** 2 * strength);
        }
      }
    },
    /** 5x7 pixel letterforms — the terminal voice, drawn as geometry. */
    glyph(ch, x, y, scale, color, alpha = 1) {
      const rows = FONT[ch] || FONT['?'];
      for (let ry = 0; ry < rows.length; ry++) {
        const row = rows[ry];
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] !== '1') continue;
          api.rect(x + rx * scale, y + ry * scale, scale, scale, color, alpha);
        }
      }
    },
    text(str, x, y, scale, color, opts2 = {}) {
      const tracking = opts2.tracking == null ? scale : opts2.tracking;
      let cx = x;
      for (const ch of String(str).toUpperCase()) {
        const rows = FONT[ch] || (ch === ' ' ? null : FONT['?']);
        if (rows) api.glyph(ch, cx, y, scale, color);
        cx += 6 * scale + tracking;
      }
      return cx - x - tracking;
    },
    textWidth(str, scale, tracking = 0) {
      return String(str).length * (6 * scale + tracking) - tracking;
    },
    done() {
      // Box-filter the supersampled buffer down to the requested size.
      const out = new Uint8Array(width * height * 4);
      const n = ss * ss;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (let sy = 0; sy < ss; sy++) {
            for (let sx = 0; sx < ss; sx++) {
              const i = ((y * ss + sy) * w + (x * ss + sx)) * 4;
              const al = px[i + 3] / 255;
              r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += px[i + 3];
            }
          }
          const i = (y * width + x) * 4;
          const alpha = a / n;
          const norm = alpha > 0 ? 255 / alpha : 0;
          out[i] = Math.min(255, Math.round(r / n * norm));
          out[i + 1] = Math.min(255, Math.round(g / n * norm));
          out[i + 2] = Math.min(255, Math.round(b / n * norm));
          out[i + 3] = Math.round(alpha);
        }
      }
      return out;
    },
  };
  return api;
}

/* 5x7 bitmap letterforms. Enough of the alphabet for the marks we draw. */
export const FONT = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10011', '01101'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],

  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
};

/* --------------------------------------------------------------- marks --- */

/** Rainbow used across the project's CSS and 3D palette. */
const RAINBOW = [0xff4db8, 0xff8a4d, 0xffc14a, 0x57e38c, 0x42e7ff, 0x7a82ff, 0xa844ff];

function hexPoints(cx, cy, r, rot = Math.PI / 6) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = rot + (i * Math.PI) / 3;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/** The GayDex mark: a spectrum hexagon with a dark core and a pixel glyph. */
function drawMark(c, size, opts = {}) {
  const bg = opts.bg === undefined ? 0x070711 : opts.bg;
  const inset = size * 0.06;
  if (bg !== null) {
    c.roundRect(0, 0, size, size, size * 0.22, bg, 1);
    c.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.18, 0x10102a, 1);
  }
  const cx = size / 2, cy = size / 2;
  const R = size * 0.40;
  // Spectrum ring: six wedges around the hexagon, each a palette colour.
  const outer = hexPoints(cx, cy, R, Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    c.poly([outer[i], outer[(i + 1) % 6], [cx, cy], outer[i]], RAINBOW[i % RAINBOW.length], 0.95);
  }
  // Inner plate + core glyph. The label is sized to sit inside the plate
  // rather than over the spectrum ring.
  const plateR = R * 0.72;
  c.poly(hexPoints(cx, cy, R * 0.78), 0x0a0b1e, 1);
  c.poly(hexPoints(cx, cy, plateR), 0x14163a, 1);
  const label = opts.label || 'GD';
  const track = (sc) => sc * 0.6;
  // Horizontal room inside a hexagon of radius plateR at the text's cap band,
  // vertical room limited by the plate height.
  const availW = plateR * 1.34;
  const availH = plateR * 1.14;
  let glyphScale = Math.max(1, Math.floor(Math.min(
    (availW + track(1)) / (label.length * 6),
    availH / 7,
  )));
  const w = c.textWidth(label, glyphScale, track(glyphScale));
  c.text(label, cx - w / 2, cy - (7 * glyphScale) / 2, glyphScale, 0xffffff, { tracking: track(glyphScale) });
}

function iconPng(size, opts = {}) {
  const c = canvas(size, size, { supersample: size <= 128 ? 4 : 2 });
  drawMark(c, size, opts);
  return encodePng(size, size, c.done());
}

function ogCardPng(width = 1200, height = 630) {
  const c = canvas(width, height, { supersample: 2 });
  // Backdrop: the terminal's own palette.
  c.rect(0, 0, width, height, 0x070711, 1);
  c.gradient(0, 0, width, height, [0x191635, 0x070711], 1);
  // Faint measurement grid, like the specimen chamber.
  for (let x = 0; x < width; x += 40) c.rect(x, 0, 1, height, 0x42e7ff, 0.05);
  for (let y = 0; y < height; y += 40) c.rect(0, y, width, 1, 0x42e7ff, 0.05);
  c.glow(width * 0.5, height * 0.34, 420, 0x42e7ff, 0.16);
  c.glow(width * 0.18, height * 0.85, 380, 0xff4db8, 0.12);

  // Spectrum band.
  const bandY = 76, bandH = 10, seg = width / RAINBOW.length;
  RAINBOW.forEach((col, i) => c.roundRect(i * seg + 96, bandY, seg - 8, bandH, 4, col, 0.95));

  // Mark + wordmark.
  const markSize = 176;
  drawMark(canvasAt(c, 108, 140, markSize), markSize, { bg: null, label: 'GD' });
  const titleScale = 13;
  const title = 'GAYDEX';
  c.text(title, 108, 372, titleScale, 0xffffff, { tracking: titleScale * 1.2 });
  const tw = c.textWidth(title, titleScale, titleScale * 1.2);
  c.rect(110, 496, Math.min(width - 220, tw), 4, 0xffc14a, 0.85);
  c.text('CIRCUIT // 19 FORMS // ONE FILE', 110, 524, 3, 0x42e7ff, { tracking: 6 });
  c.text('COMMUNITY SLANG - NOT BIOLOGY - OFFLINE BY DESIGN', 110, 572, 2.4, 0x9aa3c7, { tracking: 5 });
  return encodePng(width, height, c.done());
}

/** Draw a sub-mark at an offset by rendering into a child canvas and copying. */
function canvasAt(parent, x, y, size) {
  const child = canvas(size, size, { supersample: 2 });
  const proxy = Object.create(child);
  // Re-map every drawing call by the offset, then blit through the parent's
  // primitive: simplest reliable route is to draw directly at the offset.
  proxy.rect = (rx, ry, rw, rh, col, a) => parent.rect(x + rx, y + ry, rw, rh, col, a);
  proxy.roundRect = (rx, ry, rw, rh, r, col, a) => parent.roundRect(x + rx, y + ry, rw, rh, r, col, a);
  proxy.poly = (pts, col, a) => parent.poly(pts.map(([px, py]) => [x + px, y + py]), col, a);
  proxy.glow = (cx, cy, r, col, s) => parent.glow(x + cx, y + cy, r, col, s);
  proxy.glyph = (ch, gx, gy, sc, col, a) => parent.glyph(ch, x + gx, y + gy, sc, col, a);
  proxy.text = (str, tx, ty, sc, col, o) => parent.text(str, x + tx, y + ty, sc, col, o);
  proxy.textWidth = child.textWidth;
  return proxy;
}

/* ----------------------------------------------------------------- out --- */

const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

function main() {
  const favicon32 = iconPng(32, { label: 'G' });
  const favicon64 = iconPng(64, { label: 'GD' });
  const touch = iconPng(180, { label: 'GD' });
  const icon512 = iconPng(512, { label: 'GD' });
  const og = ogCardPng();

  mkdirSync(join(ROOT, 'assets'), { recursive: true });
  mkdirSync(join(ROOT, 'src/shell/partials'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/icon-512.png'), icon512);
  writeFileSync(join(ROOT, 'assets/og-card.png'), og);

  // The artifact embeds the small marks as data URIs so the icon works even
  // when the file is opened straight off disk; the deployable social card is
  // referenced relatively because no social scraper reads a data URI.
  const head = [
    `<link rel="icon" type="image/png" sizes="32x32" href="${dataUri(favicon32)}">`,
    `<link rel="icon" type="image/png" sizes="64x64" href="${dataUri(favicon64)}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${dataUri(touch)}">`,
    '<meta name="description" content="GayDex: Circuit — an explorable 3D taxonomy of community slang, with a 19-form dex, lineage atlas, compare deck, evolution lab and a lineage battle simulator. One self-contained HTML file, offline-first, no runtime dependencies.">',
    '<meta name="color-scheme" content="dark">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="GayDex: Circuit">',
    '<meta property="og:description" content="An explorable 3D community-slang taxonomy: 19 forms, lineage atlas, compare deck, evolution lab and a lineage battle simulator — in one self-contained HTML file.">',
    '<meta property="og:image" content="./assets/og-card.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="GayDex: Circuit">',
    '<meta name="twitter:description" content="19 forms, lineage atlas, evolution lab and a lineage battle simulator in a single HTML file.">',
    '<meta name="twitter:image" content="./assets/og-card.png">',
    '<meta name="generator" content="tools/make-icons.mjs — procedurally authored, no third-party art">',
  ].join('\n') + '\n';

  writeFileSync(join(ROOT, 'src/shell/partials/head-icons.html'), head);
  console.log(`favicon 32/64 + touch 180 inlined (${head.length} bytes of head)`);
  console.log(`wrote assets/icon-512.png (${icon512.length} bytes)`);
  console.log(`wrote assets/og-card.png (${og.length} bytes)`);
}

if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) main();
