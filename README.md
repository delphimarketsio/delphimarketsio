[![Smart Contract CI](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/smart-contract.yml/badge.svg)](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/smart-contract.yml)
[![Frontend CI](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/frontend.yml/badge.svg)](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/frontend.yml)
[![Deploy Nginx Config](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/deploy-nginx.yml/badge.svg)](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/deploy-nginx.yml)
[![CI/CD Deploy](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/deploy.yml/badge.svg)](https://github.com/delphimarketsio/delphimarketsio/actions/workflows/deploy.yml)

# Delphi Markets

Delphi Markets — a lightweight prediction markets dApp on Solana. Create and share binary markets via simple links, stake SOL on outcomes, and settle transparently on-chain.

## What this project does
- Lets users create shareable binary markets (Yes/No) powered by a Solana smart contract
- Enables wallet-based participation and instant, on-chain settlement when a market resolves
- Focuses on simplicity: market links are easy to share and anyone with a wallet can join

## Technical overview
- Frontend: Vue 3 + Vite + TypeScript, using solana-wallets-vue for wallet connectivity and a small UI kit (cards/buttons) for layout
- Smart contract: Solana program built with Anchor; exposes instructions for pool creation, deposits, resolution, and claims
- Infra: Nginx config for serving the built frontend with sensible security headers

## Central components
- frontend/ — SPA that renders landing, dashboard, and market detail views and talks to the program using IDL-generated types
- smart_contract/prediction-platform/ — Anchor workspace containing the on-chain program and tests; produces IDL and TS types
- infra/nginx/ — Nginx virtual host and security headers used to serve the frontend

## GitHub Actions (CI/CD)
The repository uses four workflows under `.github/workflows/`:

1) Frontend CI (`frontend.yml`)
	- Triggers: pushes/PRs touching `frontend/**`
	- Steps: checkout, Node setup, download program artifacts (IDL and generated types) from the latest successful deploy, type-check, lint, unit tests, and build. An optional E2E job runs on pushes to `main` (Playwright), also using those artifacts.

2) Smart Contract CI (`smart-contract.yml`)
	- Triggers: pushes/PRs touching `smart_contract/**`
	- Steps: install Rust/Solana/Anchor (cached), lint, build the program with sccache, run `anchor test`, and upload artifacts (IDL JSON and generated TS types). A separate cargo-audit job runs on PRs.

3) CI/CD Deploy (`deploy.yml`)
	- Triggers: manual (workflow_dispatch) with environment inputs or tag pushes (`v*.*.*`)
	- Jobs: builds and deploys the smart contract to the selected Solana cluster (using a stable program key if provided), uploads IDL/types, then builds the frontend by pulling those artifacts, uploads the `dist`, and deploys it to a server over SSH/rsync. Optional remote restart command (e.g., reload Nginx).

4) Deploy Nginx Config (`deploy-nginx.yml`)
	- Triggers: manual or on push to `main` when `infra/nginx/**` changes
	- Steps: upload `infra/nginx/*.conf` to the server via SSH, install them into `/etc/nginx/conf.d`, test the config, and reload Nginx

---

For local development and detailed usage, see the `frontend/` and `smart_contract/prediction-platform/` READMEs and package scripts.

## Local development

Use the dev orchestrator script to spin up a local Solana validator and the frontend in one go.

### Quick start

```bash
./scripts/dev.sh
```

This will:
- Start `solana-test-validator` listening on `0.0.0.0:8899` with the ledger in `smart_contract/prediction-platform/test-ledger`
- Wait for the RPC to be healthy
- Launch the frontend dev server from `frontend/`

Validator logs: `.logs/solana-test-validator.log`

Note: The dev script uses a short ledger path symlink at `/tmp/bp-ledger` to avoid macOS Unix socket path limits (for `admin.rpc`). The actual ledger contents live under `smart_contract/prediction-platform/test-ledger` by default.

### Reset and redeploy the program

```bash
./scripts/dev.sh --reset
```

This will additionally:
- Reset the local validator ledger
- Run `anchor build`
- Run `anchor test --skip-local-validator` to deploy/initialize the program against the running local validator

### Options and env vars

- `--no-frontend` — only manage the validator and (in reset mode) deployment
- `RPC_PORT` — override the validator RPC port (default: `8899`)
- `BIND_ADDR` — override the bind address (default: `0.0.0.0`)

Example:

```bash
RPC_PORT=8899 BIND_ADDR=0.0.0.0 ./scripts/dev.sh --reset
```

### Prerequisites

- Solana CLI with `solana-test-validator`
- Anchor CLI (`anchor`)
- Node.js + a package manager (Yarn/Pnpm/NPM)

### One-time (or occasional) bootstrap

If you just cloned the repo or pulled major smart contract changes, run the lightweight setup helper to:

- Build the Anchor program (generates/updates IDL + TypeScript types)
- Install frontend dependencies with a frozen lockfile
- Copy the generated IDL + types into `frontend/src/assets` and `frontend/src/types`

```bash
./scripts/setup-dev.sh
```

By default it runs the Anchor build and the frontend dependency install in parallel to save time. After completion you can immediately start the combined dev environment with `./scripts/dev.sh`.

Options:

```bash
./scripts/setup-dev.sh --no-parallel        # Run steps sequentially
./scripts/setup-dev.sh --program betting_program  # Explicit program name if auto-detect fails
PROGRAM_NAME=betting_program ./scripts/setup-dev.sh  # Same via environment variable
```

When would you re-run it?
- After changing Rust program code (regenerates updated IDL/types)
- After pulling upstream changes to the smart contract
- After deleting `frontend/node_modules` or updating lockfiles

If auto-detection of the program fails (e.g., no files yet in `target/idl`), specify `--program <name>` or set `PROGRAM_NAME`.
