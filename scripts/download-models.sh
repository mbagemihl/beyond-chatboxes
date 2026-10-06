#!/usr/bin/env bash
#
# download-models.sh — fetch every model artifact at BUILD TIME (CLAUDE.md:
# models are never fetched from a CDN at runtime). The work is done by the
# cross-platform workshop CLI, so Windows uses the same code: `.\lab download`.
exec node "$(dirname "${BASH_SOURCE[0]}")/lab.mjs" download "$@"
