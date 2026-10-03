/**
 * Shared helper: split the pristine single-file artifact into build parts.
 *
 * Used by `tools/split-original.mjs` (one-shot materialisation into `src/`) and
 * by `tools/build.mjs --roundtrip`, which splits into a throwaway directory and
 * re-assembles it.  Doing the roundtrip against a *fresh* split of the pristine
 * commit — rather than against the live parts — means the check stays a true
 * statement about the assembler even after `src/` has been edited.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PRISTINE_COMMIT = 'cbbe7a32f557f5a4e30424b8df35a79b82a2cf6e';
export const PRISTINE_ARTIFACT = 'GayDex_Battle_Simulator_SINGLE_FILE.html';
/** Committed copy of the pristine artifact, written by tools/split-original.mjs. */
export const PRISTINE_FIXTURE = 'tests/fixtures/original-single-file.html';

/**
 * Resolve the pristine (pre-Circuit) artifact.
 *
 * Git history is the authoritative provenance and is used whenever the object
 * is present.  A shallow clone, an exported tarball or a CI runner that only
 * fetched the branch tip will NOT have commit cbbe7a3 in its object store, so
 * we fall back to the committed byte-identical fixture rather than failing the
 * whole verification suite.  Set GAYDEX_PRISTINE=fixture to force the fixture
 * (used by tests to exercise this path) or =git to require history.
 *
 * @returns {{html:string, source:string}}
 */
export function readPristine(root) {
  const mode = process.env.GAYDEX_PRISTINE || 'auto';
  const fixturePath = join(root, PRISTINE_FIXTURE);
  if (mode !== 'fixture') {
    try {
      const html = execFileSync('git', ['show', `${PRISTINE_COMMIT}:${PRISTINE_ARTIFACT}`], {
        cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { html, source: `git ${PRISTINE_COMMIT.slice(0, 7)}` };
    } catch (err) {
      if (mode === 'git') throw new Error(`GAYDEX_PRISTINE=git but ${PRISTINE_COMMIT} is not available: ${err.message}`);
      if (!existsSync(fixturePath)) {
        throw new Error(`cannot resolve the pristine artifact: commit ${PRISTINE_COMMIT} is not in this clone and ${PRISTINE_FIXTURE} is missing. Run: git fetch origin ${PRISTINE_COMMIT}`);
      }
    }
  }
  if (!existsSync(fixturePath)) throw new Error(`missing pristine fixture ${PRISTINE_FIXTURE}`);
  return { html: readFileSync(fixturePath, 'utf8'), source: PRISTINE_FIXTURE };
}

/** @returns {{html:string, source:string, parts:{file:string,content:string}[]}} */
export function splitPristine(root) {
  const { html, source } = readPristine(root);
  const L = html.split('\n');
  // 1-indexed layout of the pristine file:
  //   1      <!doctype html>
  //   2      <html ...><head>...<title>...</title><style>
  //   3-154  CSS
  //   155    </style></head>
  //   156    <body><template id="battleAvatarAssetStore">…</template>
  //   157-200 markup
  //   201    <script>
  //   202-462 application JS
  //   463    </script></body></html>
  const expect = (cond, msg) => { if (!cond) throw new Error(`pristine layout drift: ${msg}`); };
  expect(L[1].includes('<style>'), 'line 2 missing <style>');
  expect(L[154] === '</style></head>', 'line 155 not </style></head>');
  expect(L[155].startsWith('<body><template id="battleAvatarAssetStore">'), 'line 156 not avatar store');
  expect(L[200] === '<script>', 'line 201 not <script>');
  expect(L[462] === '</script></body></html>', 'line 463 not tail');

  return {
    html,
    source,
    parts: [
      ['src/shell/01-head.html', L.slice(0, 2).join('\n')],
      ['src/shell/02-styles.css', L.slice(2, 154).join('\n')],
      ['src/shell/03-head-close.html', L[154]],
      ['src/shell/04-body-open.html', L[155]],
      ['src/shell/05-body.html', L.slice(156, 200).join('\n')],
      ['src/app.js', L.slice(201, 462).join('\n')],
      ['src/shell/99-tail.html', L[462]],
    ],
  };
}

export function writeParts(dir, parts) {
  for (const [file, content] of parts) {
    const abs = join(dir, file);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}
