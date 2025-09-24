#!/usr/bin/env bash

# Simple developer bootstrap script
#  - Installs smart contract (Anchor workspace) JS dependencies (yarn)
#  - Syncs Anchor program keys (anchor keys sync) before build to ensure declare_id!/Anchor.toml alignment
#  - Builds Anchor program
#  - Copies generated IDL + TypeScript types into frontend (src/assets + src/types)
#  - Installs frontend dependencies with yarn (frozen lockfile)
#  - Runs Anchor build and yarn install in parallel (can disable with --no-parallel)
#
# Usage: ./scripts/setup-dev.sh [--no-parallel] [--program <name>]
# ENV:
#   PROGRAM_NAME  Override detected program name (defaults to first IDL json after build)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SC_DIR="${ROOT_DIR}/smart_contract/prediction-platform"
FE_DIR="${ROOT_DIR}/frontend"

PARALLEL=true
PROGRAM_NAME="${PROGRAM_NAME:-}"

usage() {
  cat <<EOF
Bootstrap local dev environment.

Options:
  --no-parallel       Run steps sequentially (default is parallel build + install)
  --program <name>    Explicit Anchor program (IDL/types base filename)
  -h, --help          Show this help

Environment:
  PROGRAM_NAME        Same as --program; takes precedence if set

Steps performed:
  1. anchor build (in smart_contract/prediction-platform)
  2. yarn install --frozen-lockfile (in frontend)
  3. copy target/idl/<program>.json -> frontend/src/assets/
     copy target/types/<program>.ts -> frontend/src/types/
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-parallel) PARALLEL=false; shift ;;
    --program) PROGRAM_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log() { printf "[setup-dev] %s\n" "$*"; }
err() { printf "[setup-dev][ERROR] %s\n" "$*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command '$1' not found in PATH."; exit 1
  fi
}

require_cmd anchor
require_cmd yarn
require_cmd bash # for completeness if invoked differently

anchor_build() {
  log "Installing smart contract JS dependencies (if yarn.lock present)..."
  (cd "$SC_DIR" && if [[ -f yarn.lock ]]; then yarn install --frozen-lockfile >/dev/null; else log "No yarn.lock in smart contract dir; skipping JS deps install."; fi)
  log "Syncing Anchor program keys (anchor keys sync)..."
  if (cd "$SC_DIR" && anchor keys sync >/dev/null 2>&1); then
    log "Anchor keys synced."
  else
    err "Anchor keys sync failed (continuing)." # Non-fatal; build may still proceed
  fi
  log "Building Anchor program..."
  (cd "$SC_DIR" && anchor build --skip-lint >/dev/null)
  log "Anchor build complete."
}

frontend_install() {
  log "Installing frontend dependencies (yarn --frozen-lockfile)..."
  (cd "$FE_DIR" && yarn install --frozen-lockfile >/dev/null)
  log "Frontend dependencies installed."
}

detect_program_name() {
  if [[ -n "$PROGRAM_NAME" ]]; then
    return 0
  fi
  local first_json
  first_json=$(find "$SC_DIR/target/idl" -maxdepth 1 -type f -name '*.json' 2>/dev/null | head -n1 || true)
  if [[ -z "$first_json" ]]; then
    err "Could not detect program IDL json. Specify with --program <name> or set PROGRAM_NAME."
    exit 1
  fi
  PROGRAM_NAME="$(basename "$first_json" .json)"
  log "Detected PROGRAM_NAME='${PROGRAM_NAME}'"
}

copy_artifacts() {
  detect_program_name
  local idl_src="$SC_DIR/target/idl/${PROGRAM_NAME}.json"
  local types_src="$SC_DIR/target/types/${PROGRAM_NAME}.ts"
  if [[ ! -f "$idl_src" ]]; then err "Missing IDL file: $idl_src"; exit 1; fi
  if [[ ! -f "$types_src" ]]; then err "Missing types file: $types_src"; exit 1; fi

  mkdir -p "$FE_DIR/src/assets" "$FE_DIR/src/types"
  cp "$idl_src" "$FE_DIR/src/assets/${PROGRAM_NAME}.json"
  cp "$types_src" "$FE_DIR/src/types/${PROGRAM_NAME}.ts"
  log "Copied IDL -> frontend/src/assets/${PROGRAM_NAME}.json"
  log "Copied types -> frontend/src/types/${PROGRAM_NAME}.ts"
}

main() {
  log "Root: $ROOT_DIR"
  log "Smart contract dir: $SC_DIR"
  log "Frontend dir: $FE_DIR"
  if [[ ! -d "$SC_DIR" ]]; then err "Smart contract directory not found: $SC_DIR"; exit 1; fi
  if [[ ! -d "$FE_DIR" ]]; then err "Frontend directory not found: $FE_DIR"; exit 1; fi

  if $PARALLEL; then
    log "Running anchor build and yarn install in parallel... (use --no-parallel to disable)"
    anchor_build & pid_anchor=$!
    frontend_install & pid_fe=$!
    # Wait for anchor first (types needed afterwards); still collect FE status
    wait $pid_anchor || { err "Anchor build failed"; exit 1; }
    wait $pid_fe || { err "Frontend dependency install failed"; exit 1; }
  else
    log "Running sequentially (anchor then yarn)."
    anchor_build
    frontend_install
  fi

  copy_artifacts
  log "Done. You can now start your dev environment (e.g., ./scripts/dev.sh)."
}

main "$@"
