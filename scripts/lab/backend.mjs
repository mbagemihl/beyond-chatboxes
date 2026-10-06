// backend.mjs — run the Act 1 backend and the frontend, and measure the backend.
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findJava } from './java.mjs';
import { FRONTEND, IS_WIN, LAB, PUBLIC_DIR, REPO_ROOT, c, die, percentile, run } from './util.mjs';

const BACKEND = path.join(REPO_ROOT, 'backend');
const JAR = path.join(BACKEND, 'dist', 'backend.jar');
const GRADLEW = path.join(BACKEND, IS_WIN ? 'gradlew.bat' : 'gradlew');

function requireJava() {
  const java = findJava();
  if (!java) die(`No Java 21 or newer found. Run: ${LAB} jre   (portable runtime, ~45 MB)`);
  return java;
}

/** JAVA_HOME for Gradle, derived from the java we found (…/bin/java → …). */
function javaHomeOf(bin) {
  return path.dirname(path.dirname(bin));
}

/** Act 1: the prepared pose backend, from the prebuilt jar (no Gradle needed). */
export function backend({ port }) {
  const java = requireJava();
  if (existsSync(JAR)) {
    console.log(c.dim(`Java ${java.major}: ${java.bin}`));
    return (
      run(
        java.bin,
        [
          '--enable-native-access=ALL-UNNAMED',
          '-Dai.djl.offline=true',
          '-jar',
          JAR,
          `--server.port=${port}`,
        ],
        { inherit: true },
      ).status ?? 1
    );
  }
  console.log(
    `No ${path.relative(REPO_ROOT, JAR)} (get it from the trainers, or: ${LAB} backend-jar).`,
  );
  console.log('Building and running from source with Gradle instead…');
  return (
    run(GRADLEW, ['bootRun', `--args=--server.port=${port}`], {
      cwd: BACKEND,
      inherit: true,
      env: { JAVA_HOME: javaHomeOf(java.bin) },
    }).status ?? 1
  );
}

/** Maintainers: build the slim workshop jar (the API without the bundled frontend). */
export function backendJar() {
  const java = requireJava();
  const status = run(GRADLEW, ['bootJar', '-Pslim'], {
    cwd: BACKEND,
    inherit: true,
    env: { JAVA_HOME: javaHomeOf(java.bin) },
  }).status;
  if (status !== 0) return status ?? 1;
  mkdirSync(path.dirname(JAR), { recursive: true });
  copyFileSync(path.join(BACKEND, 'build', 'libs', 'app.jar'), JAR);
  console.log(`${c.green('✓')} ${path.relative(REPO_ROOT, JAR)}`);
  return 0;
}

/**
 * `ng serve` on :4200 with /api proxied to the backend on `port`, or to
 * another machine's backend (`backendUrl`, the Act 3 stretch: race over Wi-Fi).
 */
export function frontend({ port, backendUrl }) {
  const install = run('npm', ['install'], { cwd: FRONTEND, inherit: true }).status;
  if (install !== 0) return install ?? 1;
  const env = { BACKEND_PORT: String(port), ...(backendUrl ? { BACKEND_URL: backendUrl } : {}) };
  return run('npx', ['ng', 'serve'], { cwd: FRONTEND, inherit: true, env }).status ?? 1;
}

/**
 * Act 1: how fast is pose estimation when it lives on a server? Sends the
 * workshop still 20 times and prints round trip (what the caller waits for)
 * against server model time (what `predictor.predict` took). The gap is
 * everything that is not the model.
 */
export async function measure({ port, runs = 20 }) {
  const url = `http://localhost:${port}/api/infer/pose`;
  const image = readFileSync(path.join(PUBLIC_DIR, 'fixtures', 'pose-still.jpg'));

  async function infer() {
    const form = new FormData();
    form.append('frame', new Blob([image], { type: 'image/jpeg' }), 'pose-still.jpg');
    const t0 = performance.now();
    const res = await fetch(url, { method: 'POST', body: form });
    const body = await res.json();
    const roundTripMs = performance.now() - t0;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.message ?? JSON.stringify(body)}`);
    return { roundTripMs, serverMs: body.inferenceMs, body };
  }

  let first;
  try {
    first = await infer(); // warmup, not counted (connection setup, JIT)
  } catch (err) {
    die(
      `Could not reach the backend at ${url}: ${err.message}\n  Is it running?  ${LAB} backend${port === 8080 ? '' : ` --port ${port}`}`,
    );
  }
  const roundTrips = [];
  const server = [];
  for (let i = 0; i < runs; i++) {
    const { roundTripMs, serverMs } = await infer();
    roundTrips.push(roundTripMs);
    server.push(serverMs);
  }

  const fmt = (ms) => `${ms.toFixed(1).padStart(6)} ms`;
  const confident = first.body.keypoints.filter((k) => k.score > 0.3).length;
  console.log(`Backend: ${first.body.modelName} (${first.body.backend}), ${runs} requests`);
  console.log(`Keypoints found: ${confident} of ${first.body.keypoints.length} with score > 0.3\n`);
  console.log('                median      p95');
  console.log(
    `  round trip  ${fmt(percentile(roundTrips, 50))} ${fmt(percentile(roundTrips, 95))}`,
  );
  console.log(`  server      ${fmt(percentile(server, 50))} ${fmt(percentile(server, 95))}`);
  console.log('\nWrite down the round-trip median: you will race it in Act 3.');
  return 0;
}
