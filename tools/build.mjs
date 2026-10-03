#!/usr/bin/env node
/**
 * GayDex: Circuit — single-file artifact assembler.
 *
 * The production artifact is `GayDex_Battle_Simulator_SINGLE_FILE.html`.
 * It is GENERATED from the parts in `src/`, `vendor/` and the build manifest
 * below.  Edit the parts, then run:  node tools/build.mjs
 *
 * `--check` rebuilds in memory and fails if the committed artifact is stale.
 * `--roundtrip` rebuilds from the ORIGINAL parts only and verifies the
 *             extraction is byte-for-byte lossless against git history.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { splitPristine, writeParts } from './lib.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'GayDex_Battle_Simulator_SINGLE_FILE.html');

const readRoot = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

/**
 * Ordered script sources.  Classic scripts, concatenated inside one <script>.
 * Order matters: vendor first, then the canonical engine, then the legacy
 * application layer, then the Three.js Circuit presentation lanes.
 */
const SCRIPTS = [
  ['vendor/three.iife.min.js', 'three.js r186 (0.186.1) — vendored, MIT, pinned'],
  ['src/battle-core.js', 'GayDex battle engine — canonical gameplay authority'],
  ['src/app.js', 'GayDex application layer — catalog, persistence, DOM UI'],
  ['src/circuit/00-namespace.js', 'Circuit namespace + shared utilities'],
  ['src/circuit/05-state.js', 'Circuit state adapter — one-way seam to canonical truth'],
  ['src/circuit/10-assets.js', 'Circuit asset pipeline — portrait textures, budgets'],
  ['src/circuit/20-runtime.js', 'Circuit runtime — renderer, camera, lifecycle, quality'],
  ['src/circuit/30-geography.js', 'Circuit geography — districts + evolution routes'],
  ['src/circuit/40-specimens.js', 'Circuit specimens — 2.5D presentation + scanning'],
  ['src/circuit/50-input.js', 'Circuit input — keyboard, pointer, touch, raycasting'],
  ['src/circuit/60-battle3d.js', 'Circuit battle visualisation — consumes engine events'],
  ['src/circuit/70-compare-lab.js', 'Circuit compare ring + spatial Evolution Lab'],
  ['src/circuit/80-circuit-mode.js', 'Circuit mode — lineage series progression + reports'],
  ['src/circuit/90-boot.js', 'Circuit boot — wiring, fallback, startup'],
];

/** Small markup partials inlined into the body at the marked placeholders. */
const PARTIALS = {
  '<!--#circuit-root-->': 'src/shell/partials/circuit-root.html',
};

const PARTS = {
  head: 'src/shell/01-head.html',
  styles: 'src/shell/02-styles.css',
  headClose: 'src/shell/03-head-close.html',
  bodyOpen: 'src/shell/04-body-open.html',
  body: 'src/shell/05-body.html',
  tail: 'src/shell/99-tail.html',
};

export function assemble({ scripts = SCRIPTS, parts = PARTS, banner = true, partials = PARTIALS, read = readRoot } = {}) {
  const chunks = [];
  chunks.push(read(parts.head).replace(/\n$/, ''));
  chunks.push(read(parts.styles).replace(/\n$/, ''));
  chunks.push(read(parts.headClose).replace(/\n$/, ''));
  chunks.push(read(parts.bodyOpen).replace(/\n$/, ''));
  let body = read(parts.body).replace(/\n$/, '');
  for (const [marker, file] of Object.entries(partials)) {
    if (!body.includes(marker)) {
      if (read !== readRoot) continue; // pristine snapshot predates partials
      throw new Error(`missing partial marker ${marker} in ${parts.body}`);
    }
    body = body.replace(marker, read(file).replace(/\n$/, ''));
  }
  chunks.push(body);
  chunks.push('<script>');
  for (const [file, label] of scripts) {
    const body = read(file);
    chunks.push(banner ? `/* ==== ${file} :: ${label} ==== */\n${body}` : body);
  }
    // parts.tail carries the </script> that closes the single inline bundle.
  chunks.push(read(parts.tail).replace(/\n$/, ''));
  return chunks.join('\n');
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const args = process.argv.slice(2);

if (args.includes('--roundtrip')) {
  // Prove the assembler is lossless: split the pristine commit into a
  // throwaway directory, re-assemble from there, compare to the pristine bytes.
  // Independent of whatever `src/` currently contains.
  const { html: original, parts: pristineParts } = splitPristine(ROOT);
  const tmp = mkdtempSync(join(tmpdir(), 'gaydex-roundtrip-'));
  let rebuilt;
  try {
    writeParts(tmp, pristineParts);
    const tmpRead = (...p) => readFileSync(join(tmp, ...p), 'utf8');
    const tmpParts = Object.fromEntries(Object.entries(PARTS).map(([k, v]) => [k, v]));
    rebuilt = assemble({
      scripts: [['src/app.js', 'application layer (pristine)']],
      parts: tmpParts,
      banner: false,
      read: tmpRead,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (rebuilt === original) {
    console.log(`ROUNDTRIP OK — assembler reproduces the pristine artifact exactly (${original.length} bytes, sha ${sha(original)})`);
    process.exit(0);
  }
  let i = 0;
  const n = Math.min(original.length, rebuilt.length);
  while (i < n && original[i] === rebuilt[i]) i++;
  console.error(`ROUNDTRIP MISMATCH at byte ${i} (orig ${original.length} vs rebuilt ${rebuilt.length})`);
  console.error('orig   :', JSON.stringify(original.slice(Math.max(0, i - 80), i + 80)));
  console.error('rebuilt:', JSON.stringify(rebuilt.slice(Math.max(0, i - 80), i + 80)));
  process.exit(1);
}

const html = assemble();
const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return null; } })();

if (args.includes('--check')) {
  if (current === html) {
    console.log(`BUILD CHECK OK — artifact is current (${html.length} bytes, sha ${sha(html)})`);
    process.exit(0);
  }
  console.error('BUILD CHECK FAILED — artifact is stale. Run: node tools/build.mjs');
  process.exit(1);
}

writeFileSync(OUT, html);
console.log(`BUILT ${OUT}`);
console.log(`  bytes ${html.length}  gzip ${gzipSync(html).length}  sha ${sha(html)}`);
console.log(`  scripts: ${SCRIPTS.map((s) => s[0]).join(', ')}`);
