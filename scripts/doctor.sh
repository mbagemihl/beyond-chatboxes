#!/usr/bin/env bash
#
# doctor.sh — the workshop environment gate. Run this FIRST, on every attendee
# machine, before anyone writes a line of code:
#
#     make doctor
#
# Why this exists: a room of thirty laptops fails in ways a single stage machine
# never does — half-downloaded model files, an odd Node release, port 4200
# already taken, node_modules missing. Each of those costs the whole room time
# while one person debugs. This script turns all of them into one green/red
# answer, printed the same way for everybody.
#
# Design notes:
#   * Presence AND minimum plausible size are checked, not checksums. The real
#     workshop failure is a TRUNCATED artifact (interrupted download), which a
#     size floor catches instantly and offline. Full sha256 verification lives
#     in download-models.sh, which already verifies-and-skips; this script
#     prints that command rather than duplicating the hashes here (two copies
#     of a hash list is a maintenance trap).
#   * The lab starts on the JVM (Act 1) and races it in Act 3, so the backend
#     is REQUIRED: a JDK 21+, the prebuilt jar and the server ONNX model are
#     blocking checks, like Node and the browser models.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/frontend/public"

# --- output helpers ----------------------------------------------------------

if [[ -t 1 ]]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; AMBER=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
else
  GREEN=""; RED=""; AMBER=""; DIM=""; BOLD=""; OFF=""
fi

FAILURES=0
WARNINGS=0
# Remediation lines are collected and reprinted at the end, so an attendee sees
# every fix in one block instead of scrolling back through the whole report.
declare -a FIX_LINES=()

ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$OFF" "$1"; FAILURES=$((FAILURES + 1)); [[ $# -gt 1 ]] && FIX_LINES+=("$2"); return 0; }
warn() { printf '  %s!%s %s\n' "$AMBER" "$OFF" "$1"; WARNINGS=$((WARNINGS + 1)); return 0; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$OFF"; }
head2(){ printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

# human_size <bytes>
human_size() {
  local b="$1"
  if   (( b >= 1048576 )); then printf '%d MB' $(( b / 1048576 ))
  elif (( b >= 1024 ));    then printf '%d kB' $(( b / 1024 ))
  else printf '%d B' "$b"; fi
}

# size_of <file> -> bytes (0 when absent); portable across macOS and Linux.
size_of() {
  [[ -f "$1" ]] || { echo 0; return; }
  if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi
}

# require_file <path> <min_bytes> <label> <fix>
# Fails when missing, and ALSO when smaller than the floor — that is the
# signature of an interrupted download, which otherwise shows up much later as
# an unreadable-model error inside the browser.
require_file() {
  local path="$1" min="$2" label="$3" fix="$4"
  local bytes; bytes="$(size_of "$path")"
  if (( bytes == 0 )); then
    bad "$label — missing" "$fix"
  elif (( bytes < min )); then
    bad "$label — only $(human_size "$bytes"), expected ≥ $(human_size "$min") (truncated download)" "$fix"
  else
    ok "$label ($(human_size "$bytes"))"
  fi
}

# require_glob <dir> <pattern> <min_bytes> <label> <fix>
# The ML runtimes are handed a DIRECTORY and choose a build at load time
# (litert/ort/tesseract each ship several), so pin the directory contents rather
# than a specific variant filename.
require_glob() {
  local dir="$1" pattern="$2" min="$3" label="$4" fix="$5"
  local biggest=0 bytes
  if [[ -d "$dir" ]]; then
    while IFS= read -r f; do
      bytes="$(size_of "$f")"
      (( bytes > biggest )) && biggest="$bytes"
    done < <(find "$dir" -maxdepth 1 -name "$pattern" -type f 2>/dev/null)
  fi
  if (( biggest == 0 )); then
    bad "$label — none found in ${dir#$REPO_ROOT/}" "$fix"
  elif (( biggest < min )); then
    bad "$label — largest is $(human_size "$biggest"), expected ≥ $(human_size "$min")" "$fix"
  else
    ok "$label"
  fi
}

# optional_file <path> <label> <why>
optional_file() {
  local path="$1" label="$2" why="$3"
  if [[ -f "$path" ]]; then ok "$label ($(human_size "$(size_of "$path")"))"
  else warn "$label — absent. $why"; fi
}

printf '%sBeyond the Chatbox — workshop environment check%s\n' "$BOLD" "$OFF"
printf '%s%s%s\n' "$DIM" "$REPO_ROOT" "$OFF"

# =============================================================================
head2 "Toolchain"
# =============================================================================

if command -v node >/dev/null 2>&1; then
  NODE_RAW="$(node --version)"          # e.g. v22.14.0
  NODE_MAJOR="${NODE_RAW#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
  if (( NODE_MAJOR < 22 )); then
    bad "Node $NODE_RAW — too old, need 22 or newer" "Install Node 22 or 24 LTS (nodejs.org, nvm, or brew)."
  elif (( NODE_MAJOR % 2 == 1 )); then
    # Odd majors never reach LTS; Angular emits EBADENGINE and support is thin.
    warn "Node $NODE_RAW — odd-numbered release, not LTS"
    note "Builds pass, but 22 or 24 LTS is the supported pair for this workshop."
  else
    ok "Node $NODE_RAW"
  fi
else
  bad "Node — not installed" "Install Node 22 or 24 LTS from nodejs.org (or via nvm/brew)."
fi

if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version)"
else bad "npm — not installed" "npm ships with Node; reinstall Node."; fi

# node_modules is ~755 MB and the single slowest thing to obtain in a room, so
# check it explicitly instead of letting `ng serve` fail later.
if [[ -d "$REPO_ROOT/frontend/node_modules/@angular/core" ]]; then
  ok "frontend dependencies installed"
else
  bad "frontend/node_modules — missing or incomplete" \
      "Copy the pre-seeded folder from the workshop USB, or run: cd frontend && npm install"
fi

# =============================================================================
head2 "Models and runtimes (served from our own origin — never a CDN)"
# =============================================================================

require_file "$PUBLIC_DIR/models/pose/movenet-singlepose-lightning-f16.tflite" \
  4000000 "MoveNet pose model (tflite, f16)" \
  "Run: scripts/download-models.sh"

MINILM="$PUBLIC_DIR/models/Xenova/all-MiniLM-L6-v2"
require_file "$MINILM/onnx/model_quantized.onnx" 20000000 \
  "MiniLM embeddings (q8 — the wasm path)" "Run: scripts/download-models.sh"
require_file "$MINILM/tokenizer.json" 100000 "MiniLM tokenizer" "Run: scripts/download-models.sh"
require_file "$MINILM/config.json" 200 "MiniLM config" "Run: scripts/download-models.sh"
optional_file "$MINILM/onnx/model.onnx" "MiniLM embeddings (fp32 — the WebGPU path)" \
  "Without it, machines WITH WebGPU fall back to the q8/wasm path."

require_file "$PUBLIC_DIR/models/tesseract/eng.traineddata" 2000000 \
  "Tesseract English language data" "Run: scripts/download-models.sh"
optional_file "$PUBLIC_DIR/models/tesseract/deu.traineddata" \
  "Tesseract German language data" "Only needed for German receipts."

require_glob "$PUBLIC_DIR/wasm/litert" "*.wasm" 5000000 \
  "LiteRT.js wasm runtime" "Run: cd frontend && npm install (the postinstall hook copies it)"
require_glob "$PUBLIC_DIR/wasm/ort" "*.wasm" 5000000 \
  "ONNX Runtime wasm" "Run: cd frontend && npm install (the postinstall hook copies it)"
require_glob "$PUBLIC_DIR/wasm/tesseract" "*.wasm" 2000000 \
  "Tesseract wasm core" "Run: cd frontend && npm install (the postinstall hook copies it)"
require_file "$PUBLIC_DIR/wasm/tesseract/worker.min.js" 10000 \
  "Tesseract worker script" "Run: cd frontend && npm install"

# =============================================================================
head2 "Fixtures (the camera-free fallback every exercise can run on)"
# =============================================================================

require_file "$PUBLIC_DIR/fixtures/pose.webm" 100000 "Pose fixture clip" \
  "Run: scripts/download-models.sh"
require_file "$PUBLIC_DIR/fixtures/pose-still.jpg" 20000 "Pose still image (Acts 1 and 2a)" \
  "Ships with the repo — re-check out the file if it vanished."
require_file "$PUBLIC_DIR/fixtures/receipt.svg" 500 "Smart-form fixture receipt" \
  "Ships with the repo — re-check out the file if it vanished."

# =============================================================================
head2 "Ports"
# =============================================================================

# port_busy <port> — true when something is LISTENing.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    # No lsof (some Linux images): fall back to a connect attempt.
    (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
  fi
}

if port_busy 4200; then
  bad "Port 4200 is already in use — the dev server cannot start" \
      "Stop whatever holds it (lsof -nP -iTCP:4200 -sTCP:LISTEN), or serve on another port: npx ng serve --port 4300"
else
  ok "Port 4200 free (Angular dev server)"
fi

# The backend port. VM and container proxies love to squat :8080, so it can be
# moved; if it is taken by our own backend (already started), that is fine.
BACKEND_PORT="${BACKEND_PORT:-8080}"
if port_busy "$BACKEND_PORT"; then
  if curl -fsS "http://localhost:$BACKEND_PORT/api/health" 2>/dev/null | grep -q '"UP"'; then
    ok "Port $BACKEND_PORT: the workshop backend is already running there"
  else
    bad "Port $BACKEND_PORT is in use by something else (often a VM/container proxy)" \
        "Move the backend: make backend BACKEND_PORT=9099, and start the frontend with make dev-frontend BACKEND_PORT=9099 (then re-run: BACKEND_PORT=9099 make doctor)"
  fi
else
  ok "Port $BACKEND_PORT free (pose backend)"
fi

# =============================================================================
head2 "Act 1 — the pose backend (Spring Boot + DJL)"
# =============================================================================

# The same `java` that `make backend` uses: the pinned SDKMAN JDK 21 if it is
# there, otherwise whatever is on PATH. Any JDK 21 or newer runs the jar.
JDK21="${JDK21:-$HOME/.sdkman/candidates/java/21.0.2-open}"
if [[ -x "$JDK21/bin/java" ]]; then
  JAVA_BIN="$JDK21/bin/java"
else
  JAVA_BIN="$(command -v java || true)"
fi
JAVA_MAJOR=0
if [[ -n "$JAVA_BIN" ]]; then
  JDK_VER="$("$JAVA_BIN" -version 2>&1 | head -1)"
  JAVA_MAJOR="$(printf '%s' "$JDK_VER" | sed -nE 's/.*version "([0-9]+).*/\1/p')"
  JAVA_MAJOR="${JAVA_MAJOR:-0}"
fi
if (( JAVA_MAJOR >= 21 )); then
  ok "Java $JAVA_MAJOR ($JAVA_BIN)"
elif [[ -n "$JAVA_BIN" ]]; then
  bad "Java is too old — $JDK_VER (need 21 or newer)" \
      "Install a JDK 21 (e.g. sdk install java 21.0.2-open, or the installer on the workshop USB stick)"
else
  bad "No Java found (need JDK 21 or newer)" \
      "Install a JDK 21 (e.g. sdk install java 21.0.2-open, or the installer on the workshop USB stick)"
fi

require_file "$REPO_ROOT/backend/dist/backend.jar" 100000000 "Prebuilt backend (backend/dist/backend.jar)" \
  "Copy backend/dist/backend.jar from the workshop USB stick (or, online: make backend-jar)"
require_file "$PUBLIC_DIR/models/pose/movenet-singlepose-lightning.onnx" 9000000 \
  "Server-side pose model (ONNX)" \
  "Run: scripts/download-models.sh (or copy frontend/public/models/pose/ from the USB stick)"

# =============================================================================
head2 "Checks only a browser can answer"
# =============================================================================

note "WebGPU cannot be detected from a shell. Start the app and read the HUD badge:"
note "  make backend   and   make dev-frontend   →   http://localhost:4200/pose/still"
note "A badge reading 'wasm' instead of 'webgpu' is FINE — the fallback is part of the story."
note "For full sha256 verification of every artifact (offline when all are present):"
note "  scripts/download-models.sh"

# =============================================================================
# Summary
# =============================================================================

printf '\n%s────────────────────────────────────────────────────────%s\n' "$DIM" "$OFF"
if (( FAILURES == 0 )); then
  printf '%s✓ READY%s — %d warning(s). You can start the workshop.\n' "$GREEN$BOLD" "$OFF" "$WARNINGS"
  exit 0
fi

printf '%s✗ NOT READY%s — %d blocking problem(s), %d warning(s).\n' "$RED$BOLD" "$OFF" "$FAILURES" "$WARNINGS"
printf '\n%sFix these, then re-run make doctor:%s\n' "$BOLD" "$OFF"
# De-duplicate: one missing download usually trips several checks at once.
printf '%s\n' "${FIX_LINES[@]}" | sort -u | sed 's/^/  • /'
exit 1
