# frontend

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

> Note: For Unit test the[Vue Test Utils (VTU)](https://test-utils.vuejs.org/guide/) are used.

### Run End-to-End Tests with [Playwright](https://playwright.dev)

```sh
# Install browsers for the first run
npx playwright install

# When testing on CI, must build the project first
npm run build

# Runs the end-to-end tests
npm run test:e2e
# Runs the tests only on Chromium
npm run test:e2e -- --project=chromium
# Runs the tests of a specific file
npm run test:e2e -- tests/example.spec.ts
# Runs the tests in debug mode
npm run test:e2e -- --debug
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

## World News Widget (Decrypt RSS)

The dashboard includes a light-weight `WorldNewsWidget.vue` component that consumes the Decrypt RSS feed via a same-origin path `/news-feed`.

Development:

- Vite dev server proxies `/news-feed` to `https://decrypt.co/feed` (see `vite.config.ts`).
- No CORS issues in dev since the proxy is same-origin.

Production:

- Nginx proxies `/news-feed` to `https://decrypt.co/feed` with a 5-minute cache (see `infra/nginx/default.conf`).
- Keep caching to reduce upstream load; adjust durations as needed.

Images:

- Decrypt articles often reference images served via Prismic. The widget pulls the first `<img>` from the description/content when needed.
- Allowed sources include `https://decrypt.co`, `https://*.decrypt.co`, and `https://images.prismic.io`.

Security Notes:

- CSP is configured in `infra/nginx/security-headers.conf`. Ensure `img-src` includes Decrypt and Prismic domains. No external `connect-src` is used for the feed because it goes through the same-origin proxy.

## Performance & RPC Usage Controls (Added)

The app now includes a multi-layer strategy to avoid Solana RPC rate limits:

1. Workspace Store Caching (`useWorkspaceStore`)

   - Per-pool, all pools, per-bet entries, user entries, history, and main state are cached in-memory with TTL (not serialized).
   - A sliding window rate limiter (default ~18 requests / 10s) wraps all program account fetches.
   - 429 responses are retried once with a short backoff.
   - No manual sessionStorage persistence: volatile caches avoid BN serialization issues and reset on full reload.

2. Lazy / Sequential Entry Loading (UI)

   - `DashboardView.vue` and `TrendingMarkets.vue` no longer burst-fetch all entries. They fetch entries sequentially with a small delay (≈100–120ms) to smooth load.
   - Trending only loads entries for currently visible markets; more are loaded as the user scrolls or expands the page size.

3. Cache Invalidation

   - Mutating actions (create entry, deposit, set winner, claim, creator fee claim) invalidate only the relevant caches instead of clearing everything.
   - A `clearAllCaches()` helper is exposed for diagnostics.

4. Forcing Fresh Data
   - Most fetch helpers accept `{ force: true }` to bypass TTL if an immediately fresh read is required (use sparingly—prefer eventual consistency).

### Developer Guidelines

| Scenario                                  | Recommended Action                                             |
| ----------------------------------------- | -------------------------------------------------------------- |
| Need to show updated pool after a deposit | Rely on invalidation already wired; avoid manual force calls.  |
| Refresh entire dashboard/trending         | Use existing refresh button (calls force on global pools).     |
| Investigating stale UI in dev             | Call `workspaceStore.clearAllCaches()` in console then reload. |

This approach trades a small amount of reactivity for stability and should eliminate 429 rate limit errors under normal usage.

BN Serialization Note: Anchor returns numeric fields as BN objects. Since in-memory caches are not persisted, BN instances remain intact. If you intentionally persist data elsewhere, convert BN values to primitives:

```ts
const toPrimitive = (bn: any) => (typeof bn?.toNumber === 'function' ? bn.toNumber() : bn)
// or for large values beyond 53 bits:
const toStringBN = (bn: any) =>
  bn && typeof bn.toString === 'function' ? bn.toString() : String(bn)
```

Prefer numbers when you know values fit within JS safe integer range; otherwise store strings and re-wrap with `new BN(value)` when reading back.
