#!/usr/bin/env node
/**
 * copy-tesseract-wasm.mjs — postinstall step for the smart-form OCR demo.
 *
 * Hard rule (CLAUDE.md): the Tesseract.js worker script and its WebAssembly core
 * are served from OUR origin (/wasm/tesseract/), never a CDN at runtime. By
 * default tesseract.js fetches worker.min.js and the core from jsDelivr; we
 * point `workerPath` + `corePath` at /wasm/tesseract/ (see ocr.service.ts) and
 * copy the matching files out of node_modules so `ng build` serves them as
 * static assets. Language data (eng/deu .traineddata) is a separate, larger
 * artifact fetched by scripts/download-models.sh into /models/tesseract/.
 *
 * We copy every core variant (.wasm + its .wasm.js glue) so the worker can pick
 * whichever build the browser supports at runtime — SIMD / relaxed-SIMD / plain,
 * and the smaller LSTM-only variants.
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const dest = resolve(projectRoot, 'public/wasm/tesseract');

const workerSrc = resolve(projectRoot, 'node_modules/tesseract.js/dist/worker.min.js');
const coreSrc = resolve(projectRoot, 'node_modules/tesseract.js-core');

if (!existsSync(workerSrc) || !existsSync(coreSrc)) {
  // Not a hard failure: `npm ci` without the dep, or a partial install. The
  // build still runs; the demo shows a clear "runtime/model missing" error.
  console.warn(
    '[copy-tesseract-wasm] tesseract.js sources not found under node_modules.\n' +
      '  Skipping. Run `npm install tesseract.js` then re-run this script.',
  );
  process.exit(0);
}

mkdirSync(dest, { recursive: true });

// The worker script the main thread spins up (workerPath).
copyFileSync(workerSrc, join(dest, 'worker.min.js'));

// Every core variant (corePath is this directory; the worker selects a variant).
const wanted = /^tesseract-core.*\.(wasm|wasm\.js)$/;
const cores = readdirSync(coreSrc).filter((f) => wanted.test(f));
for (const file of cores) {
  copyFileSync(join(coreSrc, file), join(dest, file));
}

console.log(
  `[copy-tesseract-wasm] copied worker.min.js + ${cores.length} core file(s) to public/wasm/tesseract/`,
);
