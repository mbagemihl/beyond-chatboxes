#!/usr/bin/env node
/**
 * copy-litert-wasm.mjs — postinstall step for the pose demo.
 *
 * Hard rule (CLAUDE.md): the LiteRT.js wasm runtime and its JS loaders are
 * served from OUR origin (/wasm/litert/), never a CDN at runtime. This copies
 * the wasm bundle out of node_modules into public/ so `ng build` picks it up as
 * a static asset. Runs automatically via the `postinstall` npm hook.
 *
 * We copy the whole directory: `loadLiteRt('/wasm/litert/')` selects the right
 * variant at runtime (relaxed-SIMD vs compat, threaded, JSPI) by fetching the
 * matching file from that directory, so all variants must be present.
 */
import { existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const src = resolve(projectRoot, 'node_modules/@litertjs/core/wasm');
const dest = resolve(projectRoot, 'public/wasm/litert');

if (!existsSync(src)) {
  // Not a hard failure: `npm ci` without the dep, or a partial install. The
  // build will still run; the demo shows a clear "model/runtime missing" error.
  console.warn(
    `[copy-litert-wasm] source not found: ${src}\n` +
      '  Skipping. Run `npm install @litertjs/core` then re-run this script.',
  );
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const files = readdirSync(dest);
console.log(
  `[copy-litert-wasm] copied ${files.length} file(s) to public/wasm/litert/`,
);
