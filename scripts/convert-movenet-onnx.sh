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
# Prerequisite: Python 3.9–3.12 (found automatically as python3.11 etc., or set
# PYTHON=/path/to/python). The script creates an isolated venv and pins a
# known-good toolchain (tf2onnx needs numpy < 2; newer numpy removed np.cast and
# breaks the tflite rewriter).
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

# Pinned to the versions verified for this repo. numpy MUST stay < 2.
TOOLCHAIN=(
  "numpy==1.26.4"
  "protobuf==3.20.3"
  "onnx==1.17.0"
  "tensorflow==2.19.1"
  "tf2onnx==1.16.1"
)
# Written only after the install succeeds. A venv without it is a leftover from
# an interrupted or failed install (e.g. an unsupported Python) and is rebuilt,
# instead of being mistaken for a working toolchain.
STAMP="$VENV/.toolchain-ok"

# True if the given interpreter is 3.9–3.12: the range numpy 1.26 and
# tensorflow 2.19 publish wheels for. Newer Pythons fail mid-install.
supported_python() {
  "$1" -c 'import sys; sys.exit(0 if (3, 9) <= sys.version_info[:2] <= (3, 12) else 1)' \
    >/dev/null 2>&1
}

# $PYTHON wins; otherwise take the first supported interpreter on PATH, so a
# machine whose default python3 is 3.13+ still works if 3.11 is installed too.
# /usr/bin/python3 comes last: on macOS it is Apple's 3.9, often shadowed on
# PATH by a newer Homebrew python3.
if [[ -n "${PYTHON:-}" ]] && ! supported_python "$PYTHON"; then
  echo "  ✗ PYTHON=$PYTHON is not a Python 3.9–3.12 interpreter." >&2
  exit 1
fi
PY=""
for candidate in ${PYTHON:-} python3.11 python3.10 python3.12 python3.9 python3 /usr/bin/python3; do
  if command -v "$candidate" >/dev/null 2>&1 && supported_python "$candidate"; then
    PY="$(command -v "$candidate")"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "  ✗ No Python 3.9–3.12 found (python3 is $(python3 --version 2>&1 || echo 'missing'))." >&2
  echo "    TensorFlow 2.19 has no wheels for newer Pythons. Install one, e.g.:" >&2
  echo "      brew install python@3.11" >&2
  echo "    then re-run, or point at it: PYTHON=/path/to/python3.11 $0" >&2
  echo "    Workshop attendees do not need this step: it only feeds the" >&2
  echo "    presenter's cloud-tier benchmark." >&2
  exit 1
fi

if [[ ! -f "$STAMP" ]] || [[ "$(cat "$STAMP")" != "${TOOLCHAIN[*]}" ]]; then
  if [[ -d "$VENV" ]]; then
    echo "  • removing incomplete venv at ${VENV#$REPO_ROOT/}"
    rm -rf "$VENV"
  fi
  echo "  • creating venv with $("$PY" --version) and installing pinned toolchain (~300 MB)…"
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet "${TOOLCHAIN[@]}"
  echo "${TOOLCHAIN[*]}" >"$STAMP"
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
