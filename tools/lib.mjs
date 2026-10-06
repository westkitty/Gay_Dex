/**
 * Shared helper: split the pristine single-file artifact into build parts.
 *
 * Used by `tools/split-original.mjs` (one-shot materialisation into `src/`) and
 * by `tools/build.mjs --roundtrip`, which splits into a throwaway directory and
 * re-assembles it. Doing the roundtrip against a fresh pristine snapshot —
 * rather than the live parts — keeps the check meaningful after `src/` changes.
 * Shallow checkouts may not contain the pinned Git object, so the checked-in
 * original HTML fixture is the offline fallback for the same snapshot.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PRISTINE_COMMIT = 'cbbe7a32f557f5a4e30424b8df35a79b82a2cf6e';
export const PRISTINE_ARTIFACT = 'GayDex_Battle_Simulator_SINGLE_FILE.html';

/** @returns {{file:string,content:string}[]} */
export function splitPristine(root) {
  let html;
  try {
    html = execFileSync('git', ['show', `${PRISTINE_COMMIT}:${PRISTINE_ARTIFACT}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    const fixture = join(root, 'tests/fixtures/original-single-file.html');
    if (!existsSync(fixture)) {
      throw new Error(`cannot load pinned original from Git or fixture: ${error.message}`);
    }
    html = readFileSync(fixture, 'utf8');
  }
  const L = html.split('\n');
  // 1-indexed layout of the pinned original file:
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
