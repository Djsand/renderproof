#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

RENDERPROOF_HOME="${RENDERPROOF_HOME:-$HOME/.renderproof}"
RENDERPROOF_REPO_URL="${RENDERPROOF_REPO_URL:-https://github.com/Djsand/renderproof.git}"
RENDERPROOF_BRANCH="${RENDERPROOF_BRANCH:-main}"
ORIGINAL_CWD="$(pwd)"

print_help() {
  cat <<EOF
RenderProof one-line installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- codex

Targets:
  codex       Install into Codex with codex mcp add
  claude      Install into Claude Code with claude mcp add
  cursor      Write .cursor/mcp.json in the directory where you ran the one-liner
  cline       Write ~/.cline/mcp.json
  windsurf    Write ~/.codeium/windsurf/mcp_config.json
  gemini      Install into Gemini CLI user scope
  generic     Print generic MCP JSON
  print       Print all install commands/configs

Environment:
  RENDERPROOF_HOME=$RENDERPROOF_HOME
  RENDERPROOF_BRANCH=$RENDERPROOF_BRANCH
EOF
}

if [[ "$TARGET" == "help" || "$TARGET" == "--help" || "$TARGET" == "-h" ]]; then
  print_help
  exit 0
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    if [[ "$1" == "node" || "$1" == "npm" || "$1" == "npx" ]]; then
      echo "Install Node.js 20+ and reopen your terminal." >&2
      echo "On Windows, prefer the PowerShell installer:" >&2
      echo '  powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Djsand/renderproof/main/install.ps1))) -Target codex"' >&2
    fi
    exit 1
  fi
}

need_cmd git
need_cmd node
need_cmd npm
need_cmd npx

node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(Number.isFinite(major) && major >= 20 ? 0 : 1)' \
  || {
    echo "RenderProof requires Node.js >=20." >&2
    exit 1
  }

if [[ -d "$RENDERPROOF_HOME/.git" ]]; then
  echo "Updating RenderProof in $RENDERPROOF_HOME"
  git -C "$RENDERPROOF_HOME" fetch --depth 1 origin "$RENDERPROOF_BRANCH"
  git -C "$RENDERPROOF_HOME" checkout "$RENDERPROOF_BRANCH"
  git -C "$RENDERPROOF_HOME" reset --hard "origin/$RENDERPROOF_BRANCH"
elif [[ -e "$RENDERPROOF_HOME" ]]; then
  echo "$RENDERPROOF_HOME exists but is not a git checkout. Set RENDERPROOF_HOME to another path." >&2
  exit 1
else
  echo "Installing RenderProof into $RENDERPROOF_HOME"
  git clone --depth 1 --branch "$RENDERPROOF_BRANCH" "$RENDERPROOF_REPO_URL" "$RENDERPROOF_HOME"
fi

cd "$RENDERPROOF_HOME"
npm install
npx playwright install chromium
npm run build

ENTRY="$RENDERPROOF_HOME/dist/index.js"

case "$TARGET" in
  codex)
    node "$ENTRY" install codex --apply --entry "$ENTRY" "$@"
    ;;
  claude)
    node "$ENTRY" install claude --apply --entry "$ENTRY" "$@"
    ;;
  cursor)
    (cd "$ORIGINAL_CWD" && node "$ENTRY" install cursor --write-project --entry "$ENTRY" "$@")
    ;;
  cline)
    node "$ENTRY" install cline --write-user --entry "$ENTRY" "$@"
    ;;
  windsurf)
    node "$ENTRY" install windsurf --write-user --entry "$ENTRY" "$@"
    ;;
  gemini)
    node "$ENTRY" install gemini --apply --scope user --entry "$ENTRY" "$@"
    ;;
  generic)
    node "$ENTRY" install generic --json --entry "$ENTRY" "$@"
    ;;
  print|all)
    node "$ENTRY" install all --entry "$ENTRY" "$@"
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    echo "Run with target 'help' to see supported targets." >&2
    exit 1
    ;;
esac

cat <<EOF

RenderProof is installed at:
  $RENDERPROOF_HOME

Smoke test:
  node "$ENTRY" doctor --check-browser-launch
EOF
