#!/usr/bin/env node
/**
 * One-shot lossless splitter.
 *
 * Materialises the pristine (pre-Circuit) single-file artifact from git commit
 * cbbe7a3 into `src/shell/*` + `src/app.js`, and records it as
 * `tests/fixtures/original-single-file.html` so that:
 *   - `node tools/build.mjs --roundtrip` can prove the assembler is lossless,
 *   - `node tools/extract-original-engine.mjs` can re-derive the ORIGINAL
 *     battle engine as a golden test fixture (provenance: git, not a hand copy).
 *
 * Safe to re-run: existing parts are skipped unless --force.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitPristine } from './lib.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const force = process.argv.includes('--force');

const { html, parts } = splitPristine(ROOT);
const all = [...parts, ['tests/fixtures/original-single-file.html', html]];

for (const [file, content] of all) {
  const abs = join(ROOT, file);
  if (existsSync(abs) && !force) { console.log(`skip (exists): ${file}`); continue; }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  console.log(`wrote ${file} (${content.length} bytes)`);
}
