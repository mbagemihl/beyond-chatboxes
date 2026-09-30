#!/usr/bin/env bash
#
# workshop-step.sh — move between workshop checkpoints without ever losing work.
#
#   scripts/workshop-step.sh step 2              # start act 2b (checkpoint 2)
#   scripts/workshop-step.sh solve 2             # reveal its reference solution
#   scripts/workshop-step.sh step bonus-search   # start a bonus track
#
# Normally invoked through the Makefile: `make step-2`, `make solve-2`,
# `make bonus-search`, `make solve-bonus-search`.
#
# Design rule: an attendee mid-exercise must NEVER lose code to a checkpoint
# switch, and must never have to understand git to recover. So:
#   * uncommitted work is committed onto a `workshop-wip-<stamp>` branch, and
#     the branch name is printed loudly;
#   * an existing `workshop-step-N` branch is renamed, not reset, so its commits
#     stay reachable by name;
#   * `solve` copies your attempt into .workshop-backups/ before overwriting it.
# Nothing here deletes anything.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ -t 1 ]]; then
  GREEN=$'\033[32m'; AMBER=$'\033[33m'; CYAN=$'\033[36m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  GREEN=""; AMBER=""; CYAN=""; BOLD=""; DIM=""; OFF=""
fi

die() { printf '%serror:%s %s\n' "$AMBER" "$OFF" "$1" >&2; exit 1; }

MODE="${1:-}"
BLOCK="${2:-}"

USAGE="usage: workshop-step.sh {step|solve} <1|2|3|bonus-search|bonus-ocr>"
[[ "$MODE" == "step" || "$MODE" == "solve" ]] || die "$USAGE"

# Per checkpoint: the files its exercise lives in (also the set `solve`
# restores), the tag it starts from, and the page to watch.
case "$BLOCK" in
  1) FILES=("frontend/src/app/demos/pose/litert-setup.ts")
     TAG="step-1-start"; ROUTE="/pose/still" ;;
  2) FILES=("frontend/src/app/demos/pose/live-loop.ts")
     TAG="step-2-start"; ROUTE="/pose?fixture=1" ;;
  3) FILES=("frontend/src/app/benchmark/race-summary.ts")
     TAG="step-3-start"; ROUTE="/benchmark?fixture=1" ;;
  bonus-search)
     FILES=("frontend/src/app/demos/search/embedding-setup.ts")
     TAG="bonus-search-start"; ROUTE="/search" ;;
  bonus-ocr)
     FILES=("frontend/src/app/demos/smartform/ocr-layout.ts"
            "frontend/src/app/demos/smartform/prompt-api.ts")
     TAG="bonus-ocr-start"; ROUTE="/smartform?fixture=1" ;;
  *) die "$USAGE (got '${BLOCK:-}')" ;;
esac

STAMP="$(date +%Y%m%d-%H%M%S)"

# --- park any uncommitted work on its own branch -----------------------------
park_uncommitted() {
  if [[ -z "$(git status --porcelain)" ]]; then
    return 0
  fi
  local wip="workshop-wip-$STAMP"
  printf '%s! You have uncommitted changes. Saving them first.%s\n' "$AMBER" "$OFF"
  git checkout -q -b "$wip"
  git add -A
  git commit -q -m "workshop: work in progress, parked automatically"
  printf '  %s✓%s Saved on branch %s%s%s\n' "$GREEN" "$OFF" "$BOLD" "$wip" "$OFF"
  printf '    %sGet it back any time with: git checkout %s%s\n' "$DIM" "$wip" "$OFF"
}

# --- step --------------------------------------------------------------------
if [[ "$MODE" == "step" ]]; then
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
    || die "tag '$TAG' not found. Fetch the checkpoints: git fetch --tags"

  park_uncommitted

  BRANCH="workshop-step-$BLOCK"
  if git show-ref -q --verify "refs/heads/$BRANCH"; then
    # Rename rather than reset: the old commits stay reachable under a new name.
    git branch -m "$BRANCH" "$BRANCH-prev-$STAMP"
    printf '  %s✓%s Previous attempt kept as %s%s%s\n' \
      "$GREEN" "$OFF" "$BOLD" "$BRANCH-prev-$STAMP" "$OFF"
  fi

  git checkout -q -b "$BRANCH" "$TAG"
  printf '\n%s▸ Checkpoint %s ready%s on branch %s%s%s\n' "$BOLD" "$BLOCK" "$OFF" "$CYAN" "$BRANCH" "$OFF"
  printf '  Files to edit:\n'
  printf '    %s\n' "${FILES[@]}"
  printf '  Watch it work:    %shttp://localhost:4200%s%s\n' "$CYAN" "$ROUTE" "$OFF"
  printf '  Check your work:  %smake verify-%s%s\n' "$CYAN" "$BLOCK" "$OFF"
  printf '  Stuck?            %smake solve-%s%s\n' "$CYAN" "$BLOCK" "$OFF"
  exit 0
fi

# --- solve -------------------------------------------------------------------
# Restore the reference implementation from the complete app on main. Your own
# attempt is copied aside first, never discarded.
# origin/main first: a local `main` can be stale (it only moves when you pull),
# while the remote-tracking ref is what the checkpoints were cut from.
REF=""
for candidate in origin/main main; do
  if git rev-parse -q --verify "$candidate" >/dev/null; then REF="$candidate"; break; fi
done
[[ -n "$REF" ]] || die "no 'main' or 'origin/main' to take the solution from. Run: git fetch origin"

BACKUP_DIR=".workshop-backups/$STAMP"
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/$f"
  fi
done

git checkout "$REF" -- "${FILES[@]}"

printf '\n%s▸ Checkpoint %s solution restored%s (from %s)\n' "$BOLD" "$BLOCK" "$OFF" "$REF"
printf '  %s✓%s Your attempt was copied to %s%s%s\n' "$GREEN" "$OFF" "$BOLD" "$BACKUP_DIR" "$OFF"
printf '  Confirm it passes: %smake verify-%s%s\n' "$CYAN" "$BLOCK" "$OFF"
