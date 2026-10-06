// doctor.mjs — the workshop environment gate. Run it FIRST, on every attendee
// machine, before anyone writes a line of code:  lab doctor
//
// A room of thirty laptops fails in ways a single stage machine never does:
// half-downloaded model files, an odd Node release, a port already taken,
// node_modules missing. Each of those costs the whole room time while one
// person debugs. This turns all of them into one green/red answer, printed the
// same way for everybody, on every operating system.
//
// Presence AND minimum plausible size are checked, not checksums: the real
// workshop failure is a TRUNCATED download, which a size floor catches
// instantly and offline. Full sha256 verification is `lab download`.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findJava } from './java.mjs';
import {
  FRONTEND,
  LAB,
  PUBLIC_DIR,
  REPO_ROOT,
  backendUp,
  c,
  humanSize,
  portBusy,
  rel,
  run,
  sizeOf,
} from './util.mjs';

export async function doctor({ port = Number(process.env.BACKEND_PORT ?? 8080) } = {}) {
  let failures = 0;
  let warnings = 0;
  const fixes = new Set();

  const ok = (msg) => console.log(`  ${c.green('✓')} ${msg}`);
  const bad = (msg, fix) => {
    failures++;
    console.log(`  ${c.red('✗')} ${msg}`);
    if (fix) fixes.add(fix);
  };
  const warn = (msg) => {
    warnings++;
    console.log(`  ${c.amber('!')} ${msg}`);
  };
  const note = (msg) => console.log(`    ${c.dim(msg)}`);
  const head = (title) => console.log(`\n${c.bold(title)}`);

  const DOWNLOAD = `Run: ${LAB} download`;
  const NPM_INSTALL = 'Run: cd frontend && npm install (the postinstall hook copies it)';
  const IN_REPO = 'Ships with the repo — re-check out the file if it vanished.';

  // Fails when missing, and ALSO when smaller than the floor: the signature of
  // an interrupted download, which otherwise surfaces later in the browser.
  const requireFile = (file, min, label, fix) => {
    const bytes = sizeOf(file);
    if (bytes === 0) bad(`${label} — missing`, fix);
    else if (bytes < min)
      bad(
        `${label} — only ${humanSize(bytes)}, expected ≥ ${humanSize(min)} (truncated download)`,
        fix,
      );
    else ok(`${label} (${humanSize(bytes)})`);
  };
  // The ML runtimes are handed a DIRECTORY and pick a build at load time, so
  // pin the directory contents rather than one variant's file name.
  const requireGlob = (dir, ext, min, label, fix) => {
    let biggest = 0;
    try {
      for (const f of readdirSync(dir))
        if (f.endsWith(ext)) biggest = Math.max(biggest, sizeOf(path.join(dir, f)));
    } catch {
      /* missing dir: biggest stays 0 */
    }
    if (biggest === 0) bad(`${label} — none found in ${rel(dir)}`, fix);
    else if (biggest < min)
      bad(`${label} — largest is ${humanSize(biggest)}, expected ≥ ${humanSize(min)}`, fix);
    else ok(label);
  };
  const optionalFile = (file, label, why) => {
    if (existsSync(file)) ok(`${label} (${humanSize(sizeOf(file))})`);
    else warn(`${label} — absent. ${why}`);
  };

  console.log(c.bold('Beyond the Chatbox — workshop environment check'));
  console.log(c.dim(REPO_ROOT));

  head('Toolchain');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22)
    bad(
      `Node ${process.version} — too old, need 22 or newer`,
      'Install Node 22 or 24 LTS from nodejs.org.',
    );
  else if (nodeMajor % 2 === 1) {
    warn(`Node ${process.version} — odd-numbered release, not LTS`);
    note('Builds pass, but 22 or 24 LTS is the supported pair for this workshop.');
  } else ok(`Node ${process.version}`);

  const npm = run('npm', ['--version']);
  if (npm.status === 0) ok(`npm ${npm.stdout.trim()}`);
  else bad('npm — not found', 'npm ships with Node; reinstall Node from nodejs.org.');

  const gitV = run('git', ['--version']);
  if (gitV.status === 0) ok(gitV.stdout.trim());
  else bad('git — not found', 'Install Git (Windows: Git for Windows, git-scm.com).');

  // node_modules is the single slowest thing to obtain in a room: check it
  // explicitly instead of letting `ng serve` fail later.
  if (existsSync(path.join(FRONTEND, 'node_modules', '@angular', 'core')))
    ok('frontend dependencies installed');
  else bad('frontend/node_modules — missing or incomplete', 'Run: cd frontend && npm install');

  head('Models and runtimes (served from our own origin — never a CDN)');
  requireFile(
    path.join(PUBLIC_DIR, 'models/pose/movenet-singlepose-lightning-f16.tflite'),
    4_000_000,
    'MoveNet pose model (tflite, f16)',
    DOWNLOAD,
  );
  const minilm = path.join(PUBLIC_DIR, 'models/Xenova/all-MiniLM-L6-v2');
  requireFile(
    path.join(minilm, 'onnx/model_quantized.onnx'),
    20_000_000,
    'MiniLM embeddings (q8 — the wasm path)',
    DOWNLOAD,
  );
  requireFile(path.join(minilm, 'tokenizer.json'), 100_000, 'MiniLM tokenizer', DOWNLOAD);
  requireFile(path.join(minilm, 'config.json'), 200, 'MiniLM config', DOWNLOAD);
  optionalFile(
    path.join(minilm, 'onnx/model.onnx'),
    'MiniLM embeddings (fp32 — the WebGPU path)',
    'Without it, machines WITH WebGPU fall back to the q8/wasm path.',
  );
  requireFile(
    path.join(PUBLIC_DIR, 'models/tesseract/eng.traineddata'),
    2_000_000,
    'Tesseract English language data',
    DOWNLOAD,
  );
  optionalFile(
    path.join(PUBLIC_DIR, 'models/tesseract/deu.traineddata'),
    'Tesseract German language data',
    'Only needed for German receipts.',
  );
  requireGlob(
    path.join(PUBLIC_DIR, 'wasm/litert'),
    '.wasm',
    5_000_000,
    'LiteRT.js wasm runtime',
    NPM_INSTALL,
  );
  requireGlob(
    path.join(PUBLIC_DIR, 'wasm/ort'),
    '.wasm',
    5_000_000,
    'ONNX Runtime wasm',
    NPM_INSTALL,
  );
  requireGlob(
    path.join(PUBLIC_DIR, 'wasm/tesseract'),
    '.wasm',
    2_000_000,
    'Tesseract wasm core',
    NPM_INSTALL,
  );
  requireFile(
    path.join(PUBLIC_DIR, 'wasm/tesseract/worker.min.js'),
    10_000,
    'Tesseract worker script',
    'Run: cd frontend && npm install',
  );

  head('Fixtures (the camera-free fallback every exercise can run on)');
  requireFile(path.join(PUBLIC_DIR, 'fixtures/pose.webm'), 100_000, 'Pose fixture clip', DOWNLOAD);
  requireFile(
    path.join(PUBLIC_DIR, 'fixtures/pose-still.jpg'),
    20_000,
    'Pose still image (Acts 1 and 2a)',
    IN_REPO,
  );
  requireFile(
    path.join(PUBLIC_DIR, 'fixtures/receipt.svg'),
    500,
    'Smart-form fixture receipt',
    IN_REPO,
  );

  head('Ports');
  if (await portBusy(4200)) {
    bad(
      'Port 4200 is already in use — the dev server cannot start',
      'Stop whatever holds port 4200 (another ng serve?), or serve on another port: cd frontend && npx ng serve --port 4300',
    );
  } else ok('Port 4200 free (Angular dev server)');
  // VM and container proxies love to squat :8080, so the backend can move; if
  // our own backend is already running there, that is fine.
  if (await portBusy(port)) {
    if (await backendUp(port)) ok(`Port ${port}: the workshop backend is already running there`);
    else
      bad(
        `Port ${port} is in use by something else (often a VM/container proxy)`,
        `Move the backend: ${LAB} backend --port 9099, start the frontend with ${LAB} frontend --port 9099, then re-run: ${LAB} doctor --port 9099`,
      );
  } else ok(`Port ${port} free (pose backend)`);

  head('Act 1 — the pose backend (Spring Boot + DJL)');
  // The same java `lab backend` uses. Any release 21 or newer runs the jar.
  const java = findJava();
  if (java) {
    const where = java.portable ? 'portable runtime in .tools/jre' : java.bin;
    ok(`Java ${java.major} (${where})`);
  } else {
    bad(
      'No Java 21 or newer found',
      `Run: ${LAB} jre (downloads a portable Java 21 runtime, ~45 MB), or install any JDK 21 or newer`,
    );
  }
  requireFile(
    path.join(REPO_ROOT, 'backend/dist/backend.jar'),
    100_000_000,
    'Prebuilt backend (backend/dist/backend.jar)',
    `Get backend/dist/backend.jar from the trainers (or, online: ${LAB} backend-jar)`,
  );
  requireFile(
    path.join(PUBLIC_DIR, 'models/pose/movenet-singlepose-lightning.onnx'),
    9_000_000,
    'Server-side pose model (ONNX)',
    DOWNLOAD,
  );

  head('Checks only a browser can answer');
  note('WebGPU cannot be detected from a shell. Start the app and read the HUD badge:');
  note(`  ${LAB} backend   and   ${LAB} frontend   →   http://localhost:4200/pose/still`);
  note("A badge reading 'wasm' instead of 'webgpu' is FINE — the fallback is part of the story.");
  note(
    `For full sha256 verification of every artifact (offline when all are present): ${LAB} download`,
  );

  console.log(`\n${c.dim('────────────────────────────────────────────────────────')}`);
  if (failures === 0) {
    console.log(
      `${c.green(c.bold('✓ READY'))} — ${warnings} warning(s). You can start the workshop.`,
    );
    return 0;
  }
  console.log(
    `${c.red(c.bold('✗ NOT READY'))} — ${failures} blocking problem(s), ${warnings} warning(s).`,
  );
  console.log(`\n${c.bold(`Fix these, then re-run ${LAB} doctor:`)}`);
  for (const fix of fixes) console.log(`  • ${fix}`);
  return 1;
}
