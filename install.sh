#!/usr/bin/env bash
# Tangent installer: builds the workspace and puts the `tangent` CLI on PATH.
# Safe to re-run. Usage: ./install.sh
set -euo pipefail

cd "$(dirname "$0")"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }

# 1. Node version gate. The workspace targets Node 20+.
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js is not installed. Install Node 20 or newer (https://nodejs.org) and re-run ./install.sh."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $(node -v) is too old; Tangent needs Node 20 or newer. Upgrade Node and re-run ./install.sh."
  exit 1
fi
say "Using Node $(node -v)"

# 2. Native dependency note. @tangent/usage builds better-sqlite3, which downloads a
# prebuilt binary when one matches your platform and otherwise compiles from source.
# A source build needs a C/C++ toolchain (build-essential + python3 on Linux, Xcode
# Command Line Tools on macOS). If `npm install` fails on better-sqlite3, install those.
say "Installing dependencies..."
npm install

say "Building all packages..."
npm run build

# 3. Put `tangent` on PATH via a global symlink to this checkout's bin.
say "Linking the tangent CLI onto your PATH..."
if npm link >/dev/null 2>&1; then
  say "Done. The 'tangent' command is now available."
else
  warn "npm link did not complete (it may need elevated permissions on a system-wide Node)."
  warn "You can still run Tangent without a global link:"
  warn "  - call it directly:   node $(pwd)/dist/cli/index.js ui"
  warn "  - or add to PATH:     export PATH=\"$(pwd)/node_modules/.bin:\$PATH\"  (then: tangent ui)"
fi

cat <<'EOF'

Next steps:
  tangent ui            # the combined Usage + Eval interface (start here)
  tangent usage today   # recent coding-agent activity
  tangent eval quick --prompt evals/haiku-poems/prompts/task.md --context empty --context repo

EOF
