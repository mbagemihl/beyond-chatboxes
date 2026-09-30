#!/usr/bin/env node
// measure-backend.mjs — Act 1 of the workshop: how fast is pose estimation when
// it lives on a server? Sends the workshop's still image to the running
// backend 20 times and prints the numbers to write down.
//
//   make measure-backend                    (backend on :8080)
//   make measure-backend BACKEND_PORT=9099
//
// Two numbers per request:
//   round trip  what the caller waits for: upload, JPEG decode, inference,
//               response, measured here with performance.now();
//   server      what the backend itself reports as pure model time
//               (`inferenceMs`, timed around predictor.predict()).
// The gap between them is everything that is not the model.
import { readFileSync } from 'node:fs';

const PORT = process.env.BACKEND_PORT || '8080';
const URL_ = `http://localhost:${PORT}/api/infer/pose`;
const IMAGE = new URL('../frontend/public/fixtures/pose-still.jpg', import.meta.url);
const RUNS = 20;

// Same method as frontend/src/app/benchmark/stats.ts (R-7 / PERCENTILE.INC),
// so these numbers compare 1:1 with the /benchmark page.
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

async function infer(image) {
  const form = new FormData();
  form.append('frame', new Blob([image], { type: 'image/jpeg' }), 'pose-still.jpg');
  const t0 = performance.now();
  const res = await fetch(URL_, { method: 'POST', body: form });
  const body = await res.json();
  const roundTripMs = performance.now() - t0;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.message ?? JSON.stringify(body)}`);
  }
  return { roundTripMs, serverMs: body.inferenceMs, body };
}

const image = readFileSync(IMAGE);
let first;
try {
  first = await infer(image); // warmup, not counted (connection setup, JIT)
} catch (err) {
  console.error(`✗ Could not reach the backend at ${URL_}: ${err.message}`);
  console.error(`  Is it running?  make backend${PORT === '8080' ? '' : ` BACKEND_PORT=${PORT}`}`);
  process.exit(1);
}

const roundTrips = [];
const server = [];
for (let i = 0; i < RUNS; i++) {
  const { roundTripMs, serverMs } = await infer(image);
  roundTrips.push(roundTripMs);
  server.push(serverMs);
}

const fmt = (ms) => `${ms.toFixed(1).padStart(6)} ms`;
const confident = first.body.keypoints.filter((k) => k.score > 0.3).length;
console.log(`Backend: ${first.body.modelName} (${first.body.backend}), ${RUNS} requests`);
console.log(`Keypoints found: ${confident} of ${first.body.keypoints.length} with score > 0.3\n`);
console.log('                median      p95');
console.log(`  round trip  ${fmt(percentile(roundTrips, 50))} ${fmt(percentile(roundTrips, 95))}`);
console.log(`  server      ${fmt(percentile(server, 50))} ${fmt(percentile(server, 95))}`);
console.log('\nWrite down the round-trip median: you will race it in Act 3.');
