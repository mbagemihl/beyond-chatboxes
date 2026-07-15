#!/usr/bin/env bash
#
# download-models.sh — fetch all ML model artifacts at BUILD TIME.
#
# Hard rule (CLAUDE.md): we never fetch models from a CDN at runtime. Every
# model file, wasm bundle and worker script is served from our own origin —
# frontend/public/models/ (-> /models/) and frontend/public/wasm/ (-> /wasm/).
# This script is that build-time fetch step. It is intentionally a STUB for now;
# each later phase appends the artifacts it needs.
#
# Planned artifacts (added by later phases — do NOT pre-fetch here yet):
#
#   Pose demo (LiteRT.js)
#     - MoveNet SinglePose (Lightning/Thunder) .tflite model  -> /models/pose/
#     - LiteRT wasm runtime + worker                          -> /wasm/litert/
#
#   Semantic search / smart form (Transformers.js)
#     - Sentence-embedding model, e.g. all-MiniLM-L6-v2 (ONNX) -> /models/embeddings/
#     - onnxruntime-web wasm bundles                           -> /wasm/ort/
#
#   OCR demo (Tesseract.js)
#     - eng.traineddata (+ any extra languages)                -> /models/tesseract/
#     - tesseract-core wasm + worker script                    -> /wasm/tesseract/
#
# Each addition should pin an exact version/URL and verify a checksum so stage
# builds are reproducible and offline-safe.

set -euo pipefail

echo "download-models.sh: nothing to fetch yet (stub). Models are added in later phases."
