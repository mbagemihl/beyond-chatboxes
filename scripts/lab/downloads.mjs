// downloads.mjs — fetch every model artifact at SETUP time:  lab download
//
// Hard rule (CLAUDE.md): models are never fetched from a CDN at runtime. Every
// model file is served from our own origin (frontend/public/models/ → /models/).
// This is that build-time fetch, each artifact pinned to an exact URL + sha256,
// so builds are reproducible and offline-safe. The wasm runtimes are not here:
// the frontend's npm postinstall copies them out of node_modules.
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchJre, findJava } from './java.mjs';
import {
  IS_WIN,
  LAB,
  PUBLIC_DIR,
  REPO_ROOT,
  c,
  die,
  download,
  extract,
  fetchVerify,
  rel,
  run,
  sha256File,
} from './util.mjs';

const MODELS = path.join(PUBLIC_DIR, 'models');
const POSE_DIR = path.join(MODELS, 'pose');

function findFile(dir, ext) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, ext);
      if (hit) return hit;
    } else if (entry.name.endsWith(ext)) {
      return p;
    }
  }
  return null;
}

export async function downloadAll() {
  let ok = true;

  // MoveNet SinglePose Lightning, float16 (not int8: int8 coordinate noise shows
  // up as jitter, and int8 graphs only partially delegate to WebGPU). Kaggle
  // Models (TF Hub's successor) serves a gzip'd tar holding one `4.tflite`.
  console.log('==> Pose: MoveNet SinglePose Lightning (float16)');
  const poseModel = path.join(POSE_DIR, 'movenet-singlepose-lightning-f16.tflite');
  const poseSha = '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab';
  if (existsSync(poseModel) && (await sha256File(poseModel)) === poseSha) {
    console.log('  • already present and verified, skipping');
  } else {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'movenet-'));
    try {
      console.log('  • downloading from Kaggle Models…');
      const archive = path.join(tmp, 'movenet.tar.gz');
      await download(
        'https://www.kaggle.com/api/v1/models/google/movenet/tfLite/singlepose-lightning-tflite-float16/1/download',
        archive,
      );
      extract(archive, tmp);
      const tflite = findFile(tmp, '.tflite');
      if (!tflite) die('no .tflite found in the downloaded archive');
      renameSync(tflite, poseModel);
      if ((await sha256File(poseModel)) !== poseSha) {
        rmSync(poseModel, { force: true });
        die('checksum mismatch for the MoveNet tflite');
      }
      console.log(`  ${c.green('✓')} checksum verified → ${rel(poseModel)}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // The same model as ONNX, for the DJL backend of Act 1. Attendees download
  // the converted file; only maintainers ever convert (Python + ~300 MB of
  // TensorFlow, scripts/convert-movenet-onnx.sh). Publish a new conversion with
  //   gh release upload models-v1 frontend/public/models/pose/movenet-singlepose-lightning.onnx --clobber
  // and update the sha256 below.
  console.log('==> Pose (server): MoveNet ONNX for the DJL backend');
  const onnx = path.join(POSE_DIR, 'movenet-singlepose-lightning.onnx');
  if (
    !(await fetchVerify(
      'https://github.com/mbagemihl/beyond-chatboxes/releases/download/models-v1/movenet-singlepose-lightning.onnx',
      onnx,
      '6df9544cadf16fbb033b6d43bd4456d2cf696d76e39f1f7b1e4fc672fc051965',
    ))
  ) {
    const convert = path.join(REPO_ROOT, 'scripts', 'convert-movenet-onnx.sh');
    const converted = !IS_WIN && run('bash', [convert], { inherit: true }).status === 0;
    if (!converted) {
      console.error(
        `  ${c.red('✗')} No server model. ${LAB} backend will answer 503 until ${rel(onnx)} exists.`,
      );
      console.error('    Get it from the trainers, or re-run this online.');
      ok = false;
    }
  }

  // "Squat - exercise demonstration video" by FitnessScape, Wikimedia Commons,
  // CC BY 3.0 (frontend/public/fixtures/ATTRIBUTION.md): the camera-free clip.
  console.log('==> Pose fixture: squat clip by FitnessScape (Wikimedia Commons, CC BY 3.0)');
  ok =
    (await fetchVerify(
      'https://upload.wikimedia.org/wikipedia/commons/5/5c/Squat_-_exercise_demonstration_video.webm',
      path.join(PUBLIC_DIR, 'fixtures', 'pose.webm'),
      '2440985661c3533a4ce78472b0f4577dbdf023aff3f8f9a225bbb5ff8071b1e9',
    )) && ok;

  // Xenova's ONNX export of all-MiniLM-L6-v2. Transformers.js resolves a model
  // id to {localModelPath}/{id}/, hence the exact path. fp32 for WebGPU, q8 for
  // the wasm fallback.
  console.log('==> Semantic search: all-MiniLM-L6-v2 (Xenova ONNX)');
  const emb = path.join(MODELS, 'Xenova', 'all-MiniLM-L6-v2');
  const embBase = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
  for (const [file, sha] of [
    ['config.json', '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7'],
    ['tokenizer.json', 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0'],
    ['tokenizer_config.json', '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'],
    ['onnx/model.onnx', '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e'],
    [
      'onnx/model_quantized.onnx',
      'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
    ],
  ]) {
    ok = (await fetchVerify(`${embBase}/${file}`, path.join(emb, ...file.split('/')), sha)) && ok;
  }

  // Uncompressed tessdata_fast (the OcrService sets gzip: false), pinned to tag
  // 4.1.0.
  console.log('==> Smart form OCR: Tesseract eng + deu language data (tessdata_fast)');
  const tessBase = 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0';
  for (const [file, sha] of [
    ['eng.traineddata', '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'],
    ['deu.traineddata', '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d'],
  ]) {
    ok =
      (await fetchVerify(`${tessBase}/${file}`, path.join(MODELS, 'tesseract', file), sha)) && ok;
  }

  // Not a model, but the same kind of setup-time fetch: a portable Java 21 for
  // the backend, only when the machine has no Java 21+ at all.
  console.log('==> Java for the backend');
  const java = findJava();
  if (java) console.log(`  • found Java ${java.major} (${java.bin}), nothing to download`);
  else await fetchJre();

  console.log(
    ok
      ? '\nlab download: done.'
      : `\n${c.red('lab download: some files are missing (see above).')}`,
  );
  return ok ? 0 : 1;
}
