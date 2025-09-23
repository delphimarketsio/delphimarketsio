<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import Header from '@/components/Header.vue'
import ProbabilityChart from '@/components/ProbabilityChart.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import ConnectWalletGate from '@/components/ConnectWalletGate.vue'
import { WalletMultiButton } from 'solana-wallets-vue'
import { useLogger } from 'vue-logger-plugin'
import { useToastStore } from '@/stores/toast'
import {
  ChevronLeft,
  Loader,
  TriangleAlert,
  Share2,
  Send,
  UsersRound,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  DollarSign,
  Ghost,
  Info,
} from 'lucide-vue-next'
import HowItWorksBottomPopover from '@/components/HowItWorksBottomPopover.vue'

interface Participant {
  name: string
  address: string
  position: string
  stake: string
  tokens?: string // formatted token balance (Yes/No outcome tokens held)
  isCurrentUser: boolean
}

interface BettingOption {
  name: string
  totalStake: string
  probability: number
  participants: number
}

// Minimal shape for entry accounts used in this view
interface EntryLike {
  account: {
    user: { toString(): string }
    isYes: boolean
    depositedSolAmount: { toNumber(): number }
  }
}

const route = useRoute()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const log = useLogger()
const toast = useToastStore()

// Prefer transactionMessage over message when showing transaction-related errors
function getTxnMessage(err: unknown, fallback: string): string {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  const getString = (o: Record<string, unknown>, key: string) =>
    typeof o[key] === 'string' ? (o[key] as string) : undefined
  if (isObject(err)) {
    const tx = getString(err, 'transactionMessage')
    if (tx && tx.trim()) return tx
    const msg = getString(err, 'message')
    if (msg && msg.trim()) return msg
  }
  return fallback
}

// Environment guards for Web Platform APIs
const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false
const isEmbedded = (() => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top
  } catch {
    // Cross-origin access throws; assume embedded
    return true
  }
})()

// Determine if we're accessing by ID or UUID
const betId = computed(() => {
  const id = route.params.id as string | undefined
  if (id === undefined) return null
  const n = parseInt(id, 10)
  return Number.isNaN(n) ? null : n
})

const shareUuid = computed(() => route.params.uuid as string)

const isUuidRoute = computed(() => route.name === 'bet-share')

// Current bet ID (derived from pool data or route)
const currentBetId = computed(() => {
  if (poolData.value) {
    return poolData.value.betId.toNumber()
  }
  return betId.value
})

// Reactive data from blockchain
const loading = ref(true)
const loadError = ref<string | null>(null)
const isFetching = ref(false)
const poolData = ref<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
const userEntry = ref<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
const allEntries = ref<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
const mainState = ref<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
const historyPoints = ref<Array<{ timestamp: number; yesReserve: number; noReserve: number }>>([])
// Track last seen rate limit count to show user-friendly warning when RPC throttling occurs
let lastRateLimitCount = 0

// Abbreviate big integer values (tokens) e.g. 1_234_567 -> 1.23M
function abbreviateBigInt(value: bigint): string {
  const abs = value < 0n ? -value : value
  const units: Array<[bigint, string]> = [
    [1_000_000_000_000_000_000n, 'Q'], // Quintillion (for safety, rarely used)
    [1_000_000_000_000_000n, 'P'], // Quadrillion
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ]
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const whole = Number((value * 100n) / threshold) / 100 // keep two decimals
      return `${whole.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`
    }
  }
  return value.toLocaleString('en-US')
}

// Fetch bet data from blockchain
const fetchBetData = async () => {
  try {
    loadError.value = null
    if (isFetching.value) return
    isFetching.value = true
    loading.value = true

    const requestWallet = workspaceStore.walletAddress

    let pool: any = null // eslint-disable-line @typescript-eslint/no-explicit-any

    // Fetch pool data based on route type
    if (isUuidRoute.value && shareUuid.value) {
      pool = await workspaceStore.getPoolByUuid(shareUuid.value)
    } else if (betId.value !== null) {
      pool = await workspaceStore.getPoolById(betId.value)
    }

    if (!pool) {
      throw new Error('Bet not found')
    }

    // Use bet ID from the pool data for subsequent calls
    const currentBetId = pool.betId.toNumber()

    // Fetch main state (creator/platform fee bps, price/scale defaults)
    const mainStateData = await workspaceStore.getMainState()

    // Always fetch all entries (public data)
    const entries = await workspaceStore.getAllEntriesForBet(currentBetId)

    // Fetch probability history (public)
    try {
      const history = await workspaceStore.getHistoryForBet(currentBetId)
      historyPoints.value = (history.points || []).map((p: unknown) => {
        const pp = p as {
          timestamp?: { toNumber?: () => number }
          yesReserve?: { toNumber?: () => number }
          noReserve?: { toNumber?: () => number }
        }
        return {
          timestamp: pp.timestamp?.toNumber?.() ?? 0,
          yesReserve: pp.yesReserve?.toNumber?.() ?? 0,
          noReserve: pp.noReserve?.toNumber?.() ?? 0,
        }
      })
    } catch (err) {
      log.debug?.('No history for bet yet', err)
      historyPoints.value = []
    }

    // Only fetch user-specific data if authenticated
    let userBetEntry = null
    if (workspaceStore.isAuthenticated) {
      userBetEntry = await workspaceStore.getUserEntryForBet(currentBetId)
    }

    // Avoid applying results if wallet changed mid-flight
    if (workspaceStore.walletAddress !== requestWallet) return
    poolData.value = pool
    userEntry.value = userBetEntry
    allEntries.value = entries
    mainState.value = mainStateData
  } catch (error) {
    log.error('Failed to fetch market data:', error)
    const msg = (error as Error)?.message || 'Failed to load market data'
    loadError.value = msg
    toast.error('Could not load market details. Please try again.', 'Load failed')
  } finally {
    isFetching.value = false
    loading.value = false
  }
}

const retryFetch = async () => {
  await fetchBetData()
}

// Lightweight fetch for user entry only when auth changes
const fetchUserEntryOnly = async () => {
  try {
    if (!poolData.value) return
    const id = poolData.value.betId?.toNumber?.() ?? betId.value
    if (id == null) return
    const requestWallet = workspaceStore.walletAddress
    const entry = workspaceStore.isAuthenticated
      ? await workspaceStore.getUserEntryForBet(id)
      : null
    if (workspaceStore.walletAddress !== requestWallet) return
    userEntry.value = entry
  } catch (e) {
    log.error('Failed to refresh user entry:', e)
    toast.warning('Could not refresh your position. You can retry.', 'Refresh issue')
  }
}

// Watch for route and auth changes; avoid redundant full reloads
watch(
  [() => betId.value, () => shareUuid.value, () => workspaceStore.isAuthenticated],
  async ([newId, newUuid, newAuth], [oldId, oldUuid, oldAuth]) => {
    const routeChanged = newId !== oldId || newUuid !== oldUuid
    const authChanged = newAuth !== oldAuth

    if (routeChanged) {
      await fetchBetData()
      return
    }

    if (authChanged) {
      // If we already have pool/entries for the same bet, only refresh user entry
      if (poolData.value) {
        await fetchUserEntryOnly()
      } else {
        await fetchBetData()
      }
    }
  },
  { immediate: true },
)

// Global RPC rate limit warning (one toast per increment)
watch(
  () => workspaceStore.rateLimitHitCount,
  (count) => {
    if (typeof count !== 'number') return
    if (count > lastRateLimitCount) {
      lastRateLimitCount = count
      toast.warning(
        'Network is rate limiting some requests. Historical or entry data may load slower briefly.',
        'RPC rate limit encountered',
      )
    }
  },
  { immediate: false },
)

// React specifically to wallet address changes (including switching accounts)
watch(
  () => workspaceStore.walletAddress,
  async (newAddr, oldAddr) => {
    if (newAddr === oldAddr) return
    // If user disconnected, clear user-specific entry only
    if (!newAddr) {
      userEntry.value = null
      return
    }
    // If viewing a bet already, refresh just the user entry for the same bet
    if (poolData.value) {
      await fetchUserEntryOnly()
    } else {
      // Otherwise perform full fetch (e.g., on direct share link load)
      await fetchBetData()
    }
  },
)

// Transform blockchain data to UI format
const betData = computed(() => {
  if (!poolData.value) return null

  const pool = poolData.value

  // Calculate participants (hide others with 0 SOL to avoid clutter, keep own 0 SOL)
  const participants: Participant[] = allEntries.value
    .filter((entry: EntryLike) => {
      const entryData = entry.account
      const isCurrentUser = entryData.user.toString() === workspaceStore.walletAddress
      const lamports = entryData.depositedSolAmount?.toNumber?.() ?? 0
      return isCurrentUser || lamports > 0
    })
    .map((entry: EntryLike, index) => {
      const entryData = entry.account
      const isCurrentUser = entryData.user.toString() === workspaceStore.walletAddress
      // Attempt to read raw entry for token balance if available on original object shape
      // Some account fetches may expose tokenBalance directly (like userEntry/account entries)
      const raw: any = entry as any // eslint-disable-line @typescript-eslint/no-explicit-any
      // Avoid toNumber() to prevent precision loss / runtime errors for values > 2^53
      let tokenDisplay: string | undefined
      const tokenBn = raw.account?.tokenBalance
      if (tokenBn && typeof tokenBn.toString === 'function') {
        const tokenStr = tokenBn.toString()
        try {
          tokenDisplay = `${abbreviateBigInt(BigInt(tokenStr))} tokens`
        } catch {
          tokenDisplay = `${tokenStr} tokens`
        }
      }

      return {
        name: isCurrentUser ? 'You' : `User ${index + 1}`,
        address: `${entryData.user.toString().slice(0, 4)}...${entryData.user.toString().slice(-4)}`,
        position: entryData.isYes ? 'Yes' : 'No',
        stake: `${(entryData.depositedSolAmount.toNumber() / 1e9).toFixed(3)} SOL`,
        tokens: tokenDisplay,
        isCurrentUser,
      }
    })

  // Calculate market side aggregates
  // For participant counts, exclude 0-SOL entries from others (keep own 0-SOL)
  const filteredEntries = allEntries.value.filter((entry: EntryLike) => {
    const acc = entry.account
    const isCurrentUser = acc.user?.toString?.() === workspaceStore.walletAddress
    const lamports = acc.depositedSolAmount?.toNumber?.() ?? 0
    return isCurrentUser || lamports > 0
  })
  const yesEntries = filteredEntries.filter((entry) => entry.account.isYes)
  const noEntries = filteredEntries.filter((entry) => !entry.account.isYes)

  const yesTotalStake =
    yesEntries.reduce((sum, entry) => sum + entry.account.depositedSolAmount.toNumber(), 0) / 1e9
  const noTotalStake =
    noEntries.reduce((sum, entry) => sum + entry.account.depositedSolAmount.toNumber(), 0) / 1e9
  const totalStake = yesTotalStake + noTotalStake

  const options: BettingOption[] = [
    {
      name: 'Yes',
      totalStake: `${yesTotalStake.toFixed(3)} SOL`,
      // Align with chart: more stake on YES -> higher YES percentage
      probability: totalStake > 0 ? Math.round((yesTotalStake / totalStake) * 100) : 50,
      participants: yesEntries.length,
    },
    {
      name: 'No',
      totalStake: `${noTotalStake.toFixed(3)} SOL`,
      // Align with chart: more stake on NO -> higher NO percentage
      probability: totalStake > 0 ? Math.round((noTotalStake / totalStake) * 100) : 50,
      participants: noEntries.length,
    },
  ]

  // Convert timestamps
  const endTs = pool.endTimestamp?.toNumber?.()
  const isOpenEnded = typeof endTs === 'number' && endTs < 0
  const endDate = isOpenEnded ? '' : new Date(endTs * 1000).toISOString()
  const createdDate = pool.createdTimestamp
    ? new Date(pool.createdTimestamp.toNumber() * 1000).toISOString()
    : new Date().toISOString()

  return {
    id: pool.betId.toNumber(),
    title: pool.title,
    description: pool.description,
    myPosition: userEntry.value ? (userEntry.value.isYes ? 'Yes' : 'No') : undefined,
    amount: userEntry.value
      ? `${(userEntry.value.depositedSolAmount.toNumber() / 1e9).toFixed(3)} SOL`
      : '0 SOL',
    status: pool.complete
      ? 'completed'
      : !isOpenEnded && Date.now() > (endTs ?? 0) * 1000
        ? 'pending'
        : 'active',
    participants,
    options,
    endDate,
    createdDate,
    isCreator: pool.creator.toString() === workspaceStore.walletAddress,
    // Creator info for display
    creatorAddress: pool.creator.toString(),
    creatorShort: `${pool.creator.toString().slice(0, 4)}...${pool.creator.toString().slice(-4)}`,
    totalPool: `${totalStake.toFixed(3)} SOL`,
    shareUuid: pool.shareUuid || '', // UUID for shareable link
    resolution: pool.complete
      ? {
          winner: pool.winner,
          // TODO: implement resolution details and timestamp tracking
        }
      : null,
    // TODO: implement proper rules storage in smart contract
    rules: `Prediction Market Terms & Outcome Determination

1. Referee Decision:

The outcome of this prediction market will be determined by the designated referee after the event concludes.

2. Binding Outcome:

By placing your stake, you agree to accept the referee’s decision as binding and final.

3. Disclaimer:

delphimarkets.io assumes no liability for any losses or inconveniences resulting from participation in this prediction market. All decisions are final and not subject to appeal.`,
  }
})

// Derive probability chart data from on-chain history
const probabilityData = computed(() => {
  if (!historyPoints.value.length)
    return [] as Array<{ timestamp: string; yesPercentage: number; noPercentage: number }>
  return historyPoints.value.map((pt) => {
    const yes = pt.yesReserve / 1e9
    const no = pt.noReserve / 1e9
    const total = yes + no
    const yesPct = total > 0 ? (yes / total) * 100 : 50
    const noPct = total > 0 ? (no / total) * 100 : 50
    return {
      timestamp: new Date(pt.timestamp * 1000).toISOString(),
      yesPercentage: Math.round(yesPct * 10) / 10,
      noPercentage: Math.round(noPct * 10) / 10,
    }
  })
})

const goBack = () => {
  // Previously redirected authenticated users to '/dashboard'; route removed so always go to root
  router.push('/')
}

// Share functionality
const shareUrl = computed(() => {
  if (!betData.value?.shareUuid) return ''
  // Canonical share URL now uses /bet/:uuid (numeric bet IDs hidden)
  return `${window.location.origin}/bet/${betData.value.shareUuid}`
})

const copyShareLink = async () => {
  if (!shareUrl.value) {
    log.warn('Share URL is missing')
    return
  }
  try {
    if (!isSecure || isEmbedded || !('clipboard' in navigator)) {
      throw new Error('Clipboard API unavailable in this context')
    }
    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      try {
        const status = await navigator.permissions.query({
          name: 'clipboard-write' as PermissionName,
        })
        if (status.state === 'denied') throw new Error('Clipboard write permission denied')
      } catch (permErr) {
        log.debug?.('clipboard-write permission query failed or unsupported', permErr)
      }
    }
    await navigator.clipboard.writeText(shareUrl.value)
    log.info('Share link copied to clipboard')
    toast.success('Share link copied to clipboard', 'Link copied')
  } catch (error) {
    log.error('Failed to copy share link:', error)
    const textArea = document.createElement('textarea')
    textArea.value = shareUrl.value || ''
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    toast.info(
      isSecure
        ? 'Share link copied to clipboard'
        : 'Copied using fallback. For one-click copy, open over HTTPS and outside of iframes.',
      'Link copied',
    )
  }
}

const shareViaWeb = () => {
  if (!shareUrl.value || !betData.value) {
    log.warn('Share URL or market data is missing')
    return
  }

  // Web Share API requires secure top-level context and user gesture
  const canWebShare = isSecure && !isEmbedded && typeof navigator.share === 'function'

  if (canWebShare) {
    const data: ShareData = {
      title: `Join my market: ${betData.value.title}`,
      text: `Check out this market: ${betData.value.description}`,
      url: shareUrl.value,
    }
    // Feature-guarded share call
    navigator.share(data).catch((error: unknown) => {
      // Don't fallback to copy when the user cancels the share sheet
      if ((error as DOMException)?.name === 'AbortError') return
      log.error('Error sharing:', error)
      copyShareLink()
    })
    return
  }

  // Fallbacks: try opening native share targets on mobile via URL schemes (best-effort)
  // Otherwise, default to copy link fallback
  copyShareLink()
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const timeUntilEnd = computed(() => {
  if (!betData.value) return 'Loading...'
  if (!betData.value.endDate) return 'No fixed end'
  const endDate = new Date(betData.value.endDate)
  const now = new Date()
  const diff = endDate.getTime() - now.getTime()

  if (diff <= 0) return 'Ended'

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

  if (days > 0) return `${days}d ${hours}h remaining`
  return `${hours}h remaining`
})

// Bet participation functionality
const isRulesExpanded = ref(false)
const MAX_RULES_PREVIEW_LINES = 6
const rulesPreview = computed(() => {
  const text = betData.value?.rules ?? ''
  if (isRulesExpanded.value) return text
  const lines = text.split('\n')
  if (lines.length <= MAX_RULES_PREVIEW_LINES) return text

  // Actual deposit split WITHOUT virtual liquidity (reflects only real community funds)
  const actualProbabilities = computed(() => {
    if (!poolData.value) return null
    const yesReserve = poolData.value.yesReserve.toNumber()
    const noReserve = poolData.value.noReserve.toNumber()
    const total = yesReserve + noReserve
    if (total === 0) return { yesPct: '—', noPct: '—' }
    return {
      yesPct: ((yesReserve / total) * 100).toFixed(2),
      noPct: ((noReserve / total) * 100).toFixed(2),
    }
  })
  // (Referenced in template) expose by simple no-op access to avoid unused pruning
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  actualProbabilities.value
  return lines.slice(0, MAX_RULES_PREVIEW_LINES).join('\n').trim() + '\n...'
})
const canToggleRules = computed(() => {
  const text = betData.value?.rules ?? ''
  return text.split('\n').length > MAX_RULES_PREVIEW_LINES
})
const participatingLoading = ref(false)
const selectedPosition = ref<'Yes' | 'No'>('Yes')
const betAmount = ref<string>('')

const hasUserEntry = computed(() => !!userEntry.value)
// Market active regardless of auth
const isMarketActive = computed(() => !!betData.value && betData.value.status === 'active')
// Actual permission to send tx (auth + active)
const canParticipate = computed(() => isMarketActive.value && workspaceStore.isAuthenticated)

// Track when user attempted to participate before connecting
const promptConnect = ref(false)
const pendingAutoJoin = ref(false)

// After wallet connects, auto-complete the pending action if any
watch(
  () => workspaceStore.isAuthenticated,
  async (auth) => {
    if (auth && pendingAutoJoin.value && isMarketActive.value) {
      // Decide whether we are adding funds or initial participate
      try {
        if (hasUserEntry.value) {
          await addMoreFunds()
        } else {
          await handleParticipate()
        }
      } finally {
        pendingAutoJoin.value = false
        promptConnect.value = false
      }
    }
  },
)

function onParticipateClick() {
  // Validate amount early so user sees error even if not connected
  if (validateBetAmount.value) {
    log.warn('Participation blocked: invalid bet amount (pre-auth)', validateBetAmount.value)
    toast.warning(String(validateBetAmount.value), 'Invalid amount')
    return
  }
  if (!workspaceStore.isAuthenticated) {
    // Ask user to connect first
    promptConnect.value = true
    pendingAutoJoin.value = true
    toast.info('Connect your wallet to confirm this position.', 'Connect required')
    return
  }
  // Authenticated path proceeds to existing handlers
  if (hasUserEntry.value) {
    void addMoreFunds()
  } else {
    void handleParticipate()
  }
}

// Minimum bet amount removed from protocol; UI allows any positive amount

const validateBetAmount = computed(() => {
  const amount = parseFloat(betAmount.value)
  if (isNaN(amount) || amount <= 0) return 'Please enter a valid amount'
  // If a minimum exists, only warn in UI elsewhere; do not block
  return null
})

// --------------------------------------------------------------
// Deposit Preview (client-side mirror of on-chain pricing logic)
// --------------------------------------------------------------
// Uses same virtual reserve constants as program: 1 SOL virtual per side
const VIRTUAL_LAMPORTS = 1_000_000_000 // 1 SOL
const SCALE = 1_000_000_000 // 1e9 probability precision (matches contract helper)

// NOTE: Use BigInt to avoid overflow (u64 * 1e9 can exceed Number.MAX_SAFE_INTEGER)
const depositPreview = computed(() => {
  if (!poolData.value) return null
  const amountSol = parseFloat(betAmount.value)
  if (isNaN(amountSol) || amountSol <= 0) return null
  const isYes = hasUserEntry.value ? userEntry.value.isYes : selectedPosition.value === 'Yes'

  const yesReserveBig = BigInt(poolData.value.yesReserve?.toString?.() ?? '0')
  const noReserveBig = BigInt(poolData.value.noReserve?.toString?.() ?? '0')
  const depositLamportsBig = BigInt(Math.floor(amountSol * 1_000_000_000))

  const VIRTUAL = BigInt(VIRTUAL_LAMPORTS)
  const SCALE_BIG = BigInt(SCALE)

  const virtualYes = yesReserveBig + VIRTUAL
  const virtualNo = noReserveBig + VIRTUAL
  const denom = virtualYes + virtualNo
  if (denom === 0n) return null

  const yesPrice = (virtualYes * SCALE_BIG) / denom // scaled price
  const noPrice = (virtualNo * SCALE_BIG) / denom
  const selectedPrice = isYes ? yesPrice : noPrice
  if (selectedPrice === 0n) return null

  const tokenAmountBig = (depositLamportsBig * SCALE_BIG) / selectedPrice

  // Integer percentage with 2 decimal precision via *10000 scaling
  const yesPctTimes100 = (virtualYes * 10000n) / denom
  const yesPct = Number(yesPctTimes100) / 100
  const noPct = 100 - yesPct

  return {
    estimatedTokens: tokenAmountBig.toString(),
    formattedTokens: (() => {
      try {
        return `${abbreviateBigInt(tokenAmountBig)} tokens`
      } catch {
        return `${tokenAmountBig.toString()} tokens`
      }
    })(),
    impliedYesPct: yesPct.toFixed(2),
    impliedNoPct: noPct.toFixed(2),
    side: isYes ? 'Yes' : 'No',
  }
})

const handleParticipate = async () => {
  if (!canParticipate.value) {
    log.warn('Participation blocked: not allowed (auth or status)')
    toast.info('Connect wallet and ensure the market is active to participate.', 'Not allowed')
    return
  }
  if (validateBetAmount.value) {
    log.warn('Participation blocked: invalid bet amount', validateBetAmount.value)
    toast.warning(String(validateBetAmount.value), 'Invalid amount')
    return
  }
  if (currentBetId.value == null) {
    log.warn('Participation blocked: missing bet ID')
    toast.error('Missing market reference. Please reload the page.', 'Unexpected error')
    return
  }

  try {
    participatingLoading.value = true
    log.info(
      `Participating in bet ${currentBetId.value} with ${betAmount.value} SOL on ${selectedPosition.value}`,
    )

    // Create entry if user doesn't have one
    if (!hasUserEntry.value) {
      log.info('Creating entry for user...')
      await workspaceStore.createEntry(currentBetId.value)

      // Wait for the entry to be visible/initialized to avoid race with immediate deposit
      // Try a few quick retries to ensure the account exists across the cluster
      try {
        for (let i = 0; i < 3; i++) {
          const entry = await workspaceStore.getUserEntryForBet(currentBetId.value)
          if (entry) break
          await new Promise((r) => setTimeout(r, 400))
        }
      } catch (e) {
        // Non-fatal; deposit may still succeed
        log.debug?.('Post-createEntry verification skipped/failed', e)
      }
    }

    // Deposit funds
    log.info('Depositing funds...')
    await workspaceStore.deposit(
      currentBetId.value,
      selectedPosition.value === 'Yes',
      parseFloat(betAmount.value),
    )

    // Refresh data after successful participation
    await fetchBetData()

    // Reset form
    betAmount.value = ''

    log.info('Successfully participated in bet!')
    toast.success('Your position has been placed successfully.', 'Participation successful')
  } catch (error) {
    log.error('Failed to participate in bet:', error)
    const msg = getTxnMessage(error, 'Failed to participate')
    toast.error(msg, 'Transaction failed')
  } finally {
    participatingLoading.value = false
  }
}

const addMoreFunds = async () => {
  if (
    !userEntry.value ||
    !canParticipate.value ||
    validateBetAmount.value ||
    currentBetId.value == null
  )
    return

  try {
    participatingLoading.value = true
    log.info(`Adding ${betAmount.value} SOL to existing position`)

    // Use the same position as the existing entry
    await workspaceStore.deposit(
      currentBetId.value,
      userEntry.value.isYes,
      parseFloat(betAmount.value),
    )

    // Refresh data after successful deposit
    await fetchBetData()

    // Reset form
    betAmount.value = ''

    log.info('Successfully added funds to bet!')
    toast.success('Funds added to your position.', 'Deposit successful')
  } catch (error) {
    log.error('Failed to add funds to bet:', error)
    const msg = getTxnMessage(error, 'Failed to add funds')
    toast.error(msg, 'Transaction failed')
  } finally {
    participatingLoading.value = false
  }
}

// Bet resolution and claiming functionality
const resolutionLoading = ref(false)
const claimingLoading = ref(false)
const creatorFeeClaimingLoading = ref(false)

const isReferee = computed(() => {
  if (!poolData.value || !workspaceStore.walletAddress) return false
  return poolData.value.referee.toString() === workspaceStore.walletAddress
})

const isCreator = computed(() => {
  if (!poolData.value || !workspaceStore.walletAddress) return false
  return poolData.value.creator.toString() === workspaceStore.walletAddress
})

const canSetWinner = computed(() => {
  if (!isReferee.value || !poolData.value) return false
  const endTs = poolData.value.endTimestamp?.toNumber?.()
  const isOpenEnded = typeof endTs === 'number' && endTs < 0
  if (isOpenEnded) return !poolData.value.complete
  // For fixed-time markets, allow after end (pending) and before completion
  return betData.value?.status === 'pending' && !poolData.value.complete
})

const canClaim = computed(() => {
  if (!betData.value || !userEntry.value || !poolData.value) return false

  // Bet must be completed
  if (!poolData.value.complete) return false

  // For fixed-time markets, require end time to have passed (mirrors backend claim guard)
  const endTs = poolData.value.endTimestamp?.toNumber?.()
  const isOpenEnded = typeof endTs === 'number' && endTs < 0
  if (!isOpenEnded) {
    const now = Math.floor(Date.now() / 1000)
    if (typeof endTs === 'number' && endTs >= 0 && endTs > now) return false
  }

  // User must not have claimed already
  if (userEntry.value.isClaimed) return false

  // User must be on the winning side
  const winner = poolData.value.winner === 'yes'
  return userEntry.value.isYes === winner
})

const canClaimCreatorFee = computed(() => {
  if (!betData.value || !poolData.value || !isCreator.value) return false

  // Bet must be completed
  if (!poolData.value.complete) return false

  // Creator must not have claimed fee already
  return !poolData.value.creatorFeeClaimed
})

// Dynamic fee percents (basis points -> human-readable percent string)
const creatorFeePercentBps = computed(() => mainState.value?.creatorFeePercent?.toNumber?.() ?? 100)
const creatorFeePercentLabel = computed(() => {
  const pct = creatorFeePercentBps.value / 100
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`
})
const platformFeePercentBps = computed(
  () => mainState.value?.platformFeePercent?.toNumber?.() ?? 200,
)
const platformFeePercentLabel = computed(() => {
  const pct = platformFeePercentBps.value / 100
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`
})

// ---------------- BASIC AMOUNTS / FEES (reduced) ----------------
const LAMPORTS_PER_SOL = 1_000_000_000

// Token-based creator fee (used in template)
const calculateCreatorFee = computed(() => {
  if (!poolData.value || !poolData.value.complete) return '0'
  const creatorFeePercent = mainState.value?.creatorFeePercent?.toNumber() ?? 100
  const totalReserve = poolData.value.yesReserve.toNumber() + poolData.value.noReserve.toNumber()
  const creatorFee = Math.floor((totalReserve * creatorFeePercent) / 10000)
  return (creatorFee / LAMPORTS_PER_SOL).toFixed(3)
})

// User token balance retained only for winnings/claim display (if any)
const userTokenBalance = computed(() => userEntry.value?.tokenBalance?.toNumber?.() ?? 0)

// Token-based claim amount (mirrors on-chain claim)
const calculateWinnings = computed(() => {
  if (!userEntry.value || !poolData.value || !poolData.value.complete) return '0'
  const winnerYes = poolData.value.winner === 'yes'
  if (userEntry.value.isYes !== winnerYes) return '0'
  const yesReserve = poolData.value.yesReserve.toNumber()
  const noReserve = poolData.value.noReserve.toNumber()
  const yesSupply = poolData.value.yesSupply.toNumber()
  const noSupply = poolData.value.noSupply.toNumber()
  const creatorFeePercent = mainState.value?.creatorFeePercent?.toNumber() ?? 100
  const platformFeePercent = mainState.value?.platformFeePercent?.toNumber() ?? 200
  const totalReserve = yesReserve + noReserve
  const winningSupply = winnerYes ? yesSupply : noSupply
  if (winningSupply <= 0) return '0'
  const creatorFee = Math.floor((totalReserve * creatorFeePercent) / 10000)
  const platformFee = Math.floor((totalReserve * platformFeePercent) / 10000)
  const winningPrincipal = winnerYes ? yesReserve : noReserve
  const availableProfit = Math.max(totalReserve - winningPrincipal - creatorFee - platformFee, 0)
  const userTokens = userTokenBalance.value
  if (userTokens <= 0) return '0'
  const profitLamports = Math.floor((userTokens * availableProfit) / winningSupply)
  const principalLamports = userEntry.value.depositedSolAmount.toNumber()
  const totalLamports = principalLamports + profitLamports
  return (totalLamports / LAMPORTS_PER_SOL).toFixed(3)
})

// ---------------- END BASIC AMOUNTS ----------------

const resolveBet = async (isYes: boolean) => {
  if (!canSetWinner.value || currentBetId.value == null) return

  try {
    resolutionLoading.value = true
    log.info(`Resolving bet ${currentBetId.value} with winner: ${isYes ? 'Yes' : 'No'}`)

    await workspaceStore.setWinner(currentBetId.value, isYes)

    // Refresh data after successful resolution
    await fetchBetData()

    log.info('Successfully resolved bet!')
    toast.success('Market resolved successfully.', 'Resolution complete')
  } catch (error) {
    log.error('Failed to resolve bet:', error)
    const msg = getTxnMessage(error, 'Failed to resolve market')
    toast.error(msg, 'Action failed')
  } finally {
    resolutionLoading.value = false
  }
}

const claimWinnings = async () => {
  if (!canClaim.value || currentBetId.value == null) return

  try {
    claimingLoading.value = true
    log.info(`Claiming winnings for bet ${currentBetId.value}`)

    await workspaceStore.claim(currentBetId.value)

    // Refresh data after successful claim
    await fetchBetData()

    log.info('Successfully claimed winnings!')
    toast.success('Winnings claimed and sent to your wallet.', 'Claim successful')
  } catch (error) {
    log.error('Failed to claim winnings:', error)
    const msg = getTxnMessage(error, 'Failed to claim')
    toast.error(msg, 'Transaction failed')
  } finally {
    claimingLoading.value = false
  }
}

const claimCreatorFee = async () => {
  if (!canClaimCreatorFee.value || currentBetId.value == null) return

  try {
    creatorFeeClaimingLoading.value = true
    log.info(`Claiming creator fee for bet ${currentBetId.value}`)

    await workspaceStore.claimCreatorFee(currentBetId.value)

    // Refresh data after successful claim
    await fetchBetData()

    log.info('Successfully claimed creator fee!')
    toast.success('Creator fee claimed successfully.', 'Claim successful')
  } catch (error) {
    log.error('Failed to claim creator fee:', error)
    const msg = getTxnMessage(error, 'Failed to claim creator fee')
    toast.error(msg, 'Transaction failed')
  } finally {
    creatorFeeClaimingLoading.value = false
  }
}

// END token-based logic section
</script>

<template>
  <Header />
  <main class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-6xl mx-auto px-4 py-8">
      <!-- Header with Back Button -->
      <div class="mb-8 flex items-center gap-4">
        <Button @click="goBack" variant="outline" size="sm">
          <ChevronLeft class="h-4 w-4" />
          {{ workspaceStore.isAuthenticated ? 'Back to Dashboard' : 'Back Home' }}
        </Button>
        <div>
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Market Details</h1>
          <p class="text-gray-600 dark:text-gray-400">
            {{ betData ? betData.title : loading ? 'Loading...' : '' }}
          </p>
        </div>
      </div>
      <!-- Loading State (always visible regardless of auth) -->
      <div v-if="loading && !loadError" class="text-center py-16">
        <div class="max-w-md mx-auto">
          <div class="mb-4">
            <Loader class="mx-auto h-16 w-16 text-gray-400 animate-spin" />
          </div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Loading market details...
          </h3>
          <p class="text-gray-500 dark:text-gray-400">Fetching market data from the blockchain</p>
        </div>
      </div>
      <!-- Error State -->
      <div v-else-if="loadError" class="text-center py-16">
        <div class="max-w-md mx-auto">
          <div class="mb-4">
            <TriangleAlert class="mx-auto h-16 w-16 text-red-500" />
          </div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Failed to load market
          </h3>
          <p class="text-gray-500 dark:text-gray-400 mb-4">{{ loadError }}</p>
          <Button @click="retryFetch" variant="outline">Retry</Button>
        </div>
      </div>
      <!-- Main Content (publicly visible) -->
      <div
        v-else-if="betData"
        class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch grid-flow-row-dense"
      >
        <!-- Row 1: Market Info + Quick Actions -->
        <Card class="lg:col-span-2 h-full">
          <CardHeader>
            <div class="flex justify-between items-start">
              <div>
                <CardTitle class="text-2xl mb-2">{{ betData.title }}</CardTitle>
                <CardDescription class="text-base">{{ betData.description }}</CardDescription>
              </div>
              <span
                class="px-3 py-1 text-sm rounded-full"
                :class="{
                  'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200':
                    betData.status === 'active',
                  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200':
                    betData.status === 'pending',
                  'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200':
                    betData.status === 'completed',
                }"
              >
                {{ betData.status }}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span class="text-gray-500 dark:text-gray-400 block">Total Pool</span>
                <span class="font-semibold text-lg">{{ betData.totalPool }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400 block">Your Stake</span>
                <span class="font-semibold text-lg">{{ betData.amount }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400 block">Your Position</span>
                <span class="font-semibold text-lg text-blue-600 dark:text-blue-400">{{
                  betData.myPosition || '—'
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400 block">Time Left</span>
                <span class="font-semibold text-lg">{{ timeUntilEnd }}</span>
              </div>
            </div>
            <div
              v-if="poolData?.complete && mainState"
              class="mt-4 text-xs text-gray-600 dark:text-gray-300"
            >
              Fee disclosure: Creator {{ creatorFeePercentLabel }} and Platform
              {{ platformFeePercentLabel }} are taken from the losing side before distributing
              winnings.
            </div>
          </CardContent>
        </Card>
        <Card class="h-full lg:col-start-3">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <Button @click="copyShareLink" variant="outline" class="w-full">
              <Share2 class="h-4 w-4" />
              Share Market Link
            </Button>
            <Button @click="shareViaWeb" variant="outline" class="w-full">
              <Send class="h-4 w-4" />
              Share
            </Button>
          </CardContent>
        </Card>
        <!-- Row 2: Participation (wallet gated) + Participants -->
        <Card class="lg:col-span-2 h-full">
          <CardHeader>
            <CardTitle>
              {{
                isMarketActive
                  ? hasUserEntry
                    ? 'Add More Funds'
                    : 'Take a Position'
                  : 'Market Closed'
              }}
            </CardTitle>
            <CardDescription>
              {{
                isMarketActive
                  ? hasUserEntry
                    ? `You currently have ${betData.amount} on ${betData.myPosition}. Add more funds to your position.`
                    : workspaceStore.isAuthenticated
                      ? 'Enter an amount to participate.'
                      : "Choose a side and amount. You'll connect your wallet to confirm."
                  : 'This market is no longer accepting new positions.'
              }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <!-- Participation Form (now visible to guests if market is active) -->
            <div v-if="isMarketActive" class="space-y-4">
              <!-- Transparent Participation Cost Hint -->
              <div
                class="flex gap-3 rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/70 dark:bg-gray-800/40 px-4 py-3 text-[11px] text-gray-600 dark:text-gray-300"
              >
                <Info class="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400 mt-0.5" />
                <p class="leading-relaxed">
                  <template v-if="!hasUserEntry">
                    First time joining this market creates a lightweight on‑chain entry account
                    (~0.001 SOL rent+fee). Afterwards you only pay the SOL you stake. Your stake
                    remains locked in the pool until resolution. When the referee sets the outcome,
                    creator (<span class="font-medium">{{ creatorFeePercentLabel }}</span
                    >) and platform (<span class="font-medium">{{ platformFeePercentLabel }}</span
                    >) fees are taken from the losing side before winners claim principal + profit.
                    Odds shown incorporate virtual liquidity for early price stability.
                  </template>
                  <template v-else>
                    Adding funds only costs the additional stake + a tiny network fee. At
                    resolution, creator (<span class="font-medium">{{
                      creatorFeePercentLabel
                    }}</span
                    >) and platform (<span class="font-medium">{{ platformFeePercentLabel }}</span
                    >) fees come from the losing side before claims are available.
                  </template>
                </p>
              </div>
              <!-- Position Selection (only for new entries) -->
              <div v-if="!hasUserEntry" class="space-y-2">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Select Position</label
                >
                <div class="grid grid-cols-2 gap-2">
                  <button
                    @click="selectedPosition = 'Yes'"
                    type="button"
                    class="p-3 border rounded-lg text-center transition-colors"
                    :class="
                      selectedPosition === 'Yes'
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                        : 'border-gray-200 dark:border-gray-700 hover:border-green-300'
                    "
                  >
                    <div class="font-semibold">Yes</div>
                    <div class="text-sm text-gray-500">
                      {{ betData?.options?.[0]?.probability ?? 0 }}% sentiment
                    </div>
                  </button>
                  <button
                    @click="selectedPosition = 'No'"
                    type="button"
                    class="p-3 border rounded-lg text-center transition-colors"
                    :class="
                      selectedPosition === 'No'
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                        : 'border-gray-200 dark:border-gray-700 hover:border-red-300'
                    "
                  >
                    <div class="font-semibold">No</div>
                    <div class="text-sm text-gray-500">
                      {{ betData?.options?.[1]?.probability ?? 0 }}% sentiment
                    </div>
                  </button>
                </div>
              </div>

              <!-- Bet Amount Input -->
              <div class="space-y-2">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Amount (SOL)</label
                >
                <input
                  v-model="betAmount"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0.000"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  :class="validateBetAmount ? 'border-red-500' : ''"
                />
                <div v-if="validateBetAmount" class="text-sm text-red-600">
                  {{ validateBetAmount }}
                </div>
                <!-- Deposit Preview -->
                <div
                  v-else-if="depositPreview"
                  class="text-xs mt-1 p-2 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                >
                  <div class="flex justify-between">
                    <span>Estimated Tokens ({{ depositPreview.side }}):</span>
                    <span class="font-medium">{{ depositPreview.formattedTokens }}</span>
                  </div>
                  <div class="flex justify-between mt-1">
                    <span>Current Implied Odds:</span>
                    <span>
                      Yes {{ depositPreview.impliedYesPct }}% · No
                      {{ depositPreview.impliedNoPct }}%
                    </span>
                  </div>
                  <div class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                    Pricing includes 1 SOL virtual liquidity per side for early stability.
                  </div>
                </div>
              </div>

              <!-- Action Button -->
              <Button
                @click="onParticipateClick"
                :disabled="participatingLoading || !!validateBetAmount || !betAmount"
                class="w-full"
                :class="
                  hasUserEntry
                    ? ''
                    : selectedPosition === 'Yes'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                "
              >
                <Loader v-if="participatingLoading" class="animate-spin h-4 w-4" />
                {{
                  participatingLoading
                    ? hasUserEntry
                      ? 'Adding Funds...'
                      : workspaceStore.isAuthenticated
                        ? 'Joining Bet...'
                        : 'Connecting...'
                    : hasUserEntry
                      ? `Add ${betAmount} SOL`
                      : workspaceStore.isAuthenticated
                        ? `Put ${betAmount} SOL on ${selectedPosition}`
                        : betAmount
                          ? `Connect to confirm ${betAmount} SOL on ${selectedPosition}`
                          : 'Enter amount'
                }}
              </Button>

              <!-- Inline connect prompt (appears after user clicks without wallet) -->
              <div v-if="!workspaceStore.isAuthenticated" class="pt-2">
                <div
                  class="p-4 mt-2 rounded-md border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-center space-y-3"
                  :class="promptConnect ? 'ring-2 ring-blue-400 dark:ring-blue-600' : ''"
                >
                  <p class="text-xs text-gray-600 dark:text-gray-400" v-if="!promptConnect">
                    You are browsing as a guest. Click the button above to connect & confirm.
                  </p>
                  <p class="text-xs text-blue-600 dark:text-blue-400" v-else>
                    Connect your wallet to finalize your position.
                  </p>
                  <ConnectWalletGate>
                    <template #button>
                      <WalletMultiButton />
                    </template>
                  </ConnectWalletGate>
                </div>
              </div>
            </div>
            <!-- Closed Market (no participation) -->
            <div
              v-else
              class="p-6 text-center rounded-lg border bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300"
            >
              Participation is closed for this market.
            </div>
          </CardContent>
        </Card>
        <Card class="h-full lg:col-start-3">
          <CardHeader>
            <CardTitle>Participants</CardTitle>
            <CardDescription>All users who have joined this market</CardDescription>
          </CardHeader>
          <CardContent>
            <!-- Empty state when no participants yet -->
            <div
              v-if="betData && betData.participants.length === 0"
              class="p-6 text-center rounded-lg border border-dashed bg-white dark:bg-gray-900/20 border-gray-200 dark:border-gray-700"
            >
              <UsersRound class="mx-auto h-10 w-10 text-gray-400 mb-3" />
              <p class="text-sm text-gray-600 dark:text-gray-300">
                No participants yet.
                <span v-if="betData?.status === 'active'">Be the first to join.</span>
              </p>
              <!-- Subtle skeleton rows to avoid empty feel -->
              <div class="animate-pulse space-y-3 mt-4">
                <div
                  class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                    <div>
                      <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                      <div class="h-3 w-32 bg-gray-100 dark:bg-gray-600 rounded"></div>
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                    <div class="h-3 w-10 bg-gray-100 dark:bg-gray-600 rounded"></div>
                  </div>
                </div>
                <div
                  class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                    <div>
                      <div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                      <div class="h-3 w-28 bg-gray-100 dark:bg-gray-600 rounded"></div>
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                    <div class="h-3 w-8 bg-gray-100 dark:bg-gray-600 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="participant in betData.participants"
                :key="participant.address"
                class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                  >
                    {{ participant.name.charAt(0) }}
                  </div>
                  <div>
                    <div class="font-medium">{{ participant.name }}</div>
                    <div class="text-sm text-gray-500 dark:text-gray-400">
                      {{ participant.address }}
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-semibold">{{ participant.stake }}</div>
                  <div v-if="participant.tokens" class="text-xs text-gray-500 dark:text-gray-400">
                    {{ participant.tokens }}
                  </div>
                  <div
                    class="text-sm"
                    :class="participant.position === 'Yes' ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ participant.position }}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Row 3: Market Sentiment Chart + Market Sides -->
        <Card class="lg:col-span-2 h-full">
          <CardHeader>
            <CardTitle class="flex items-center gap-2">
              <ChartNoAxesColumnIncreasing class="h-5 w-5" />
              Market Sentiment Over Time
            </CardTitle>
            <CardDescription
              >Track how market sentiment has shifted since the market was created</CardDescription
            >
          </CardHeader>
          <CardContent>
            <ProbabilityChart :data="probabilityData" />
          </CardContent>
        </Card>
        <Card class="h-full lg:col-start-3">
          <CardHeader>
            <CardTitle>Market Sides</CardTitle>
            <CardDescription>Current sentiment and stakes for each side</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="grid grid-cols-1 gap-4">
              <div
                v-for="option in betData.options"
                :key="option.name"
                class="p-4 border rounded-lg hover:shadow-md transition-shadow"
                :class="
                  betData.myPosition === option.name
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : ''
                "
              >
                <div class="flex justify-between items-center mb-2">
                  <h3 class="font-semibold text-lg">{{ option.name }}</h3>
                  <span
                    class="text-2xl font-bold"
                    :class="option.name === 'Yes' ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ option.probability }}%
                  </span>
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>Total Stake: {{ option.totalStake }}</div>
                  <div>Participants: {{ option.participants }}</div>
                </div>
                <div class="mt-3">
                  <div
                    v-if="betData.myPosition === option.name"
                    class="text-sm font-medium text-blue-600 dark:text-blue-400 text-center"
                  >
                    ✓ Your Position
                  </div>
                  <div
                    v-else-if="betData.status !== 'active'"
                    class="text-sm text-gray-500 text-center"
                  >
                    Trading Closed
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Row 4: Rules & Resolution + Market Information -->
        <Card class="lg:col-span-2 h-full">
          <CardHeader>
            <CardTitle>Market Rules & Resolution</CardTitle>
            <CardDescription>How this market will be resolved</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="prose dark:prose-invert max-w-none">
              <p class="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {{ rulesPreview }}
              </p>
              <div v-if="canToggleRules" class="mt-2">
                <button
                  type="button"
                  class="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  @click="isRulesExpanded = !isRulesExpanded"
                >
                  {{ isRulesExpanded ? 'Show less' : 'Show more' }}
                </button>
              </div>
            </div>

            <!-- Market Resolution (for referees only) -->
            <div
              v-if="canSetWinner"
              class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700"
            >
              <h4 class="font-semibold text-gray-900 dark:text-white mb-3">Resolve Market</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                As the referee, you can resolve this market by selecting the winning outcome.
              </p>
              <div class="flex gap-2">
                <Button
                  @click="resolveBet(true)"
                  :disabled="resolutionLoading"
                  class="bg-green-600 hover:bg-green-700 flex-1"
                >
                  <Loader v-if="resolutionLoading" class="animate-spin h-4 w-4" />
                  {{ resolutionLoading ? 'Resolving...' : 'Yes Wins' }}
                </Button>
                <Button
                  @click="resolveBet(false)"
                  :disabled="resolutionLoading"
                  class="bg-red-600 hover:bg-red-700 flex-1"
                >
                  <Loader v-if="resolutionLoading" class="animate-spin h-4 w-4" />
                  {{ resolutionLoading ? 'Resolving...' : 'No Wins' }}
                </Button>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Only the referee can resolve the market outcome after it has ended.
              </p>
            </div>

            <!-- Resolution Result -->
            <div
              v-if="betData.resolution"
              class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700"
            >
              <div class="flex items-center gap-2 mb-2">
                <CircleCheck class="h-5 w-5 text-green-600" />
                <h4 class="font-semibold text-gray-900 dark:text-white">Market Resolved</h4>
              </div>
              <p class="text-gray-700 dark:text-gray-300">
                Winner:
                <span
                  class="font-semibold text-lg"
                  :class="betData.resolution.winner === 'yes' ? 'text-green-600' : 'text-red-600'"
                >
                  {{ betData.resolution.winner === 'yes' ? 'Yes' : 'No' }}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card class="h-full lg:col-start-3">
          <CardHeader>
            <CardTitle>Market Information</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-500 dark:text-gray-400">Created:</span>
              <span>{{ formatDate(betData.createdDate) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500 dark:text-gray-400">Ends:</span>
              <span>{{ betData.endDate ? formatDate(betData.endDate) : 'Open-ended' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500 dark:text-gray-400">Creator:</span>
              <span>{{ betData.isCreator ? 'You' : betData.creatorShort }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500 dark:text-gray-400">Participants:</span>
              <span>{{ betData.participants.length }}</span>
            </div>
          </CardContent>
        </Card>

        <Card
          v-if="canClaim || (userEntry && poolData?.complete && userEntry.isClaimed)"
          class="h-full lg:col-span-2"
        >
          <CardHeader>
            <CardTitle>{{
              userEntry?.isClaimed ? 'Winnings Claimed' : 'Claim Winnings'
            }}</CardTitle>
            <CardDescription v-if="!userEntry?.isClaimed">
              You're on the winning side! Claim your rewards.
            </CardDescription>
            <CardDescription v-else> You have successfully claimed your winnings. </CardDescription>
          </CardHeader>
          <CardContent>
            <div v-if="!userEntry?.isClaimed" class="space-y-4">
              <div
                class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800"
              >
                <div class="flex items-center gap-2 mb-2">
                  <DollarSign class="h-5 w-5 text-green-600" />
                  <span class="font-semibold text-green-800 dark:text-green-200"
                    >Winnings Available</span
                  >
                </div>
                <p class="text-2xl font-bold text-green-800 dark:text-green-200">
                  {{ calculateWinnings }} SOL
                </p>
                <p class="text-sm text-green-600 dark:text-green-400 mt-1">
                  Including your original stake plus share of the losing side's pool
                </p>
              </div>

              <Button
                @click="claimWinnings"
                :disabled="claimingLoading"
                class="w-full bg-green-600 hover:bg-green-700"
              >
                <Loader v-if="claimingLoading" class="animate-spin h-4 w-4" />
                {{ claimingLoading ? 'Claiming...' : 'Claim Winnings' }}
              </Button>
            </div>

            <div v-else class="text-center py-4">
              <CircleCheck class="mx-auto h-12 w-12 text-green-600 mb-3" />
              <p class="text-gray-600 dark:text-gray-400">
                You have already claimed your winnings from this market.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card
          v-if="
            canClaimCreatorFee || (isCreator && poolData?.complete && poolData?.creatorFeeClaimed)
          "
          class="h-full lg:col-span-2"
        >
          <CardHeader>
            <CardTitle>{{
              poolData?.creatorFeeClaimed ? 'Creator Fee Claimed' : 'Claim Creator Fee'
            }}</CardTitle>
            <CardDescription v-if="!poolData?.creatorFeeClaimed">
              As the market creator, you can claim your {{ creatorFeePercentLabel }} fee from the
              losing side's pool.
            </CardDescription>
            <CardDescription v-else>
              You have successfully claimed your creator fee.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div v-if="!poolData?.creatorFeeClaimed" class="space-y-4">
              <div
                class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
              >
                <div class="flex items-center gap-2 mb-2">
                  <DollarSign class="h-5 w-5 text-blue-600" />
                  <span class="font-semibold text-blue-800 dark:text-blue-200"
                    >Creator Fee Available</span
                  >
                </div>
                <p class="text-2xl font-bold text-blue-800 dark:text-blue-200">
                  {{ calculateCreatorFee }} SOL
                </p>
                <p class="text-sm text-blue-600 dark:text-blue-400 mt-1">
                  {{ creatorFeePercentLabel }} of the losing side's pool as reward for creating this
                  market
                </p>
              </div>

              <Button
                @click="claimCreatorFee"
                :disabled="creatorFeeClaimingLoading"
                class="w-full bg-blue-600 hover:bg-blue-700"
              >
                <Loader v-if="creatorFeeClaimingLoading" class="animate-spin h-4 w-4" />
                {{ creatorFeeClaimingLoading ? 'Claiming...' : 'Claim Creator Fee' }}
              </Button>
            </div>

            <div v-else class="text-center py-4">
              <CircleCheck class="mx-auto h-12 w-12 text-blue-600 mb-3" />
              <p class="text-gray-600 dark:text-gray-400">
                You have already claimed your creator fee from this market.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Fallback when betData is not available but we are not loading and no explicit error -->
      <div v-else class="text-center py-16">
        <div class="max-w-md mx-auto">
          <div class="mb-4">
            <Ghost class="mx-auto h-16 w-16 text-gray-400" />
          </div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Market data unavailable
          </h3>
          <p class="text-gray-500 dark:text-gray-400 mb-4">
            We couldn't load this market data. Please try again.
          </p>
          <Button @click="retryFetch" variant="outline">Retry</Button>
        </div>
      </div>
      <!-- End of conditional blocks -->
    </div>
    <HowItWorksBottomPopover :is-authenticated="workspaceStore.isAuthenticated" />
  </main>
</template>
