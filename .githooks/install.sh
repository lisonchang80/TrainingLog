#!/bin/bash
# Installs the tracked pre-commit hook into this repo's active git hooks dir.
# Run once after cloning, and re-run whenever .githooks/pre-commit changes.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# Honor an explicit core.hooksPath if set; otherwise use the shared hooks dir
# (git-common-dir keeps this correct inside `git worktree add`'ed checkouts).
HOOKS_DIR=$(git config core.hooksPath || true)
[ -n "$HOOKS_DIR" ] || HOOKS_DIR="$(git rev-parse --git-common-dir)/hooks"

mkdir -p "$HOOKS_DIR"
install -m 0755 .githooks/pre-commit "$HOOKS_DIR/pre-commit"
echo "[install-git-hooks] installed pre-commit → $HOOKS_DIR/pre-commit"
