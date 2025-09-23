<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader, TriangleAlert, Inbox, Search } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToastStore } from '@/stores/toast'
import { useLogger } from 'vue-logger-plugin'

const props = defineProps<{
  userBets: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  filteredBets: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  loading: boolean
  loadError: string | null
  isSearchActive: boolean
  searchQuery: string
  onRetry: () => void
}>()

const router = useRouter()
const workspace = useWorkspaceStore()
const toast = useToastStore()
const log = useLogger()
const createNewBet = () => router.push('/create-bet')
// Navigate to canonical UUID route if shareUuid available; fallback to legacy numeric (should be rare)
const viewBetDetails = (bet: { id: number; shareUuid?: string }) => {
  if (bet.shareUuid) router.push({ name: 'bet-share', params: { uuid: bet.shareUuid } })
  else router.push(`/bet/${bet.id}`)
}

// Forward search context (in case parent passes differently later)
const total = computed(() => props.userBets.length)
const matches = computed(() => props.filteredBets.length)

interface MiniState {
  yesAmount: string
  noAmount: string
  loading: boolean
  pendingAuto: boolean
}
const miniStates = ref<Map<number, MiniState>>(new Map())
function getMiniState(id: number): MiniState {
  let s = miniStates.value.get(id)
  if (!s) {
    s = { yesAmount: '', noAmount: '', loading: false, pendingAuto: false }
    miniStates.value.set(id, s)
  }
  return s
}
function validateAmount(a: unknown) {
  if (a == null) return 'Enter amount'
  const str = String(a)
  const trimmed = str.trim()
  if (!trimmed) return 'Enter amount'
  const v = parseFloat(trimmed)
  if (Number.isNaN(v) || v <= 0) return 'Enter amount'
  return null
}
async function ensureEntry(betId: number) {
  try {
    const existing = await workspace.getUserEntryForBet(betId)
    if (existing) return
    await workspace.createEntry(betId)
    for (let i = 0; i < 2; i++) {
      const e = await workspace.getUserEntryForBet(betId)
      if (e) break
      await new Promise((r) => setTimeout(r, 300))
    }
  } catch (e) {
    log.warn('mini createEntry failed', betId, e)
  }
}

async function quickDeposit(
  bet: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  side: 'Yes' | 'No',
) {
  const state = getMiniState(bet.id)
  if (state.loading) return
  const rawAmount = side === 'Yes' ? state.yesAmount : state.noAmount
  const err = validateAmount(rawAmount)
  if (err) {
    toast.warning('Please enter a valid positive amount.', 'Invalid amount')
    return
  }
  if (!workspace.isAuthenticated) {
    state.pendingAuto = true
    toast.info('Connect your wallet to confirm this deposit.', 'Connect required')
    return
  }
  // Validate pool status and timing (fresh fetch)
  try {
    const pool = await workspace.getPoolById(bet.id, { force: true, ttlMs: 0 })
    if (!pool) {
      toast.error('Market data unavailable. Please retry.', 'Missing market')
      return
    }
    if (pool.complete) {
      toast.info('This market has been completed.', 'Deposit not allowed')
      return
    }
    const endTs = pool.endTimestamp?.toNumber?.()
    if (typeof endTs === 'number' && endTs >= 0) {
      const now = Math.floor(Date.now() / 1000)
      if (endTs <= now) {
        toast.info('This market has ended.', 'Deposit not allowed')
        return
      }
    }
  } catch (e) {
    log.warn('pool validation failed before deposit', bet.id, e)
  }
  state.loading = true
  try {
    await ensureEntry(bet.id)
    await workspace.deposit(bet.id, side === 'Yes', parseFloat(rawAmount))
    toast.success('Position placed.', 'Deposit successful')
    if (side === 'Yes') state.yesAmount = ''
    else state.noAmount = ''
  } catch (e) {
    log.error('mini deposit failed', e)
    toast.error((e as Error)?.message || 'Failed to deposit', 'Transaction failed')
  } finally {
    state.loading = false
    state.pendingAuto = false
  }
}
watch(
  () => workspace.isAuthenticated,
  (auth) => {
    if (!auth) return
    for (const [betId, s] of miniStates.value.entries()) {
      if (s.pendingAuto && !s.loading) {
        if (s.yesAmount.trim()) void quickDeposit({ id: betId }, 'Yes')
        else if (s.noAmount.trim()) void quickDeposit({ id: betId }, 'No')
        s.pendingAuto = false
      }
    }
  },
)

// Augment filteredBets with a derived _ended flag without mutating original objects permanently.
// We assume each bet has either endTimestamp (number | BN-like) or an already formatted endDate string.
// Open-ended markets use negative endTimestamp (mirroring TrendingMarkets logic) and never end automatically.
const nowSec = () => Math.floor(Date.now() / 1000)
const enhancedFilteredBets = computed(() => {
  return props.filteredBets.map(
    (
      b: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ) => {
      let endTs: number | null = null
      // Try multiple possible field shapes; guard with optional chaining.
      if (b.endTimestamp != null) {
        try {
          if (typeof b.endTimestamp === 'number') endTs = b.endTimestamp
          else if (typeof b.endTimestamp.toNumber === 'function') endTs = b.endTimestamp.toNumber()
        } catch {
          // ignore extraction errors
        }
      } else if (typeof b.endTs === 'number') {
        endTs = b.endTs
      }
      const isOpenEnded = endTs != null && endTs < 0
      let ended = false
      if (!isOpenEnded && typeof endTs === 'number') {
        ended = endTs < nowSec()
      }
      // Return a shallow clone with _ended annotation used only for UI conditionals
      return { ...b, _ended: ended }
    },
  )
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Your Market Portfolio</h2>
      <div v-if="isSearchActive" class="text-sm text-gray-600 dark:text-gray-400">
        {{ matches }} of {{ total }} markets match "{{ searchQuery }}"
      </div>
    </div>

    <div v-if="loading" class="text-center py-16">
      <div class="max-w-md mx-auto">
        <div class="mb-4">
          <Loader class="mx-auto h-16 w-16 text-gray-400 animate-spin" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">Loading markets...</h3>
        <p class="text-gray-500 dark:text-gray-400">
          Fetching your market data from the blockchain
        </p>
      </div>
    </div>

    <div v-else-if="loadError" class="text-center py-16">
      <div class="max-w-md mx-auto">
        <div class="mb-4">
          <TriangleAlert class="mx-auto h-16 w-16 text-red-500" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Could not load your markets
        </h3>
        <p class="text-gray-500 dark:text-gray-400 mb-6">{{ loadError }}</p>
        <div class="flex justify-center gap-3">
          <Button @click="onRetry" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">Retry</Button>
        </div>
      </div>
    </div>

    <div v-else-if="userBets.length === 0" class="text-center py-16">
      <div class="max-w-md mx-auto">
        <div class="mb-4">
          <Inbox class="mx-auto h-16 w-16 text-gray-400" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">No relevant markets</h3>
        <p class="text-gray-500 dark:text-gray-400 mb-6">
          You haven't created, joined, or been assigned as referee to any public markets yet. Start
          by creating your first market and sharing it with friends!
        </p>
        <Button @click="createNewBet" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">
          Create Your First Market
        </Button>
      </div>
    </div>

    <div v-else-if="filteredBets.length === 0 && isSearchActive" class="text-center py-16">
      <div class="max-w-md mx-auto">
        <div class="mb-4">
          <Search class="mx-auto h-16 w-16 text-gray-400" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">No markets found</h3>
        <p class="text-gray-500 dark:text-gray-400 mb-6">
          No markets match your search for "{{ searchQuery }}". Try a different search term or clear
          the search.
        </p>
      </div>
    </div>

    <div v-else class="grid gap-6 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
      <Card
        v-for="bet in enhancedFilteredBets"
        :key="bet.id"
        class="hover:shadow-lg transition-shadow flex flex-col h-full"
      >
        <CardHeader>
          <div class="flex items-center justify-between gap-3 mb-2">
            <CardTitle class="text-lg flex-1 min-w-0">{{ bet.title }}</CardTitle>
            <span
              class="px-2 py-1 text-xs rounded-full whitespace-nowrap"
              :class="{
                'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200':
                  bet.status === 'active',
                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200':
                  bet.status === 'pending',
                'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200':
                  bet.status === 'completed',
              }"
            >
              {{ bet.status }}
            </span>
          </div>
          <div
            class="flex gap-1 mb-2"
            v-if="bet.isCreator || bet.isReferee || (bet.isParticipant && !bet.isCreator)"
          >
            <span
              v-if="bet.isCreator"
              class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              title="You created this market"
              >Creator</span
            >
            <span
              v-if="bet.isReferee"
              class="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              title="You are the referee for this market"
              >Referee</span
            >
            <span
              v-if="bet.isParticipant && !bet.isCreator"
              class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              title="You are participating in this market"
              >Participant</span
            >
          </div>
          <CardDescription>
            <span class="text-ellipsis line-clamp-2 text-gray-600 dark:text-gray-400">
              {{ bet.description }}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-3 flex-grow">
          <div v-if="bet.myPosition" class="flex justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">Your Position:</span>
            <span class="font-medium">{{ bet.myPosition }}</span>
          </div>
          <div v-if="bet.amount" class="flex justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">Your Stake:</span>
            <span class="font-medium">{{ bet.amount }}</span>
          </div>
          <div v-if="bet.status === 'completed' && bet.payout" class="flex justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">Payout:</span>
            <span
              class="font-medium"
              :class="
                bet.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              "
              >{{ bet.payout }}</span
            >
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">Participants:</span>
            <span class="font-medium">{{ bet.participants?.join(', ') || 'Loading...' }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">End:</span>
            <span class="font-medium">{{ bet.endDate }}</span>
          </div>
          <div v-if="bet.isCreator" class="text-xs text-blue-600 dark:text-blue-400 font-medium">
            📝 You created this market
          </div>
          <div
            v-if="bet.status === 'completed' && bet.won === true"
            class="text-xs text-green-600 dark:text-green-400 font-medium"
          >
            🎉 You won this market!
          </div>
          <div
            v-if="bet.status === 'completed' && bet.won === false"
            class="text-xs text-red-600 dark:text-red-400 font-medium"
          >
            ❌ You lost this market
          </div>
          <!-- Determine ended state (fixed-time markets with a past end timestamp) -->
          <div
            v-if="bet.status === 'active'"
            class="pt-2 border-t border-gray-200 dark:border-gray-700 mt-2"
          >
            <div v-if="!bet._ended">
              <!-- If user already has a position, restrict to that side -->
              <div v-if="bet.myPosition === 'Yes'" class="grid grid-cols-1 gap-3">
                <div class="flex flex-col gap-1">
                  <label
                    class="text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
                    >Yes (add)</label
                  >
                  <div class="relative">
                    <input
                      v-model="getMiniState(bet.id).yesAmount"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="0.0"
                      class="w-full px-2 py-1.5 text-xs rounded-md border border-green-300 dark:border-green-700 bg-green-50/60 dark:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-500/60 text-green-900 dark:text-green-100 placeholder-green-400"
                    />
                    <span
                      class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-green-500"
                      >SOL</span
                    >
                  </div>
                  <Button
                    size="sm"
                    class="w-full text-xs bg-green-600 hover:bg-green-600/90 text-white"
                    :disabled="
                      getMiniState(bet.id).loading ||
                      validateAmount(getMiniState(bet.id).yesAmount) !== null
                    "
                    @click="quickDeposit(bet, 'Yes')"
                  >
                    <span v-if="!getMiniState(bet.id).loading">Add Yes Stake</span>
                    <span v-else>...</span>
                  </Button>
                </div>
              </div>
              <div v-else-if="bet.myPosition === 'No'" class="grid grid-cols-1 gap-3">
                <div class="flex flex-col gap-1">
                  <label
                    class="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
                    >No (add)</label
                  >
                  <div class="relative">
                    <input
                      v-model="getMiniState(bet.id).noAmount"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="0.0"
                      class="w-full px-2 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500/60 text-red-900 dark:text-red-100 placeholder-red-400"
                    />
                    <span class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-500"
                      >SOL</span
                    >
                  </div>
                  <Button
                    size="sm"
                    class="w-full text-xs bg-red-600 hover:bg-red-600/90 text-white"
                    :disabled="
                      getMiniState(bet.id).loading ||
                      validateAmount(getMiniState(bet.id).noAmount) !== null
                    "
                    @click="quickDeposit(bet, 'No')"
                  >
                    <span v-if="!getMiniState(bet.id).loading">Add No Stake</span>
                    <span v-else>...</span>
                  </Button>
                </div>
              </div>
              <div v-else class="grid grid-cols-2 gap-3">
                <!-- Original two-sided UI when user has no position -->
                <div class="flex flex-col gap-1">
                  <label
                    class="text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
                    >Yes</label
                  >
                  <div class="relative">
                    <input
                      v-model="getMiniState(bet.id).yesAmount"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="0.0"
                      class="w-full px-2 py-1.5 text-xs rounded-md border border-green-300 dark:border-green-700 bg-green-50/60 dark:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-500/60 text-green-900 dark:text-green-100 placeholder-green-400"
                    />
                    <span
                      class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-green-500"
                      >SOL</span
                    >
                  </div>
                  <Button
                    size="sm"
                    class="w-full text-xs bg-green-600 hover:bg-green-600/90 text-white"
                    :disabled="
                      getMiniState(bet.id).loading ||
                      validateAmount(getMiniState(bet.id).yesAmount) !== null
                    "
                    @click="quickDeposit(bet, 'Yes')"
                  >
                    <span v-if="!getMiniState(bet.id).loading">Deposit Yes</span>
                    <span v-else>...</span>
                  </Button>
                </div>
                <div class="flex flex-col gap-1">
                  <label
                    class="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
                    >No</label
                  >
                  <div class="relative">
                    <input
                      v-model="getMiniState(bet.id).noAmount"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="0.0"
                      class="w-full px-2 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500/60 text-red-900 dark:text-red-100 placeholder-red-400"
                    />
                    <span class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-500"
                      >SOL</span
                    >
                  </div>
                  <Button
                    size="sm"
                    class="w-full text-xs bg-red-600 hover:bg-red-600/90 text-white"
                    :disabled="
                      getMiniState(bet.id).loading ||
                      validateAmount(getMiniState(bet.id).noAmount) !== null
                    "
                    @click="quickDeposit(bet, 'No')"
                  >
                    <span v-if="!getMiniState(bet.id).loading">Deposit No</span>
                    <span v-else>...</span>
                  </Button>
                </div>
              </div>
            </div>
            <div
              v-else
              class="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
            >
              This market has ended. You can no longer deposit.
            </div>
          </div>
        </CardContent>
        <CardFooter class="mt-auto">
          <Button @click="viewBetDetails(bet)" variant="outline" class="w-full"
            >View Details</Button
          >
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
