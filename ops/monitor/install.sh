#!/bin/bash
# Deploys the reviewed ops scripts from this repo to the Paperclip runtime dir.
#   ./install.sh          copy monitor.py, mailtest.py, tokencheck.sh into $RUNTIME_DIR
#   ./install.sh --check  exit 1 if the runtime copies differ from the repo
# Copies (not symlinks) on purpose: a branch checkout in the repo must never change or remove live monitoring code.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.paperclip/chewgather-ops}"
FILES="monitor.py mailtest.py tokencheck.sh"
rc=0
for f in $FILES; do
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$SRC/$f" "$RUNTIME_DIR/$f" || { echo "DRIFT: $f"; rc=1; }
  else
    cp -p "$SRC/$f" "$RUNTIME_DIR/$f" && echo "installed $f"
  fi
done
exit $rc
