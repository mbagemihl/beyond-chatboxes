#!/usr/bin/env bash
#
# convert-movenet-onnx.sh — produce the server-side MoveNet ONNX model ONCE,
# from the exact tflite the browser runs, so the LiteRT.js (browser) and
# DJL/ONNX Runtime (server) tiers execute the SAME architecture.
#
# Why convert instead of downloading a pre-made ONNX: converting our own tflite
# guarantees an identical graph and identical pre/post-processing (192x192
# letterbox in, [1,1,17,3] [y,x,score] out). The backend translator
# (MoveNetTranslator.kt) and MoveNet.kt mirror that convention exactly.
#
# Output (uint8 NHWC [1,192,192,3] input, verified against the model signature)
# is written next to the tflite, under our own origin's models dir — NOT a CDN,
# and NOT committed to git (like every model artifact here). Run once at build
# time on any box that will serve the "cloud tier".
#
# Prerequisite: python3 (3.9–3.11). The script creates an isolated venv and
# pins a known-good toolchain (tf2onnx needs numpy < 2; newer numpy removed
# np.cast and breaks the tflite rewriter).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
POSE_DIR="$REPO_ROOT/frontend/public/models/pose"
TFLITE="$POSE_DIR/movenet-singlepose-lightning-f16.tflite"
ONNX="$POSE_DIR/movenet-singlepose-lightning.onnx"
VENV="$SCRIPT_DIR/.venv-onnx"

echo "==> Convert MoveNet tflite -> ONNX (server cloud tier)"

if [[ -f "$ONNX" ]]; then
  echo "  • $(basename "$ONNX") already present, skipping. Delete it to re-convert."
  exit 0
fi

if [[ ! -f "$TFLITE" ]]; then
  echo "  ✗ tflite not found at ${TFLITE#$REPO_ROOT/}" >&2
  echo "    Run scripts/download-models.sh first." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "  ✗ python3 not found. Install Python 3.9–3.11, then re-run." >&2
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "  • creating venv at ${VENV#$REPO_ROOT/} and installing pinned toolchain…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  # Pinned to the versions verified for this repo. numpy MUST stay < 2.
  "$VENV/bin/pip" install --quiet \
    "numpy==1.26.4" \
    "protobuf==3.20.3" \
    "onnx==1.17.0" \
    "tensorflow==2.19.1" \
    "tf2onnx==1.16.1"
fi

echo "  • converting…"
"$VENV/bin/python" -m tf2onnx.convert \
  --tflite "$TFLITE" \
  --output "$ONNX" \
  --opset 13

if [[ ! -f "$ONNX" ]]; then
  echo "  ✗ conversion did not produce $ONNX" >&2
  exit 1
fi

echo "  ✓ wrote ${ONNX#$REPO_ROOT/}"
echo "    The backend reads it via app.pose.model-path (APP_POSE_MODEL_PATH)."
