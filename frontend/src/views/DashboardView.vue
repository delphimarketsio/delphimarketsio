<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSearch } from '@/composables/useSearch'
import Header from '@/components/Header.vue'
import WorldNewsWidget from '@/components/WorldNewsWidget.vue'
import TrendingMarkets from '@/components/dashboard/TrendingMarkets.vue'
import MyMarkets from '@/components/dashboard/MyMarkets.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useLogger } from 'vue-logger-plugin'
import { useToastStore } from '@/stores/toast'
import { Plus } from 'lucide-vue-next'
import { WalletMultiButton } from 'solana-wallets-vue'
import ConnectWalletGate from '@/components/ConnectWalletGate.vue'
import HowItWorksBottomPopover from '@/components/HowItWorksBottomPopover.vue'

interface BetData {
  id: number
  shareUuid?: string
  title: string
  description: string
  myPosition?: string
  amount?: string
  status: 'active' | 'pending' | 'completed'
  participants?: string[]
  endDate: string
  isCreator: boolean
  isReferee: boolean
  isParticipant: boolean
  payout?: string
  won?: boolean
}

// Minimal helper interfaces to type on-chain objects without pulling full SDK types
interface BNLike {
  toNumber(): number
}
interface Stringable {
  toString(): string
}

interface PoolAccountData {
  creator: Stringable
  referee: Stringable
  betId: { toNumber(): number; toString(): string }
  title: string
  description: string
  endTimestamp: BNLike
  complete: boolean
  winner: 'yes' | 'no' | string
  yesReserve: BNLike
  noReserve: BNLike
  yesSupply: BNLike
  noSupply: BNLike
  shareUuid?: string
}

type Pool = { account: PoolAccountData }

interface EntryAccount {
  user: { toString(): string }
  betId: { toString(): string }
  isYes: boolean
  depositedSolAmount: BNLike
  tokenBalance: BNLike
}

type UserEntry = { account: EntryAccount }

const log = useLogger()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const toast = useToastStore()
const { filterBets, isSearchActive, searchQuery } = useSearch()

const loading = ref(true)
const isFetching = ref(false)
const pools = ref<Pool[]>([])
const userEntries = ref<UserEntry[]>([])
const allEntriesMap = ref<Map<number, UserEntry[]>>(new Map())
const loadError = ref<string | null>(null)
// Track last seen rate limit count to avoid duplicate toasts
let lastRateLimitCount = 0

// Fetch data from smart contract
// Entries fetching throttling to avoid RPC burst (aligned with store rate limiter ~18/10s)
const ENTRY_FETCH_DELAY_MS = 120
let entriesFetchGeneration = 0

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchEntriesSequential(
  betIds: number[],
  requestWallet: string | null | undefined,
  generation: number,
) {
  let failedEntriesCount = 0
  for (const betId of betIds) {
    // Abort if wallet changed or a new generation started
    if (workspaceStore.walletAddress !== requestWallet || generation !== entriesFetchGeneration) {
      return
    }
    if (allEntriesMap.value.has(betId)) continue
    try {
      const betEntries = await workspaceStore.getAllEntriesForBet(betId)
      // Guard again post await
      if (workspaceStore.walletAddress !== requestWallet || generation !== entriesFetchGeneration) {
        return
      }
      allEntriesMap.value.set(betId, betEntries as unknown as UserEntry[])
    } catch (error) {
      log.error(`Failed to fetch entries for bet ${betId}:`, error)
      allEntriesMap.value.set(betId, [])
      failedEntriesCount += 1
    }
    // Gentle spacing between requests (store cache + rate limiter provide further safety)
    await sleep(ENTRY_FETCH_DELAY_MS)
  }
  if (failedEntriesCount > 0) {
    toast.warning(
      `Some markets failed to load participants (${failedEntriesCount}). You can try again.`,
      'Partial load',
    )
  }
}

const fetchData = async () => {
  try {
    loadError.value = null
    if (isFetching.value || !workspaceStore.isAuthenticated) return
    isFetching.value = true
    loading.value = true

    // Capture wallet at request start to avoid stale writes if it changes mid-flight
    const requestWallet = workspaceStore.walletAddress

    // 1) Fetch user entries first
    const entries = await workspaceStore.getUserEntries()
    // If wallet changed during the request, abort applying results
    if (workspaceStore.walletAddress !== requestWallet) return
    userEntries.value = entries

    // If user has no entries, nothing to show yet
    const betIdsFromEntries = Array.from(
      new Set(entries.map((e) => parseInt(e.account.betId.toString(), 10))).values(),
    )

    // 2) Resolve pools for each bet_id using a single batch call
    const [batchPools, rolePools] = await Promise.all([
      workspaceStore.getPoolsByIds(betIdsFromEntries),
      workspaceStore.getPoolsByCreatorOrReferee(),
    ])

    // Merge creator/referee pools with pools discovered via entries, dedupe by betId
    const mergedAccounts: Array<{ betId: { toString(): string } } & Record<string, unknown>> = [
      ...batchPools,
      ...rolePools,
    ]
    const seen = new Set<string>()
    const deduped = mergedAccounts.filter((acc) => {
      const id = acc.betId?.toString?.()
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    // Check wallet consistency before applying
    if (workspaceStore.walletAddress !== requestWallet) return
    pools.value = deduped.map((account) => ({ account: account as unknown as PoolAccountData }))

    // 3) Background sequential fetch of entries (public data). Don't block main load completion.
    const betIdsFromRolePools = deduped.map((acc) => parseInt(acc.betId.toString(), 10))
    const betIdsForEntries = Array.from(new Set([...betIdsFromEntries, ...betIdsFromRolePools]))
    entriesFetchGeneration += 1
    void fetchEntriesSequential(betIdsForEntries, requestWallet, entriesFetchGeneration)
  } catch (error) {
    log.error('Failed to fetch market data:', error)
    const message = (error as Error)?.message || 'Unknown error'
    loadError.value = message
    toast.error('Failed to load your dashboard data. Please try again.', 'Load failed')
  } finally {
    isFetching.value = false
    loading.value = false
  }
}

// Watch for authentication changes and fetch data
watch(
  () => workspaceStore.isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      fetchData()
    } else {
      // Clear user-scoped data on logout to avoid showing stale info
      pools.value = []
      userEntries.value = []
      allEntriesMap.value = new Map()
      loading.value = false
    }
  },
  { immediate: true },
)

// Also react when the connected wallet address changes while remaining authenticated
watch(
  () => workspaceStore.walletAddress,
  (newAddress, oldAddress) => {
    if (newAddress === oldAddress) return
    // Reset state to prevent stale data flash and refetch for new wallet
    pools.value = []
    userEntries.value = []
    allEntriesMap.value = new Map()
    loadError.value = null
    if (newAddress) {
      fetchData()
    }
  },
)

// Warn user if we begin hitting RPC rate limits (helpful for debugging or advising patience)
watch(
  () => workspaceStore.rateLimitHitCount,
  (count) => {
    if (typeof count !== 'number') return
    if (count > lastRateLimitCount) {
      lastRateLimitCount = count
      toast.warning(
        'Network is rate limiting requests. Data may refresh more slowly for a short period.',
        'RPC rate limit encountered',
      )
    }
  },
  { immediate: false },
)

// Transform smart contract data to UI format
const userBets = computed((): BetData[] => {
  if (!workspaceStore.walletAddress) return []

  // Pools list already scoped to user's entries; no need to filter by creator/referee here
  const relevantPools = pools.value

  return relevantPools.map((pool) => {
    const poolData = pool.account
    const userEntry = userEntries.value.find(
      (entry) => entry.account.betId.toString() === poolData.betId.toString(),
    )

    const endTs = poolData.endTimestamp?.toNumber?.()
    const isOpenEnded = endTs != null && endTs < 0
    const endDate = isOpenEnded ? 'Open-ended' : new Date((endTs ?? 0) * 1000).toLocaleDateString()

    let status: 'active' | 'pending' | 'completed' = 'active'
    if (poolData.complete) status = 'completed'
    else if (!isOpenEnded && Date.now() > (endTs ?? 0) * 1000) status = 'pending'

    const betId = poolData.betId.toNumber()
    const betEntries = allEntriesMap.value.get(betId) || []
    // Exclude other users with 0 SOL, keep own 0 SOL entry
    const participantCount = betEntries.filter((e) => {
      const isCurrentUser = e.account.user?.toString?.() === workspaceStore.walletAddress
      const lamports = e.account.depositedSolAmount?.toNumber?.() ?? 0
      return isCurrentUser || lamports > 0
    }).length
    const participantsText =
      participantCount === 1 ? '1 participant' : `${participantCount} participants`

    let payout: string | undefined
    let won: boolean | undefined
    if (poolData.complete && userEntry) {
      const winner = poolData.winner === 'yes'
      won = userEntry.account.isYes === winner
      if (won) {
        let claimableAmount = userEntry.account.depositedSolAmount.toNumber()
        const losingReserve = winner
          ? poolData.noReserve.toNumber()
          : poolData.yesReserve.toNumber()
        const winningSupply = winner ? poolData.yesSupply.toNumber() : poolData.noSupply.toNumber()
        if (winningSupply > 0 && losingReserve > 0) {
          const userProfit =
            (userEntry.account.tokenBalance.toNumber() * losingReserve) / winningSupply
          claimableAmount += userProfit
        }
        payout = `${(claimableAmount / 1e9).toFixed(3)} SOL`
      } else {
        payout = '0 SOL'
      }
    }

    return {
      id: poolData.betId.toNumber(),
      shareUuid: poolData.shareUuid, // optional UUID for canonical routing
      title: poolData.title,
      description: poolData.description,
      myPosition: userEntry ? (userEntry.account.isYes ? 'Yes' : 'No') : undefined,
      amount: userEntry
        ? `${(userEntry.account.depositedSolAmount.toNumber() / 1e9).toFixed(3)} SOL`
        : undefined,
      status,
      participants: [participantsText],
      endDate,
      isCreator: poolData.creator.toString() === workspaceStore.walletAddress,
      isReferee: poolData.referee.toString() === workspaceStore.walletAddress,
      isParticipant: !!userEntry,
      payout,
      won,
    }
  })
})

const createNewBet = () => router.push('/create-bet')

// View state: trending vs my markets (my only available when authenticated)
const activeTab = ref<'trending' | 'my'>('trending')
const tabs = computed(() => {
  return workspaceStore.isAuthenticated
    ? [
        { id: 'trending', label: 'Trending' },
        { id: 'my', label: 'My Markets' },
      ]
    : [{ id: 'trending', label: 'Trending' }]
})

// Apply search filtering to user bets
const filteredBets = computed(() => filterBets(userBets.value))
</script>

<template>
  <Header />
  <main class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-7xl mx-auto px-4 py-8">
      <!-- Welcome Section (public + authenticated) -->
      <div class="mb-8">
        <h1
          class="text-3xl font-bold text-gray-900 dark:text-white mb-2"
          v-if="workspaceStore.isAuthenticated"
        >
          Welcome back, {{ workspaceStore.user?.name || 'trader' }}!
        </h1>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2" v-else>
          Explore Prediction Markets
        </h1>
        <p class="text-gray-600 dark:text-gray-400" v-if="workspaceStore.isAuthenticated">
          Manage your markets and create new ones to share with friends
        </p>
        <p class="text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-2" v-else>
          <span>Browse trending markets.</span>
          <span class="inline-connect-button text-link-wallet-btn">
            <ConnectWalletGate :enabled="!workspaceStore.isAuthenticated">
              <template #button>
                <WalletMultiButton>
                  <template #select-wallet-content>
                    <span class="flex items-center gap-1">
                      <span>Connect Wallet</span>
                    </span>
                  </template>
                </WalletMultiButton>
              </template>
            </ConnectWalletGate>
          </span>
          <span>to create or participate.</span>
        </p>
      </div>

      <!-- Quick Actions -->
      <div class="mb-8 flex flex-col sm:flex-row gap-4" v-if="workspaceStore.isAuthenticated">
        <Button @click="createNewBet" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">
          <Plus class="h-4 w-4" />
          Create New Market
        </Button>
      </div>

      <!-- Statistics (authenticated only) -->
      <div
        v-if="workspaceStore.isAuthenticated"
        class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10"
      >
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-lg">Active Markets</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-[#3B82F6]">
              {{ userBets.filter((bet) => bet.status === 'active').length }}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-lg">Total Committed</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-[#3B82F6]">
              {{
                userBets
                  .filter((bet) => bet.amount)
                  .reduce((sum, bet) => {
                    const amount = bet.amount ? parseFloat(bet.amount.replace(' SOL', '')) : 0
                    return sum + amount
                  }, 0)
                  .toFixed(1)
              }}
              SOL
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-lg">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-[#3B82F6]">
              {{
                userBets.filter((bet) => bet.status === 'completed').length > 0
                  ? Math.round(
                      (userBets.filter((bet) => bet.status === 'completed' && bet.won === true)
                        .length /
                        userBets.filter((bet) => bet.status === 'completed').length) *
                        100,
                    ) + '%'
                  : '--'
              }}
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {{
                userBets.filter((bet) => bet.status === 'completed').length === 0
                  ? 'No resolved markets yet'
                  : userBets.filter((bet) => bet.status === 'completed').length +
                    ' resolved market(s)'
              }}
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Portfolio + Sidebar with Tabs -->
      <div class="mb-8 flex flex-col xl:flex-row gap-10 items-start">
        <div class="flex-1 min-w-0">
          <!-- Tabs -->
          <div class="flex gap-2 border-b border-gray-200 dark:border-gray-700 mb-6">
            <button
              v-for="t in tabs"
              :key="t.id"
              @click="activeTab = t.id as any"
              class="px-4 py-2 -mb-px text-sm font-medium border-b-2"
              :class="
                activeTab === t.id
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              "
            >
              {{ t.label }}
            </button>
          </div>
          <div v-if="activeTab === 'trending'">
            <TrendingMarkets />
            <div
              v-if="!workspaceStore.isAuthenticated"
              class="mt-4 p-6 rounded-lg border border-dashed border-[#3B82F6]/40 bg-white dark:bg-gray-800"
            >
              <h3 class="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
                Ready to Participate?
              </h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Connect a Solana wallet to create markets or stake on existing ones.
              </p>
              <div class="large-swv-button-wrapper flex flex-col gap-2 inline-connect-button">
                <ConnectWalletGate :enabled="!workspaceStore.isAuthenticated">
                  <template #button>
                    <WalletMultiButton>
                      <template #select-wallet-content>
                        <span class="flex items-center gap-2">
                          <span>Connect Wallet</span>
                        </span>
                      </template>
                    </WalletMultiButton>
                  </template>
                </ConnectWalletGate>
                <span class="text-xs text-gray-500 dark:text-gray-500">
                  Secure non-custodial connection. Powered by Solana wallets.
                </span>
              </div>
            </div>
          </div>
          <div v-else>
            <MyMarkets
              :user-bets="userBets"
              :filtered-bets="filteredBets"
              :loading="loading"
              :load-error="loadError"
              :is-search-active="isSearchActive"
              :search-query="searchQuery"
              :on-retry="fetchData"
            />
          </div>
        </div>
        <aside class="w-full xl:w-96 flex-shrink-0">
          <WorldNewsWidget />
        </aside>
      </div>
    </div>
    <!-- Bottom primer for unauthenticated users -->
    <HowItWorksBottomPopover :is-authenticated="workspaceStore.isAuthenticated" />
  </main>
</template>

<style scoped>
/* Shrink wallet connect buttons inside inline hint wrappers */
.inline-connect-button {
  display: inline-flex;
}

/* Target common internal button selectors used by solana-wallet adapters */
.inline-connect-button :deep(button),
.inline-connect-button :deep(.wallet-adapter-button),
.inline-connect-button :deep(.swv-button),
.inline-connect-button :deep(.wallet-multi-button) {
  font-size: 0.7rem; /* slightly smaller than text-xs */
  line-height: 0.95rem;
  padding: 0.3rem 0.55rem;
  border-radius: 0.45rem;
  min-height: unset;
  height: auto;
}

/* Reduce any embedded icon size */
.inline-connect-button :deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}

/* Text-like variant (inline sentence). Applied in addition to inline-connect-button */
.text-link-wallet-btn :deep(button),
.text-link-wallet-btn :deep(.wallet-adapter-button),
.text-link-wallet-btn :deep(.swv-button),
.text-link-wallet-btn :deep(.wallet-multi-button) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  font-size: inherit !important;
  line-height: inherit !important;
  height: auto !important;
  color: #3b82f6 !important;
  font-weight: 500;
  text-decoration: underline;
  cursor: pointer;
  border-radius: 0; /* remove rounding for text look */
}

.text-link-wallet-btn :deep(button:hover),
.text-link-wallet-btn :deep(.wallet-adapter-button:hover),
.text-link-wallet-btn :deep(.swv-button:hover),
.text-link-wallet-btn :deep(.wallet-multi-button:hover) {
  text-decoration: none;
  color: #1d4ed8 !important; /* slightly darker on hover */
}

.text-link-wallet-btn :deep(button:focus-visible),
.text-link-wallet-btn :deep(.wallet-adapter-button:focus-visible),
.text-link-wallet-btn :deep(.swv-button:focus-visible),
.text-link-wallet-btn :deep(.wallet-multi-button:focus-visible) {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
