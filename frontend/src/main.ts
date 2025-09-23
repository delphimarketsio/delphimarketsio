import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import logger from './logger'
import router from './router'

// Lightweight Buffer polyfill: some Solana / Anchor deps expect global Buffer
// Only assign if not already present (avoids clobbering in tests/HMR)
import { Buffer } from 'buffer'
declare global {
  interface Window {
    Buffer: typeof Buffer
  }
}
const winWithBuffer = window as Window & { Buffer?: typeof Buffer }
if (!winWithBuffer.Buffer) winWithBuffer.Buffer = Buffer

import SolanaWallets from 'solana-wallets-vue'
// Explicit wallet adapter imports so they are always shown even if extension/provider
// hasn't injected yet. This ensures the UI displays install/connect options.
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase'

// Only needed for the wallet multi button, selection menu, and wallet connection
import 'solana-wallets-vue/styles.css'

import './assets/main.css'

import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'

const network = import.meta.env.VITE_SOLANA_CLUSTER as WalletAdapterNetwork

// --- Mobile-aware autoConnect & race condition mitigation ---
// 1. Disable autoConnect on mobile devices because extensions/providers usually
//    are not injected in standalone mobile browsers (users should use in-app wallet browser).
// 2. Delay initializing the SolanaWallets plugin very slightly to give Phantom/Solflare
//    time to inject on first load, mitigating a race that can cause the "Install"
//    redirect despite the extension/app existing.
// 3. On returning to the tab (visibilitychange) attempt a silent reconnect if the
//    provider appears after initial load.

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent,
)

// Helper: poll until predicate true or timeout (ms)
async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 50) {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return predicate()
}

// Narrowed typing for injected providers to avoid widespread any casts
interface PhantomProviderLike {
  isPhantom?: boolean
  connect?: (opts?: { onlyIfTrusted?: boolean }) => Promise<unknown>
}
interface GlobalWithSolana extends Window {
  solana?: PhantomProviderLike
  phantom?: { solana?: PhantomProviderLike }
  solflare?: unknown
}
const g = window as GlobalWithSolana

// We'll fill walletOptions right before plugin installation so that we can set
// autoConnect dynamically.
function buildWalletOptions(autoConnect: boolean) {
  // Instantiate adapters each call to avoid stale state across HMR
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network }),
    new CoinbaseWalletAdapter({ network }),
  ]

  return {
    autoConnect,
    cluster: network,
    wallets,
  }
}

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
app.use(logger)
app.use(pinia)

// Async init sequence to mitigate provider injection races.
;(async () => {
  const autoConnect = !isMobile // disable on mobile

  if (autoConnect) {
    // Wait briefly (up to 800ms) for Phantom/Solflare injection to appear to reduce false "not installed" states
    await waitFor(() => !!g.phantom?.solana || !!g.solana?.isPhantom || !!g.solflare, 800, 40)
  }

  app.use(SolanaWallets, buildWalletOptions(autoConnect))
  app.use(router)
  app.mount('#app')

  // On visibility return, attempt a silent reconnect if user had previously connected (handled internally by adapters)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Give provider a moment to (re)inject after tab resume
      setTimeout(() => {
        // If autoConnect was enabled originally and provider now exists, attempt onlyIfTrusted connect.
        if (autoConnect && g.solana?.isPhantom) {
          try {
            g.solana?.connect?.({ onlyIfTrusted: true }).catch(() => {})
          } catch {
            /* swallow */
          }
        }
      }, 150)
    }
  })
})()
