#!/usr/bin/env bash

set -euo pipefail

# Simple dev orchestrator for Betting Platform
# - Default: starts local Solana validator and frontend dev server
# - --reset: resets validator, builds Anchor program, runs `anchor test --skip-local-validator`, then starts frontend

# Config (override via env vars)
RPC_PORT="${RPC_PORT:-8899}"
BIND_ADDR="${BIND_ADDR:-0.0.0.0}"

# Resolve repo root from this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SMART_CONTRACT_DIR="${ROOT_DIR}/smart_contract/prediction-platform"
FRONTEND_DIR="${ROOT_DIR}/frontend"
# Allow overriding the ledger dir; default to Anchor workspace test-ledger
LEDGER_DIR_REAL="${LEDGER_DIR:-${SMART_CONTRACT_DIR}/test-ledger}"
# Use a short symlink path to avoid macOS Unix socket path limits for admin.rpc
LEDGER_SYMLINK="/tmp/bp-ledger"
LOG_DIR="${ROOT_DIR}/.logs"
mkdir -p "${LOG_DIR}"
VALIDATOR_LOG="${LOG_DIR}/solana-test-validator.log"
LEDGER_ARG="${LEDGER_DIR_REAL}"

RESET_MODE=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--reset] [--no-frontend]

Options:
  --reset         Reset local validator, build Anchor program, run anchor test --skip-local-validator
  --no-frontend   Do not start the frontend dev server (useful for backend-only work)
  -h, --help      Show this help

Environment variables:
  RPC_PORT   RPC port for validator (default: 8899)
  BIND_ADDR  Bind address for validator (default: 0.0.0.0)
EOF
}

NO_FRONTEND=false
for arg in "$@"; do
  case "$arg" in
    --reset) RESET_MODE=true ;;
    --no-frontend) NO_FRONTEND=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg"; usage; exit 1 ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is not installed or not in PATH." >&2
    exit 1
  fi
}

is_port_in_use() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1
  else
    # Fallback: try nc
    nc -z localhost "${port}" >/dev/null 2>&1
  fi
}

wait_for_rpc() {
  local tries=0 max_tries=60
  while (( tries < max_tries )); do
    if curl -s "http://127.0.0.1:${RPC_PORT}" \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"'; then
      echo "Validator RPC healthy on :${RPC_PORT}"
      return 0
    fi
    sleep 1
    ((tries++))
  done
  echo "Timed out waiting for validator RPC on :${RPC_PORT}" >&2
  return 1
}

VALIDATOR_PID=""

cleanup() {
  # Kill background validator only if we started it
  if [[ -n "${VALIDATOR_PID}" ]] && ps -p "${VALIDATOR_PID}" >/dev/null 2>&1; then
    echo "Stopping validator (pid ${VALIDATOR_PID})..."
    kill "${VALIDATOR_PID}" || true
    wait "${VALIDATOR_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_validator() {
  # Prepare ledger path with short symlink to avoid long admin.rpc socket path
  mkdir -p "${LEDGER_DIR_REAL}"
  # Refresh symlink
  rm -f "${LEDGER_SYMLINK}" 2>/dev/null || true
  ln -s "${LEDGER_DIR_REAL}" "${LEDGER_SYMLINK}" 2>/dev/null || true
  LEDGER_ARG="${LEDGER_SYMLINK}"

  echo "Starting solana-test-validator (ledger: ${LEDGER_ARG}, rpc: ${RPC_PORT}, bind: ${BIND_ADDR})..."
  pushd "${SMART_CONTRACT_DIR}" >/dev/null

  # Build command array to avoid word-splitting issues and unbound array errors
  local cmd=(
    solana-test-validator
    --rpc-port "${RPC_PORT}"
    --bind-address "${BIND_ADDR}"
  --ledger "${LEDGER_ARG}"
  )
  if [[ "${RESET_MODE}" == true ]]; then
    cmd+=(--reset)
  fi

  # If port already in use, assume validator is running and don't start a new one
  if is_port_in_use "${RPC_PORT}"; then
    echo "Port ${RPC_PORT} already in use; assuming validator is running. Skipping start."
    popd >/dev/null
    return 0
  fi

  # Start in background, log to file
  nohup "${cmd[@]}" >"${VALIDATOR_LOG}" 2>&1 &
  VALIDATOR_PID=$!
  echo "Validator started with pid ${VALIDATOR_PID}. Logs: ${VALIDATOR_LOG}"
  popd >/dev/null

  wait_for_rpc
}

anchor_build() {
  echo "Building Anchor program..."
  pushd "${SMART_CONTRACT_DIR}" >/dev/null
  anchor build
  popd >/dev/null
}

anchor_test_skip_local() {
  echo "Running anchor test --skip-local-validator (to deploy/init contracts)..."
  pushd "${SMART_CONTRACT_DIR}" >/dev/null
  anchor test --skip-local-validator
  popd >/dev/null
}

start_frontend() {
  if [[ "${NO_FRONTEND}" == true ]]; then
    echo "--no-frontend specified; skipping frontend dev server."
    return 0
  fi
  echo "Starting frontend dev server..."
  pushd "${FRONTEND_DIR}" >/dev/null
  if [[ -f yarn.lock || -d .yarn ]]; then
    yarn dev
  elif command -v pnpm >/dev/null 2>&1 && [[ -f pnpm-lock.yaml ]]; then
    pnpm dev
  else
    npm run dev
  fi
  popd >/dev/null
}

main() {
  # Basic requirements
  require_cmd solana-test-validator
  require_cmd anchor
  # Frontend runner will decide between yarn/pnpm/npm; we check npm as a baseline
  require_cmd node

  if [[ "${RESET_MODE}" == true ]]; then
    echo "=== RESET MODE ==="
  fi

  start_validator

  if [[ "${RESET_MODE}" == true ]]; then
    anchor_build
    anchor_test_skip_local
  fi

  # Keep script attached to frontend; validator remains in background and will be cleaned on exit if we started it
  start_frontend
}

main "$@"
