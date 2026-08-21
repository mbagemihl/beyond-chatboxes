#!/usr/bin/env bash
#
# download-models.sh — fetch all ML model artifacts at BUILD TIME.
#
# Hard rule (CLAUDE.md): we never fetch models from a CDN at runtime. Every
# model file, wasm bundle and worker script is served from our own origin —
# frontend/public/models/ (-> /models/) and frontend/public/wasm/ (-> /wasm/).
# This script is that build-time fetch step. Each phase appends the artifacts it
# needs, pinning an exact URL + sha256 so stage builds are reproducible and
# offline-safe.
#
# Note: the LiteRT.js wasm runtime is NOT fetched here — it ships inside the
# `@litertjs/core` npm package and is copied into public/wasm/litert/ by the
# frontend `postinstall` hook (frontend/scripts/copy-litert-wasm.mjs).
#
set -euo pipefail

# Resolve repo root so the script works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="$REPO_ROOT/frontend/public/models"

# --- small helpers -----------------------------------------------------------

# sha256 of a file, portable across macOS (shasum) and Linux (sha256sum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# verify_sha <file> <expected> -> exits non-zero on mismatch
verify_sha() {
  local file="$1" expected="$2" actual
  actual="$(sha256_of "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "  ✗ checksum mismatch for $file" >&2
    echo "    expected: $expected" >&2
    echo "    actual:   $actual" >&2
    return 1
  fi
  echo "  ✓ checksum verified"
}

# fetch_verify <url> <dest> <sha256>
# Idempotent single-file download: skip when already present and verified,
# otherwise download to a temp file, verify, then move into place.
fetch_verify() {
  local url="$1" dest="$2" sha="$3"
  if [[ -f "$dest" ]] && verify_sha "$dest" "$sha" >/dev/null 2>&1; then
    echo "  • $(basename "$dest") already present and verified, skipping"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  local tmp="${dest}.download"
  echo "  • downloading $(basename "$dest")…"
  curl -fSL "$url" -o "$tmp"
  if ! verify_sha "$tmp" "$sha"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$dest"
  chmod 644 "$dest"
}

# =============================================================================
# Pose demo (LiteRT.js) — MoveNet SinglePose Lightning, float16 .tflite
# =============================================================================
#
# Model variant choice: float16 (NOT int8).
#   * Accuracy: the demo derives elbow/knee angles for bowling-approach analysis,
#     so keypoint precision matters. int8 quantization adds coordinate noise that
#     shows up directly as jittery joint angles; float16 stays near-fp32.
#   * WebGPU: the float16 graph delegates fully to LiteRT's WebGPU backend, so the
#     on-stage "webgpu" HUD badge reflects real GPU execution. int8-quantized
#     graphs only partially delegate on WebGPU and silently fall back to wasm.
#   * Size: ~4.7 MB is fine — it is served once from our own origin, not fetched
#     from a CDN at runtime. The ~2 MB int8 saving is not worth the trade-offs.
#
# Source: Kaggle Models (Google) — the successor to TF Hub, which is retired.
#   Model page: https://www.kaggle.com/models/google/movenet (tfLite framework)
# The download endpoint returns a gzip'd tar containing `4.tflite`.

POSE_DIR="$MODELS_DIR/pose"
POSE_MODEL="$POSE_DIR/movenet-singlepose-lightning-f16.tflite"
POSE_URL="https://www.kaggle.com/api/v1/models/google/movenet/tfLite/singlepose-lightning-tflite-float16/1/download"
POSE_SHA256="0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab"

echo "==> Pose: MoveNet SinglePose Lightning (float16)"
if [[ -f "$POSE_MODEL" ]] && verify_sha "$POSE_MODEL" "$POSE_SHA256" 2>/dev/null; then
  echo "  • already present and verified, skipping"
else
  mkdir -p "$POSE_DIR"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "  • downloading from Kaggle Models…"
  curl -fSL "$POSE_URL" -o "$tmp/movenet.tar.gz"
  # Archive contains a single `4.tflite`; extract and rename to a stable name.
  tar -xzf "$tmp/movenet.tar.gz" -C "$tmp"
  extracted="$(find "$tmp" -name '*.tflite' | head -n1)"
  if [[ -z "$extracted" ]]; then
    echo "  ✗ no .tflite found in downloaded archive" >&2
    exit 1
  fi
  mv "$extracted" "$POSE_MODEL"
  chmod 644 "$POSE_MODEL"
  verify_sha "$POSE_MODEL" "$POSE_SHA256"
  echo "  • saved -> ${POSE_MODEL#$REPO_ROOT/}"
fi

# ---------------------------------------------------------------------------
# Pose (server "cloud tier") — MoveNet ONNX, converted from the tflite above so
# the browser (LiteRT.js) and server (DJL/ONNX Runtime) run the SAME model.
# The conversion needs python; it is only required on a box that serves the
# backend cloud tier, so a missing/failed conversion is a WARNING, not fatal —
# the frontend demos still build and run without it.
POSE_ONNX="$POSE_DIR/movenet-singlepose-lightning.onnx"
echo "==> Pose (server): MoveNet ONNX for the DJL cloud tier"
if [[ -f "$POSE_ONNX" ]]; then
  echo "  • already present, skipping"
elif "$SCRIPT_DIR/convert-movenet-onnx.sh"; then
  : # convert-movenet-onnx.sh prints its own progress
else
  echo "  ! ONNX conversion skipped/failed. The backend /api/infer/pose endpoint" >&2
  echo "    will return 503 until it exists. Re-run scripts/convert-movenet-onnx.sh" >&2
  echo "    (needs python3) to enable the benchmark's cloud tier." >&2
fi

# ---------------------------------------------------------------------------
# Pose fixture clip (?fixture=1) — the stage fallback when lighting or camera
# permissions fail. A short CC BY 3.0 squat-demonstration video from Wikimedia
# Commons ("Squat - exercise demonstration video.webm"), full-body and
# MoveNet-friendly. Served from our own origin at /fixtures/pose.webm; like
# every fetched artifact it is not committed. The smart-form fixture
# (receipt.svg) is authored in-repo and needs no download.
FIXTURES_DIR="$REPO_ROOT/frontend/public/fixtures"
POSE_FIXTURE_URL="https://upload.wikimedia.org/wikipedia/commons/5/5c/Squat_-_exercise_demonstration_video.webm"

echo "==> Pose fixture: squat demonstration clip (Wikimedia Commons, CC BY 3.0)"
fetch_verify "$POSE_FIXTURE_URL" "$FIXTURES_DIR/pose.webm" \
  "2440985661c3533a4ce78472b0f4577dbdf023aff3f8f9a225bbb5ff8071b1e9"

# =============================================================================
# Semantic search / smart form (Transformers.js) — all-MiniLM-L6-v2 (ONNX)
# =============================================================================
#
# Xenova's ONNX export of sentence-transformers/all-MiniLM-L6-v2 (384-dim
# sentence embeddings). Transformers.js resolves a model id to files under
# {localModelPath}/{id}/, so these must live at the exact path below; the worker
# sets env.localModelPath = '/models/' and env.allowRemoteModels = false so the
# Hugging Face Hub is never touched at runtime.
#
# Both weight variants are fetched: fp32 (model.onnx) for the WebGPU path and
# q8-quantized (model_quantized.onnx) for the smaller/faster wasm fallback. The
# worker picks the dtype per backend (see embedding.worker.ts).
#
# Note: the ONNX Runtime *wasm* binaries are NOT fetched here — they ship inside
# onnxruntime-web (a Transformers.js dep) and are copied into public/wasm/ort/
# by the frontend `postinstall` hook (frontend/scripts/copy-ort-wasm.mjs).

EMB_DIR="$MODELS_DIR/Xenova/all-MiniLM-L6-v2"
EMB_BASE="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main"

echo "==> Semantic search: all-MiniLM-L6-v2 (Xenova ONNX)"
fetch_verify "$EMB_BASE/config.json" "$EMB_DIR/config.json" \
  "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7"
fetch_verify "$EMB_BASE/tokenizer.json" "$EMB_DIR/tokenizer.json" \
  "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0"
fetch_verify "$EMB_BASE/tokenizer_config.json" "$EMB_DIR/tokenizer_config.json" \
  "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3"
fetch_verify "$EMB_BASE/onnx/model.onnx" "$EMB_DIR/onnx/model.onnx" \
  "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e"
fetch_verify "$EMB_BASE/onnx/model_quantized.onnx" "$EMB_DIR/onnx/model_quantized.onnx" \
  "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1"

# =============================================================================
# Smart form OCR (Tesseract.js) — eng + deu language data
# =============================================================================
#
# Tesseract.js reads {langPath}/{lang}.traineddata at recognize time. The
# OcrService sets langPath = '/models/tesseract/' and gzip = false, so we fetch
# the UNCOMPRESSED tessdata_fast files (LSTM, tuned for speed — right for a live
# demo) and serve them straight from our origin. The Hub / jsDelivr CDN is never
# touched at runtime.
#
# The Tesseract worker script and WebAssembly core are NOT fetched here — they
# ship inside the tesseract.js / tesseract.js-core npm packages and are copied
# into public/wasm/tesseract/ by the frontend `postinstall` hook
# (frontend/scripts/copy-tesseract-wasm.mjs).
#
# Pinned to tessdata_fast tag 4.1.0 for reproducible, offline-safe builds.

TESS_DIR="$MODELS_DIR/tesseract"
TESS_BASE="https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0"

echo "==> Smart form OCR: Tesseract eng + deu language data (tessdata_fast)"
fetch_verify "$TESS_BASE/eng.traineddata" "$TESS_DIR/eng.traineddata" \
  "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
fetch_verify "$TESS_BASE/deu.traineddata" "$TESS_DIR/deu.traineddata" \
  "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d"

echo
echo "download-models.sh: done."
