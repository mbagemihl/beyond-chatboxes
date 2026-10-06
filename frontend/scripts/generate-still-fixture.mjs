// generate-still-fixture.mjs — cuts the still image for the workshop's Act 1 and
// Act 2a (public/fixtures/pose-still.jpg) out of the squat clip that
// download-models.sh fetches (public/fixtures/pose.webm: "Squat - exercise
// demonstration video" by FitnessScape, Wikimedia Commons, CC BY 3.0 — see
// public/fixtures/ATTRIBUTION.md).
//
// Both tiers get this exact file: `lab measure` POSTs it to the
// backend, and /pose/still runs it through LiteRT.js in the browser. There is
// no ffmpeg dependency: headless Chromium (already here for the Playwright
// smoke tests) seeks the video and encodes the frame.
//
// Run from frontend/ after scripts/download-models.sh:
//   node scripts/generate-still-fixture.mjs [seconds]      (default 1.0)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const seconds = Number(process.argv[2] ?? '1.0');
const video = fileURLToPath(new URL('../public/fixtures/pose.webm', import.meta.url));
const out = fileURLToPath(new URL('../public/fixtures/pose-still.jpg', import.meta.url));

// file:// pages are opaque origins; without this flag the frame would taint the
// canvas and toDataURL() would throw.
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.goto(`file://${video}`);
const dataUrl = await page.evaluate(async (t) => {
  const v = document.querySelector('video');
  v.pause();
  await new Promise((resolve, reject) => {
    v.addEventListener('seeked', resolve, { once: true });
    v.addEventListener('error', () => reject(new Error('video failed to load')), { once: true });
    v.currentTime = t;
  });
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}, seconds);
await browser.close();

writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${out} (frame at ${seconds}s)`);
