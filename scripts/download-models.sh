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
# Still planned (added by later phases — do NOT pre-fetch here yet):
#   OCR demo (Tesseract.js)
#     - eng.traineddata (+ any extra languages)                -> /models/tesseract/

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

echo
echo "download-models.sh: done."
