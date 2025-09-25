<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToastStore } from '@/stores/toast'
import { useLogger } from 'vue-logger-plugin'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Flame, BarChart3, RefreshCcw } from 'lucide-vue-next'
import { useSearch } from '@/composables/useSearch'

interface PoolLite {
  betId: { toNumber(): number; toString(): string }
  title: string
  description: string
  endTimestamp: { toNumber(): number }
  complete: boolean
  yesReserve: { toNumber(): number }
  noReserve: { toNumber(): number }
  yesSupply: { toNumber(): number }
  noSupply: { toNumber(): number }
  shareUuid?: string
}

// Mini participation state per bet (kept local to component to avoid global store churn)
interface MiniParticipationState {
  yesAmount: string
  noAmount: string
  loading: boolean
  pendingAuto: boolean
}

interface EntryLite {
  account: {
    betId: { toNumber(): number; toString(): string }
    depositedSolAmount: { toNumber(): number }
    isYes?: boolean
  }
}

const workspace = useWorkspaceStore()
const toast = useToastStore()
const log = useLogger()
const router = useRouter()
const emit = defineEmits<{ (e: 'after-action', betId: number): void }>()

const loading = ref(false)
const pools = ref<PoolLite[]>([])
const entriesMap = ref<Map<number, EntryLite[]>>(new Map())
const loadError = ref<string | null>(null)

// Map of betId -> user's joined side ("Yes" | "No") for rendering joined markets correctly
const userPositionMap = ref<Map<number, 'Yes' | 'No'>>(new Map())

// Map betId -> participation state
const miniStates = ref<Map<number, MiniParticipationState>>(new Map())

function getMiniState(id: number): MiniParticipationState {
  let s = miniStates.value.get(id)
  if (!s) {
    s = { yesAmount: '', noAmount: '', loading: false, pendingAuto: false }
    miniStates.value.set(id, s)
  }
  return s
}

// Infinite scroll & adjustable size
const pageSizeOptions = [12, 24, 48]
const pageSize = ref<number>(12)
const visibleCount = ref<number>(pageSize.value)
const sentinel = ref<HTMLElement | null>(null)
const loadingMore = ref(false)

// Virtualization state
const virtualContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const CARD_ESTIMATED_HEIGHT = 330 // px (approximate card height + gap)
const VIRTUAL_BUFFER = 3
const useVirtualization = computed(() => displayedTrending.value.length > 100) // activate only for large lists

// Persist page size
const PAGE_SIZE_KEY = 'trendingPageSize'

// Global search state reuse
const { searchQuery, isSearchActive } = useSearch()
const isAuthenticated = computed(() => workspace.isAuthenticated)

// --- Lazy sequential entries loading ---
const ENTRY_BATCH_DELAY_MS = 110
let entriesGeneration = 0
let loadingEntries = false

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function loadEntriesForVisible(force = false) {
  if (loadingEntries) return
  loadingEntries = true
  const myGen = ++entriesGeneration
  try {
    const source = useVirtualization.value ? virtualItems.value : displayedTrending.value
    const betIds = source.map((m) => m.id)
    for (const betId of betIds) {
      if (entriesGeneration !== myGen) return
      if (entriesMap.value.has(betId) && !force) continue
      try {
        const es = (await workspace.getAllEntriesForBet(betId, {
          force,
        })) as unknown as EntryLite[]
        if (entriesGeneration !== myGen) return
        entriesMap.value.set(betId, es)
      } catch (e) {
        log.warn('failed entries fetch (trending)', betId, e)
        if (!entriesMap.value.has(betId)) entriesMap.value.set(betId, [])
      }
      await sleep(ENTRY_BATCH_DELAY_MS)
    }
  } finally {
    loadingEntries = false
  }
}

// Refresh a single market's data (pool and entries) after a user action to reflect on-chain state
async function refreshAfterAction(betId: number) {
  try {
    // Force-refresh pool to get updated reserves/liquidity
    const freshPool = (await workspace.getPoolById(betId, {
      force: true,
      ttlMs: 0,
    })) as unknown as PoolLite | null
    if (freshPool) {
      // Replace the pool in-place to trigger reactivity without full reload
      const idx = pools.value.findIndex((p) => p.betId.toNumber() === betId)
      if (idx !== -1) pools.value[idx] = freshPool
      else pools.value = [...pools.value, freshPool]
    }

    // Force-refresh entries for this bet (drives participants/volume stats)
    const freshEntries = (await workspace.getAllEntriesForBet(betId, {
      force: true,
    })) as unknown as EntryLite[]
    entriesMap.value.set(betId, freshEntries)
    // Refresh user entries cache so other views (e.g., MyMarkets) can reflect new position promptly
    await workspace.getUserEntries(undefined, { force: true })
  } catch (err) {
    log.warn('partial refresh failed after action', betId, err)
  }
}

async function load(force = false) {
  const activeProgram = workspace.program || workspace.getReadOnlyProgram()
  if (!activeProgram) return
  loading.value = true
  loadError.value = null
  try {
    const allPools = await workspace.getAllPools({ force })
    pools.value = allPools as unknown as PoolLite[]
    // Entries now loaded lazily; existing map retained (invalidate selectively later)
  } catch (e) {
    loadError.value = (e as Error)?.message || 'Unknown error'
    toast.error('Failed to load trending markets')
  } finally {
    loading.value = false
    await nextTick()
    measureContainer()
  }
}

// Reload when authentication state transitions to authenticated (to leverage user cache if needed)
watch(isAuthenticated, () => {
  load()
  loadUserParticipation()
})
onMounted(() => {
  // restore page size
  const saved = parseInt(localStorage.getItem(PAGE_SIZE_KEY) || '', 10)
  if (!Number.isNaN(saved) && pageSizeOptions.includes(saved)) {
    pageSize.value = saved
    visibleCount.value = saved
  }
  // Always load trending markets for public visitors
  load().then(() => {
    // kick off initial visible entries load without blocking
    void loadEntriesForVisible()
    // load participation if already authenticated
    if (workspace.isAuthenticated) void loadUserParticipation()
  })
  setupObserver()
  window.addEventListener('resize', measureContainer)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureContainer)
})

watch(pageSize, (val) => {
  localStorage.setItem(PAGE_SIZE_KEY, String(val))
  visibleCount.value = val
})

// Trending scoring
const trending = computed(() => {
  const items = pools.value.map((p) => {
    const betId = p.betId.toNumber()
    const entries = entriesMap.value.get(betId) || []
    const participantCount = entries.filter(
      (e) => (e.account.depositedSolAmount?.toNumber?.() ?? 0) > 0,
    ).length
    const volumeLamports = entries.reduce(
      (sum, e) => sum + (e.account.depositedSolAmount?.toNumber?.() ?? 0),
      0,
    )
    const liquidity = p.yesReserve.toNumber() + p.noReserve.toNumber()
    const volumeSol = volumeLamports / 1e9
    const participantsWeight = participantCount * 5
    const volumeWeight = Math.log10(1 + volumeSol) * 10
    const liquidityWeight = Math.log10(1 + liquidity / 1e9) * 8
    const completionPenalty = p.complete ? 25 : 0
    const score = participantsWeight + volumeWeight + liquidityWeight - completionPenalty
    const endTs = p.endTimestamp?.toNumber?.()
    const isOpenEnded = endTs != null && endTs < 0
    const endDate = isOpenEnded ? 'Open-ended' : new Date((endTs ?? 0) * 1000).toLocaleDateString()
    let ended = false
    if (!isOpenEnded && typeof endTs === 'number') {
      ended = endTs * 1000 < Date.now()
    }
    return {
      id: betId,
      title: p.title,
      description: p.description,
      participants: participantCount,
      volumeSol: volumeSol,
      liquiditySol: liquidity / 1e9,
      complete: p.complete,
      endDate,
      ended,
      score,
      shareUuid: p.shareUuid,
      myPosition: userPositionMap.value.get(betId),
    }
  })
  return items
    .filter((i) => !i.complete)
    .sort((a, b) => b.score - a.score)
})

const filteredTrending = computed(() => {
  if (!isSearchActive.value) return trending.value
  const q = searchQuery.value.toLowerCase().trim()
  return trending.value.filter(
    (m) => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
  )
})

watch(searchQuery, () => {
  visibleCount.value = pageSize.value
  scrollTop.value = 0
  entriesGeneration++
  void loadEntriesForVisible(true)
})

// Clamp visibleCount if list shrinks; do not otherwise reset (preserves Load More state)
watch(
  () => trending.value.length,
  (newLen) => {
    if (newLen < visibleCount.value) {
      visibleCount.value = Math.max(Math.min(visibleCount.value, newLen), pageSize.value)
    }
  },
)
watch(pageSize, (val) => {
  visibleCount.value = val
})

const displayedTrending = computed(() => filteredTrending.value.slice(0, visibleCount.value))
const canLoadMore = computed(
  () => visibleCount.value < filteredTrending.value.length && !loading.value,
)

function loadMore() {
  if (!canLoadMore.value) return
  loadingMore.value = true
  requestAnimationFrame(() => {
    visibleCount.value = Math.min(
      visibleCount.value + pageSize.value,
      filteredTrending.value.length,
    )
    loadingMore.value = false
    nextTick(measureContainer)
    void loadEntriesForVisible()
  })
}

function setupObserver() {
  if (!('IntersectionObserver' in window)) return
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry) return
      if (entry.isIntersecting) loadMore()
    },
    { rootMargin: '150px 0px 0px 0px', threshold: 0 },
  )
  if (sentinel.value) observer.observe(sentinel.value)
}

function measureContainer() {
  if (virtualContainer.value) {
    containerHeight.value = virtualContainer.value.clientHeight
  } else {
    containerHeight.value = window.innerHeight - 420
  }
}

function onScroll() {
  if (!virtualContainer.value) return
  scrollTop.value = virtualContainer.value.scrollTop
  if (useVirtualization.value) {
    void loadEntriesForVisible()
  }
}

const startIndex = computed(() => {
  if (!useVirtualization.value) return 0
  return Math.max(0, Math.floor(scrollTop.value / CARD_ESTIMATED_HEIGHT) - VIRTUAL_BUFFER)
})
const endIndex = computed(() => {
  if (!useVirtualization.value) return displayedTrending.value.length
  const visible =
    Math.ceil((scrollTop.value + containerHeight.value) / CARD_ESTIMATED_HEIGHT) + VIRTUAL_BUFFER
  return Math.min(displayedTrending.value.length, visible)
})
const virtualItems = computed(() => displayedTrending.value.slice(startIndex.value, endIndex.value))
const topSpacer = computed(() => startIndex.value * CARD_ESTIMATED_HEIGHT)
const bottomSpacer = computed(
  () => (displayedTrending.value.length - endIndex.value) * CARD_ESTIMATED_HEIGHT,
)

async function viewBet(m: { id: number; shareUuid?: string }) {
  // Use existing shareUuid if present
  if (m.shareUuid) {
    router.push({ name: 'bet-share', params: { uuid: m.shareUuid } })
    return
  }
  // Attempt lazy fetch to resolve UUID to avoid falling back to numeric path
  try {
    const pool = await workspace.getPoolById(m.id)
    const uuid = (pool as { shareUuid?: string } | null)?.shareUuid
    if (uuid) {
      router.push({ name: 'bet-share', params: { uuid }, replace: true })
      return
    }
  } catch (e) {
    log.warn('Failed to resolve shareUuid for bet', m.id, e)
  }
  // Final fallback (should be rare): numeric path (may not resolve if route removed)
  router.push(`/bet/${m.id}`)
}
function refresh() {
  load(true)
}

// ---------------- Mini Participate Logic ----------------
// (No constant needed here; pricing preview intentionally omitted for compactness)

function validateAmount(amount: unknown): string | null {
  if (amount == null) return 'Enter amount'
  const str = String(amount)
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
    // small retry to make sure propagation
    for (let i = 0; i < 2; i++) {
      const e = await workspace.getUserEntryForBet(betId)
      if (e) break
      await new Promise((r) => setTimeout(r, 300))
    }
  } catch (e) {
    log.warn('mini createEntry failed', betId, e)
  }
}

async function quickDeposit(betId: number, side: 'Yes' | 'No') {
  const state = getMiniState(betId)
  if (state.loading) return
  const rawAmount = side === 'Yes' ? state.yesAmount : state.noAmount
  const amountErr = validateAmount(rawAmount)
  if (amountErr) {
    toast.warning('Please enter a valid positive amount.', 'Invalid amount')
    return
  }
  if (!workspace.isAuthenticated) {
    // trigger wallet connect UI indirectly by setting a flag; assume a global wallet button present
    state.pendingAuto = true
    toast.info('Connect your wallet to confirm this deposit.', 'Connect required')
    return
  }
  // Fetch latest pool to validate status & timing (avoid stale trending snapshot)
  try {
    const pool = await workspace.getPoolById(betId, { force: true, ttlMs: 0 })
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
    log.warn('pool validation failed before deposit', betId, e)
  }
  state.loading = true
  try {
    await ensureEntry(betId)
    await workspace.deposit(betId, side === 'Yes', parseFloat(rawAmount))
    toast.success('Position placed.', 'Deposit successful')
    if (side === 'Yes') state.yesAmount = ''
    else state.noAmount = ''
    // Update user's joined side so UI restricts to that side going forward
    userPositionMap.value.set(betId, side)
    // Fetch updated pool + entries from chain to reflect new state now
    await refreshAfterAction(betId)
    // Notify parent views (Dashboard) so MyMarkets can refetch immediately
    emit('after-action', betId)
  } catch (e) {
    log.error('mini deposit failed', e)
    const msg = (e as Error)?.message || 'Failed to deposit'
    toast.error(msg, 'Transaction failed')
  } finally {
    state.loading = false
    state.pendingAuto = false
  }
}

// ---------------- User Participation (side) Logic ----------------
async function loadUserParticipation() {
  if (!workspace.isAuthenticated) {
    userPositionMap.value = new Map()
    return
  }
  try {
    const entries = (await workspace.getUserEntries()) as any[] // eslint-disable-line @typescript-eslint/no-explicit-any
    const map = new Map<number, 'Yes' | 'No'>()
    for (const e of entries) {
      const amt = e?.account?.depositedSolAmount?.toNumber?.() ?? 0
      if (amt > 0) {
        const id = e?.account?.betId?.toNumber?.()
        const isYes = e?.account?.isYes === true
        if (typeof id === 'number') map.set(id, isYes ? 'Yes' : 'No')
      }
    }
    userPositionMap.value = map
  } catch (err) {
    log.warn('failed to load user participation bet IDs', err)
  }
}
// ---------------------------------------------------------------

// After auth, auto-complete any pending mini deposits
watch(
  () => workspace.isAuthenticated,
  (auth) => {
    if (!auth) return
    for (const [betId, s] of miniStates.value.entries()) {
      if (s.pendingAuto && !s.loading) {
        // Prefer Yes side if amount present, else No
        if (s.yesAmount.trim()) void quickDeposit(betId, 'Yes')
        else if (s.noAmount.trim()) void quickDeposit(betId, 'No')
        s.pendingAuto = false
      }
    }
  },
)
// --------------------------------------------------------
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-4">
      <div class="flex items-center gap-2">
        <Flame class="h-6 w-6 text-orange-500" />
        <h2 class="text-2xl font-semibold">Trending Markets</h2>
      </div>
      <div class="flex items-center gap-3">
        <label class="text-sm text-gray-600 dark:text-gray-400">Page size:</label>
        <select
          v-model.number="pageSize"
          class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
        >
          <option v-for="opt in pageSizeOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <Button variant="outline" size="sm" @click="refresh" :disabled="loading">
          <RefreshCcw class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Initial skeleton loading -->
    <div v-if="loading" class="grid gap-6 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
      <div
        v-for="n in 8"
        :key="n"
        class="h-[300px] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse"
      />
    </div>
    <div v-else-if="loadError" class="py-20 text-center">
      <p class="text-red-500 mb-4">{{ loadError }}</p>
      <Button @click="refresh" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">Retry</Button>
    </div>
    <div v-else>
      <div v-if="isSearchActive" class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {{ filteredTrending.length }} of {{ trending.length }} markets match "{{ searchQuery }}"
      </div>
      <div
        v-if="filteredTrending.length === 0 && isSearchActive"
        class="py-20 text-center text-gray-500 dark:text-gray-400"
      >
        No markets match your search for "{{ searchQuery }}".
      </div>
      <div v-else-if="trending.length === 0" class="py-20 text-center text-gray-500">
        No active markets yet.
      </div>
      <div v-else>
        <!-- Virtualized container (activated only for large lists) -->
        <div
          :class="useVirtualization ? 'relative overflow-y-auto border border-transparent' : ''"
          :style="useVirtualization ? 'max-height:calc(100vh - 420px);' : ''"
          ref="virtualContainer"
          @scroll="onScroll"
        >
          <div v-if="useVirtualization" :style="{ height: topSpacer + 'px' }" aria-hidden="true" />
          <div class="grid gap-6 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
            <Card
              v-for="m in useVirtualization ? virtualItems : displayedTrending"
              :key="m.id"
              class="hover:shadow-lg transition-shadow flex flex-col h-full"
            >
              <CardHeader>
                <div class="flex items-center justify-between mb-2">
                  <CardTitle class="text-lg line-clamp-1">{{ m.title }}</CardTitle>
                  <span
                    class="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                    >Hot</span
                  >
                </div>
                <CardDescription class="line-clamp-2">{{ m.description }}</CardDescription>
              </CardHeader>
              <CardContent class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span>Participants</span><span>{{ m.participants }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="flex items-center gap-1"><BarChart3 class="h-3 w-3" /> Volume</span>
                  <span>{{ m.volumeSol.toFixed(2) }} SOL</span>
                </div>
                <div class="flex justify-between">
                  <span>Liquidity</span><span>{{ m.liquiditySol.toFixed(2) }} SOL</span>
                </div>
                <div class="flex justify-between">
                  <span>End</span><span>{{ m.endDate }}</span>
                </div>
              </CardContent>
              <CardFooter class="mt-auto">
                <div class="w-full flex flex-col gap-2">
                  <!-- Quick deposit UI: mirror MyMarkets behavior for joined markets -->
                  <div v-if="!m.ended">
                    <!-- If user has a position, restrict to that side -->
                    <div v-if="m.myPosition === 'Yes'" class="grid grid-cols-1 gap-2">
                      <div class="flex flex-col gap-1">
                        <label
                          class="text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
                          >Yes (add)</label
                        >
                        <div class="relative">
                          <input
                            v-model="getMiniState(m.id).yesAmount"
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
                            getMiniState(m.id).loading ||
                            validateAmount(getMiniState(m.id).yesAmount) !== null
                          "
                          @click="quickDeposit(m.id, 'Yes')"
                        >
                          <span v-if="!getMiniState(m.id).loading">Add Yes Stake</span>
                          <span v-else>...</span>
                        </Button>
                      </div>
                    </div>
                    <div v-else-if="m.myPosition === 'No'" class="grid grid-cols-1 gap-2">
                      <div class="flex flex-col gap-1">
                        <label
                          class="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
                          >No (add)</label
                        >
                        <div class="relative">
                          <input
                            v-model="getMiniState(m.id).noAmount"
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder="0.0"
                            class="w-full px-2 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500/60 text-red-900 dark:text-red-100 placeholder-red-400"
                          />
                          <span
                            class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-500"
                            >SOL</span
                          >
                        </div>
                        <Button
                          size="sm"
                          class="w-full text-xs bg-red-600 hover:bg-red-600/90 text-white"
                          :disabled="
                            getMiniState(m.id).loading ||
                            validateAmount(getMiniState(m.id).noAmount) !== null
                          "
                          @click="quickDeposit(m.id, 'No')"
                        >
                          <span v-if="!getMiniState(m.id).loading">Add No Stake</span>
                          <span v-else>...</span>
                        </Button>
                      </div>
                    </div>
                    <!-- If no position, show both sides -->
                    <div v-else class="grid grid-cols-2 gap-2">
                      <div class="flex flex-col gap-1">
                        <label
                          class="text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
                          >Yes</label
                        >
                        <div class="relative">
                          <input
                            v-model="getMiniState(m.id).yesAmount"
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
                            getMiniState(m.id).loading ||
                            validateAmount(getMiniState(m.id).yesAmount) !== null
                          "
                          @click="quickDeposit(m.id, 'Yes')"
                        >
                          <span v-if="!getMiniState(m.id).loading">Deposit Yes</span>
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
                            v-model="getMiniState(m.id).noAmount"
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder="0.0"
                            class="w-full px-2 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500/60 text-red-900 dark:text-red-100 placeholder-red-400"
                          />
                          <span
                            class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-500"
                            >SOL</span
                          >
                        </div>
                        <Button
                          size="sm"
                          class="w-full text-xs bg-red-600 hover:bg-red-600/90 text-white"
                          :disabled="
                            getMiniState(m.id).loading ||
                            validateAmount(getMiniState(m.id).noAmount) !== null
                          "
                          @click="quickDeposit(m.id, 'No')"
                        >
                          <span v-if="!getMiniState(m.id).loading">Deposit No</span>
                          <span v-else>...</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                  <!-- If ended (but not complete), show info instead of deposit UI -->
                  <div
                    v-else
                    class="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                  >
                    This market has ended. You can no longer deposit.
                  </div>
                  <Button variant="outline" class="w-full" size="sm" @click="viewBet(m)"
                    >View Details</Button
                  >
                </div>
              </CardFooter>
            </Card>
          </div>
          <div
            v-if="useVirtualization"
            :style="{ height: bottomSpacer + 'px' }"
            aria-hidden="true"
          />
        </div>
        <div class="mt-8 flex justify-center" v-if="canLoadMore && !useVirtualization">
          <Button variant="outline" @click="loadMore" :disabled="loadingMore">Load More</Button>
        </div>
        <!-- Skeletons when loading more (non-virtualized) -->
        <div
          v-if="loadingMore && !useVirtualization"
          class="grid gap-6 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] mt-6"
        >
          <div
            v-for="n in 3"
            :key="'lm-' + n"
            class="h-[300px] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse"
          />
        </div>
        <!-- Sentinel for infinite scroll -->
        <div ref="sentinel" class="h-1 w-full" />
      </div>
    </div>
  </div>
</template>
