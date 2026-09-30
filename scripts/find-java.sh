#!/usr/bin/env bash
#
# find-java.sh — print the path of a `java` that can run the backend (major
# version 21 or newer), or exit 1 if there is none. The one place that decides
# which Java the workshop uses: the Makefile and doctor.sh both call it.
#
#   scripts/find-java.sh            → /path/to/bin/java
#
# Search order, first match wins:
#   1. $JAVA                        explicit override (make backend JAVA=...)
#   2. $JAVA_HOME/bin/java
#   3. `java` on PATH
#   4. .tools/jre                   the portable JRE from `make jre`
#   5. SDKMAN candidates, newest first
#   6. macOS /usr/libexec/java_home -v 21+
#
# Any version >= 21 is fine: the backend jar is compiled for 21 and runs on
# every later release. FIND_JAVA_ONLY_TOOLS=1 skips 1-3, 5 and 6 (used to test
# the "no Java installed" path on a machine that has one).
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIN_MAJOR=21

# major_of <java> — the feature release number, e.g. 21 or 25 (1 for 1.8).
major_of() {
  "$1" -version 2>&1 | head -1 | sed -nE 's/.*version "([0-9]+).*/\1/p'
}

# usable <java> — true for an executable java of MIN_MAJOR or newer.
usable() {
  [[ -n "$1" && -x "$1" ]] || return 1
  local major
  major="$(major_of "$1")"
  [[ -n "$major" ]] && (( major >= MIN_MAJOR ))
}

# The portable JRE's java: macOS tarballs nest it under Contents/Home.
tools_java() {
  local jre="$REPO_ROOT/.tools/jre"
  for candidate in "$jre/bin/java" "$jre/Contents/Home/bin/java"; do
    [[ -x "$candidate" ]] && { printf '%s\n' "$candidate"; return; }
  done
}

candidates() {
  if [[ -z "${FIND_JAVA_ONLY_TOOLS:-}" ]]; then
    printf '%s\n' "${JAVA:-}"
    [[ -n "${JAVA_HOME:-}" ]] && printf '%s\n' "$JAVA_HOME/bin/java"
    command -v java 2>/dev/null
  fi
  tools_java
  if [[ -z "${FIND_JAVA_ONLY_TOOLS:-}" ]]; then
    # SDKMAN, newest version directory first.
    ls -1d "$HOME"/.sdkman/candidates/java/*/ 2>/dev/null | sort -rV | sed 's#/$#/bin/java#'
    if [[ -x /usr/libexec/java_home ]]; then
      /usr/libexec/java_home -v "$MIN_MAJOR+" 2>/dev/null | sed 's#$#/bin/java#'
    fi
  fi
}

while IFS= read -r candidate; do
  if usable "$candidate"; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done < <(candidates)
exit 1
