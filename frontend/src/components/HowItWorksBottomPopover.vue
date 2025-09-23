<script setup lang="ts">
import { ref, onMounted } from 'vue'

/*
  Bottom popover for unauthenticated users giving a super concise primer.
  - Shows only if user not authenticated AND localStorage flag not set
  - Dismiss button or "Got it" sets flag
  - Content intentionally short and crypto-native tone
*/

const props = defineProps<{ isAuthenticated: boolean }>()

const STORAGE_KEY = 'delphi_markets_hide_bottom_primer_v1'
const open = ref(false)

onMounted(() => {
  if (!props.isAuthenticated) {
    const hidden = localStorage.getItem(STORAGE_KEY) === '1'
    if (!hidden) open.value = true
  }
})

function dismiss(permanent = false) {
  open.value = false
  if (permanent) localStorage.setItem(STORAGE_KEY, '1')
}
</script>

<template>
  <transition name="fade-slide-up">
    <div
      v-if="open && !isAuthenticated"
      class="fixed bottom-4 left-1/2 z-40 w-[min(100%-1.5rem,680px)] -translate-x-1/2 rounded-xl border border-gray-200/80 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-gray-700 dark:bg-gray-800/95"
      role="dialog"
      aria-label="How it works quick intro"
    >
      <div class="flex items-start gap-4">
        <div
          class="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-6 w-6"
          >
            <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" />
            <path d="M12 11V17" />
            <path d="M12 7H12.01" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">
            Prediction markets. On-chain.
          </p>
          <p class="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            Connect a Solana wallet. Go long (Yes) or short (No) on real world outcomes. Liquidity &
            payouts settle by smart contract the moment the market resolves.
          </p>
          <ul
            class="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-gray-500 dark:text-gray-400"
          >
            <li class="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60">Non-custodial</li>
            <li class="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60">Transparent odds</li>
            <li class="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60">Instant claims</li>
          </ul>
          <div class="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              class="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-600/90 focus:outline-none focus:ring-2 focus:ring-blue-500"
              @click="dismiss(true)"
            >
              Got it
            </button>
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              @click="dismiss()"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fade-slide-up-enter-active,
.fade-slide-up-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.fade-slide-up-enter-from,
.fade-slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
