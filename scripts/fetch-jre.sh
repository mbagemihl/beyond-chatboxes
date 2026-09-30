#!/usr/bin/env bash
#
# fetch-jre.sh — download a portable Java 21 runtime into .tools/jre, for
# machines without any Java 21+ (the backend jar runs on it; nothing is
# installed system-wide, and nothing is committed to git).
#
#   make jre                          (or: scripts/fetch-jre.sh)
#
# Eclipse Temurin JRE 21, pinned to one release with a sha256 per platform,
# like every other build-time download in this repo. The workshop USB stick can
# carry a ready .tools/jre per platform instead; copying it in skips this.
#
# Platforms: macOS and Linux on x64 / aarch64. On Windows, run the workshop in
# WSL, which counts as Linux here.
#
# Preparing the USB stick for every platform from one machine:
#   JRE_PLATFORM=linux-x64 JRE_DIR=/Volumes/USB/jre-linux-x64 scripts/fetch-jre.sh
# (platforms: mac-aarch64, mac-x64, linux-aarch64, linux-x64). Attendees copy
# the matching folder to .tools/jre in their checkout.
#
# Update the pin: pick a release from
#   https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre&os=<mac|linux>&architecture=<x64|aarch64>
# and copy each .tar.gz package's name and checksum below.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/.tools"
JRE_DIR="${JRE_DIR:-$TOOLS_DIR/jre}"
TOOLS_DIR="$(dirname "$JRE_DIR")"

RELEASE="jdk-21.0.12.1+1"
BASE="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1"

# The host platform, unless JRE_PLATFORM names another one.
case "${JRE_PLATFORM:-}" in
  mac-aarch64) PLATFORM="Darwin/arm64" ;;
  mac-x64) PLATFORM="Darwin/x86_64" ;;
  linux-aarch64) PLATFORM="Linux/aarch64" ;;
  linux-x64) PLATFORM="Linux/x86_64" ;;
  "") PLATFORM="$(uname -s)/$(uname -m)" ;;
  *) echo "✗ Unknown JRE_PLATFORM '$JRE_PLATFORM' (mac-aarch64, mac-x64, linux-aarch64, linux-x64)" >&2; exit 1 ;;
esac

case "$PLATFORM" in
  Darwin/arm64)
    FILE="OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz"
    SHA="dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84" ;;
  Darwin/x86_64)
    FILE="OpenJDK21U-jre_x64_mac_hotspot_21.0.12.1_1.tar.gz"
    SHA="6717ec641fd9ce0bb209ca083ee23b42202ac68cb6fcc5753496e0e4a0f41989" ;;
  Linux/aarch64|Linux/arm64)
    FILE="OpenJDK21U-jre_aarch64_linux_hotspot_21.0.12.1_1.tar.gz"
    SHA="14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2" ;;
  Linux/x86_64)
    FILE="OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz"
    SHA="2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500" ;;
  *)
    echo "✗ No portable JRE for $PLATFORM. Install any JDK 21 or newer instead." >&2
    exit 1 ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

echo "==> Portable Java runtime: Temurin $RELEASE ($FILE)"

# Already unpacked from this exact archive? (A stamp, because the archive
# itself is deleted after unpacking.)
STAMP="$JRE_DIR/.from-$SHA"
if [[ -f "$STAMP" ]]; then
  echo "  • already present in ${JRE_DIR#$REPO_ROOT/}, skipping"
  exit 0
fi

mkdir -p "$TOOLS_DIR"
ARCHIVE="$TOOLS_DIR/$FILE"
if [[ ! -f "$ARCHIVE" ]] || [[ "$(sha256_of "$ARCHIVE")" != "$SHA" ]]; then
  echo "  • downloading (~45 MB)…"
  curl -fSL "$BASE/$FILE" -o "$ARCHIVE.download"
  mv "$ARCHIVE.download" "$ARCHIVE"
fi
ACTUAL="$(sha256_of "$ARCHIVE")"
if [[ "$ACTUAL" != "$SHA" ]]; then
  echo "  ✗ checksum mismatch for $FILE" >&2
  echo "    expected: $SHA" >&2
  echo "    actual:   $ACTUAL" >&2
  rm -f "$ARCHIVE"
  exit 1
fi
echo "  ✓ checksum verified"

# Unpack into a fresh directory, then move it into place, so an interrupted
# run never leaves a half-extracted runtime behind.
TMP="$(mktemp -d "$TOOLS_DIR/jre.XXXXXX")"
tar -xzf "$ARCHIVE" -C "$TMP" --strip-components=1
rm -rf "$JRE_DIR"
mv "$TMP" "$JRE_DIR"
touch "$STAMP"
rm -f "$ARCHIVE"

JAVA_BIN="$JRE_DIR/bin/java"
[[ -x "$JAVA_BIN" ]] || JAVA_BIN="$JRE_DIR/Contents/Home/bin/java"
if [[ -z "${JRE_PLATFORM:-}" ]]; then
  echo "  ✓ $("$JAVA_BIN" -version 2>&1 | head -1)"
  echo "    at ${JAVA_BIN#$REPO_ROOT/} (make backend finds it automatically)"
else
  echo "  ✓ unpacked for $JRE_PLATFORM into $JRE_DIR"
fi
