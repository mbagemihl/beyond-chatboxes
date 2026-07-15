#!/usr/bin/env node
/**
 * copy-ort-wasm.mjs — postinstall step for the semantic-search / OCR demos.
 *
 * Hard rule (CLAUDE.md): the ONNX Runtime Web wasm binaries that Transformers.js
 * loads are served from OUR origin (/wasm/ort/), never a CDN at runtime. By
 * default onnxruntime-web fetches these from jsDelivr; we point
 * `env.backends.onnx.wasm.wasmPaths` at /wasm/ort/ (see embedding.worker.ts) and
 * copy the matching files out of node_modules so `ng build` serves them as
 * static assets. Runs automatically via the `postinstall` npm hook.
 *
 * We copy the `ort-wasm-simd-threaded*` variant set (.wasm + .mjs glue) so the
 * runtime finds whichever build it selects (SIMD+threads, JSEP for WebGPU, JSPI)
 * next to the path we configured.
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const src = resolve(projectRoot, 'node_modules/onnxruntime-web/dist');
const dest = resolve(projectRoot, 'public/wasm/ort');

if (!existsSync(src)) {
  // Not a hard failure: `npm ci` without the dep, or a partial install. The
  // build still runs; the demo shows a clear "runtime/model missing" error.
  console.warn(
    `[copy-ort-wasm] source not found: ${src}\n` +
      '  Skipping. Run `npm install @huggingface/transformers` then re-run.',
  );
  process.exit(0);
}

mkdirSync(dest, { recursive: true });

// Only the threaded runtime variants Transformers.js can select at runtime.
const wanted = /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/;
const copied = readdirSync(src).filter((f) => wanted.test(f));
for (const file of copied) {
  copyFileSync(join(src, file), join(dest, file));
}

console.log(`[copy-ort-wasm] copied ${copied.length} file(s) to public/wasm/ort/`);
