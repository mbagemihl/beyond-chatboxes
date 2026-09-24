// generate-ocr-fixture.mjs — records what Tesseract really returns for the
// bundled receipt (public/fixtures/receipt.svg) for ocr-layout.spec.ts: the flat
// text plus every word with its confidence and bounding box. The spec then runs
// the layout + calibration logic on genuine model output, not hand-made boxes.
//
// Rasterizes the SVG with Playwright's Chromium at its natural size (as the
// demo's capture canvas does), then OCRs it with the same languages and the
// self-hosted traineddata the browser uses. Run from frontend/:
//   node scripts/generate-ocr-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { OEM, createWorker } from 'tesseract.js';

const svgPath = new URL('../public/fixtures/receipt.svg', import.meta.url);
const svg = readFileSync(svgPath, 'utf8');
const [, width, height] = svg.match(/width="(\d+)" height="(\d+)"/).map(Number);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
const png = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
await browser.close();

const worker = await createWorker(['eng', 'deu'], OEM.LSTM_ONLY, {
  langPath: new URL('../public/models/tesseract/', import.meta.url).pathname,
  gzip: false,
  cacheMethod: 'none',
});
const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
await worker.terminate();

const words = data.blocks.flatMap((b) =>
  b.paragraphs.flatMap((p) =>
    p.lines.flatMap((l) =>
      l.words.map((w) => ({
        text: w.text,
        confidence: Math.round(w.confidence * 10) / 10,
        bbox: w.bbox,
      })),
    ),
  ),
);
const out = new URL('../src/app/demos/smartform/ocr-layout.fixture.json', import.meta.url);
writeFileSync(out, JSON.stringify({ text: data.text, words }, null, 1) + '\n');
console.log(`wrote ${out.pathname} (${words.length} words)`);
