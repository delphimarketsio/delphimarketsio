<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { RouterLink, useRouter, useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { WalletMultiButton } from 'solana-wallets-vue'
import ConnectWalletGate from '@/components/ConnectWalletGate.vue'
import { Wallet, Search, Plus, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSearch } from '@/composables/useSearch'
import logo from '@/assets/logo.svg'
import HowItWorksDialog from '@/components/HowItWorksDialog.vue'
import { Info } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()
const { searchQuery, setSearchQuery, clearSearch, isSearchActive } = useSearch()

// Show search on all non-bet-detail pages (public + authenticated) now that dashboard is public
const showSearch = computed(() => !route.path.startsWith('/bet/'))

const createNewBet = () => {
  router.push('/create-bet')
}

const handleSearchInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  setSearchQuery(target.value)
}

// How it works dialog state (always accessible via header icon)
const showHowDialog = ref(false)
const DIALOG_ACK_KEY = 'delphi_markets_how_dialog_ack_v1'
const hideDialogPermanently = ref(false)

onMounted(() => {
  hideDialogPermanently.value = localStorage.getItem(DIALOG_ACK_KEY) === '1'
})

function openHowDialog() {
  showHowDialog.value = true
}

function onAckChange(val: boolean) {
  hideDialogPermanently.value = val
  if (val) {
    localStorage.setItem(DIALOG_ACK_KEY, '1')
  } else {
    localStorage.removeItem(DIALOG_ACK_KEY)
  }
}
</script>

<template>
  <header
    class="sticky top-0 z-10 w-full bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
  >
    <div class="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
      <!-- Logo and Brand -->
      <div class="flex items-center">
        <RouterLink to="/" aria-label="Home" class="inline-flex items-center">
          <img :src="logo" alt="DelphiMarkets logo" class="h-8 w-auto select-none" />
          <span
            class="hidden md:inline ml-2 text-xl font-bold text-[#3B82F6] dark:text-[#60A5FA] whitespace-nowrap"
            >DelphiMarkets</span
          >
        </RouterLink>
      </div>

      <!-- Search Field - Hidden on bet detail/share pages -->
      <div v-if="showSearch" class="mx-4 flex-1 max-w-md">
        <div class="relative">
          <input
            :value="searchQuery"
            @input="handleSearchInput"
            type="text"
            placeholder="Search your markets..."
            class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 pr-10 focus:border-[#3B82F6] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <button
            v-if="isSearchActive"
            @click="clearSearch"
            class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title="Clear search"
          >
            <X class="h-5 w-5" />
          </button>
          <div
            v-else
            class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-gray-400 pointer-events-none"
          >
            <Search class="h-5 w-5" />
          </div>
        </div>
      </div>

      <!-- Right Side Actions -->
      <div class="flex items-center space-x-4" v-if="workspaceStore.isAuthenticated">
        <Button @click="createNewBet" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">
          <Plus class="h-4 w-4" />
          New Market
        </Button>

        <!-- User Menu -->
        <div class="flex items-center space-x-3">
          <ConnectWalletGate :enabled="!workspaceStore.isAuthenticated">
            <template #button>
              <WalletMultiButton />
            </template>
          </ConnectWalletGate>
        </div>
        <!-- How it works icon (always visible) -->
        <button
          type="button"
          @click="openHowDialog"
          class="group relative inline-flex items-center justify-center rounded-full p-2 text-gray-500 hover:text-[#3B82F6] hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
          aria-label="How it works"
        >
          <Info class="h-5 w-5" />
          <span
            class="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
            >How it works</span
          >
        </button>
      </div>

      <!-- Non-authenticated User Actions (still show info icon) -->
      <div v-else class="flex items-center space-x-4">
        <ConnectWalletGate :enabled="!workspaceStore.isAuthenticated">
          <template #button>
            <WalletMultiButton>
              <template #select-wallet-content>
                <span class="flex gap-2 items-center">
                  <Wallet class="h-5 w-5" />
                  <span>Connect Your Wallet</span>
                </span>
              </template>
            </WalletMultiButton>
          </template>
        </ConnectWalletGate>
        <button
          type="button"
          @click="openHowDialog"
          class="group relative inline-flex items-center justify-center rounded-full p-2 text-gray-500 hover:text-[#3B82F6] hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
          aria-label="How it works"
        >
          <Info class="h-5 w-5" />
          <span
            class="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
            >How it works</span
          >
        </button>
      </div>
    </div>
    <!-- Dialog Teleport -->
    <HowItWorksDialog
      v-model="showHowDialog"
      :show-ack="false"
      @ack-change="onAckChange"
      v-if="!hideDialogPermanently || showHowDialog"
    />
  </header>
</template>
