import { ref, computed, watch, type ComputedRef } from 'vue'
import { defineStore } from 'pinia'
import { useAnchorWallet } from 'solana-wallets-vue'
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor'
import { useLogger } from 'vue-logger-plugin'
import type { BettingProgram } from '@/types/betting_program'
import idl from '@/assets/betting_program.json'
import bs58 from 'bs58'

export interface User {
  walletAddress: string
  name?: string
  avatar?: string
}

// Minimal type surface for pool accounts to avoid leaking Anchor-specific types
type PoolAccountMinimal = {
  betId: { toNumber(): number; toString(): string }
  creator: { toString(): string }
  referee: { toString(): string }
  title: string
  description: string
  endTimestamp: { toNumber(): number }
  createdTimestamp?: { toNumber(): number }
  complete: boolean
  winner: string
  yesReserve: { toNumber(): number }
  noReserve: { toNumber(): number }
  yesSupply: { toNumber(): number }
  noSupply: { toNumber(): number }
  platformFeeClaimed?: boolean
}

// Minimal type surface for history account
type HistoryPoint = {
  timestamp: { toNumber(): number }
  yesReserve: { toNumber(): number }
  noReserve: { toNumber(): number }
}
type PoolHistoryMinimal = { betId: { toNumber(): number }; points: HistoryPoint[] }

// Minimal main state shape
export type MainStateMinimal = {
  initialized: boolean
  owner: { toString(): string }
  platformFeePercent?: { toNumber(): number }
}

const preflightCommitment = 'processed'
const commitment = 'confirmed'
const programID = new PublicKey(idl.address)

// Normalize RPC endpoint: allow relative path (/solana-rpc) without exposing host in env.
function resolveRpcEndpoint(raw: string | undefined): string {
  if (!raw || raw.trim() === '') return '/solana-rpc'
  // If already absolute (http/https), return as-is
  if (/^https?:\/\//i.test(raw)) return raw
  // Treat as relative path
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`
  }
  // SSR fallback (if ever used): assume https and placeholder domain; caller should override.
  return `https://localhost${raw.startsWith('/') ? '' : '/'}${raw}`
}
const rpcHttpEndpoint = resolveRpcEndpoint(
  import.meta.env.VITE_SOLANA_RPC_URL as string | undefined,
)

export const useWorkspaceStore = defineStore(
  'workspace',
  () => {
    const user = ref<User | null>(null)
    const log = useLogger()
    // Count of RPC 429 (rate limit) occurrences observed locally in this session
    const rateLimitHitCount = ref(0)

    // Wallet loading state to track initial connection attempt
    const walletLoading = ref(true)
    const walletInitialized = ref(false)

    // Solana wallet integration
    const wallet = useAnchorWallet()
    const connection = new Connection(rpcHttpEndpoint, commitment)

    // Reactive provider that updates when wallet changes
    const provider: ComputedRef<AnchorProvider | null> = computed(() => {
      if (!wallet.value) return null
      return new AnchorProvider(connection, wallet.value, {
        preflightCommitment,
        commitment,
      })
    })

    // Computed program using the IDL (wallet bound)
    const program: ComputedRef<Program<BettingProgram> | null> = computed(() => {
      if (!provider.value) return null
      return new Program(idl as BettingProgram, provider.value)
    })

    // Read-only program fallback (for unauthenticated visitors)
    const readOnlyProgram = ref<Program<BettingProgram> | null>(null)
    function getReadOnlyProgram() {
      if (program.value) return program.value // prefer authenticated instance
      if (readOnlyProgram.value) return readOnlyProgram.value
      // Minimal dummy wallet implementing required interface for AnchorProvider
      const dummyWallet = {
        publicKey: new PublicKey('11111111111111111111111111111111'),
        async signTransaction(tx: Transaction) {
          // Intentionally read-only: prevent accidental signing usage
          void tx
          throw new Error('Read-only wallet cannot sign transactions')
        },
        async signAllTransactions(txs: Transaction[]) {
          void txs
          throw new Error('Read-only wallet cannot sign transactions')
        },
      }
      const roProvider = new AnchorProvider(
        connection,
        dummyWallet as unknown as AnchorProvider['wallet'],
        { preflightCommitment, commitment },
      )
      readOnlyProgram.value = new Program(idl as BettingProgram, roProvider)
      return readOnlyProgram.value
    }

    const isAuthenticated = computed(() => !!wallet.value?.publicKey)
    const walletAddress = computed(() => wallet.value?.publicKey?.toString() || null)

    // Cache for expensive global queries (e.g., all pools discovery)
    const allPoolsCache = ref<{ data: PoolAccountMinimal[]; fetchedAt: number } | null>(null)
    // Additional caches to reduce RPC pressure
    const poolCache = ref<Map<number, { data: PoolAccountMinimal | null; fetchedAt: number }>>(
      new Map(),
    )
    const entriesByBetCache = ref<Map<number, { data: any[]; fetchedAt: number }>>(new Map()) // eslint-disable-line @typescript-eslint/no-explicit-any
    const userEntriesCache = ref<{ wallet: string; data: any[]; fetchedAt: number } | null>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
    const historyCache = ref<Map<number, { data: PoolHistoryMinimal; fetchedAt: number }>>(
      new Map(),
    )
    const mainStateCache = ref<{ data: MainStateMinimal | null; fetchedAt: number } | null>(null)

    // TTLs (ms)
    const TTL = {
      allPools: 120_000,
      pool: 60_000,
      entriesByBet: 45_000,
      userEntries: 20_000,
      history: 90_000,
      mainState: 300_000,
    }

    // NOTE: Removed manual sessionStorage cache persistence. We rely on Pinia's built-in
    // persistence (store option persist: true) for user-level state, while volatile
    // performance caches remain in-memory only to avoid serialization of complex objects.

    // Simple sliding window rate limiter to avoid local bursts
    const MAX_REQUESTS_PER_WINDOW = 18
    const WINDOW_MS = 10_000
    const requestTimestamps: number[] = []
    async function rateLimitGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const now = Date.now()
      while (requestTimestamps.length && now - (requestTimestamps[0] as number) > WINDOW_MS) {
        requestTimestamps.shift()
      }
      if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        const firstTs = requestTimestamps[0] as number
        const waitMs = WINDOW_MS - (now - firstTs) + 25
        await new Promise((r) => setTimeout(r, waitMs))
      }
      requestTimestamps.push(Date.now())
      try {
        return await fn()
      } catch (e) {
        const msg = (e as Error)?.message || ''
        if (/429|Too Many Requests/i.test(msg)) {
          log.warn(`[rpc 429] ${label} backoff retry`)
          rateLimitHitCount.value += 1
          await new Promise((r) => setTimeout(r, 750))
          return await fn()
        }
        throw e
      }
    }

    // Watch wallet changes and update user
    watch(wallet, (newWallet) => {
      // Mark wallet as initialized after first change
      if (!walletInitialized.value) {
        walletInitialized.value = true
        walletLoading.value = false
      }

      if (newWallet?.publicKey) {
        const address = newWallet.publicKey.toString()
        user.value = {
          walletAddress: address,
          name: `User-${address.slice(0, 6)}`,
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`,
        }
      } else {
        user.value = null
      }
    })

    // Add a timeout to mark wallet as initialized even if no wallet is found
    setTimeout(() => {
      if (!walletInitialized.value) {
        walletInitialized.value = true
        walletLoading.value = false
      }
    }, 1500) // 1.5 seconds timeout

    function logout() {
      user.value = null
      // Note: Actual wallet disconnection should be handled by the wallet adapter
    }

    // Ensure a transaction is confirmed at a strong commitment level before proceeding
    async function confirmFinalized(signature: string) {
      try {
        // Wait until the transaction is at least confirmed
        await connection.confirmTransaction(
          { signature, ...(await connection.getLatestBlockhash()) },
          'confirmed',
        )
        // Optionally escalate to finalized where supported
        await connection.confirmTransaction(
          { signature, ...(await connection.getLatestBlockhash()) },
          'finalized',
        )
      } catch (e) {
        log.debug?.('confirmFinalized failed or unsupported; continuing', e)
      }
    }

    // Smart contract utility functions
    async function createPool(
      title: string,
      description: string,
      endTimestamp: number,
      referee: string,
    ) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )

      const mainState = await program.value.account.mainState.fetch(mainStatePda)

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), mainState.currentBetId.toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const [historyStatePda] = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode('history'),
          mainState.currentBetId.toArrayLike(Uint8Array, 'le', 8),
        ],
        programID,
      )

      const builder = program.value.methods
        .createPool({
          title,
          description,
          endTimestamp: new BN(endTimestamp),
          referee: new PublicKey(referee),
        })
        .accounts({
          creator: wallet.value.publicKey,
          // Order must match on-chain ACreatePool definition
          mainState: mainStatePda,
          poolState: poolStatePda,
          historyState: historyStatePda,
          systemProgram: SystemProgram.programId,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      const tx = await builder.rpc()

      // Invalidate discovery cache
      invalidateAllPoolsCache()
      return tx
    }

    // Removed getAllPools to avoid fetching every pool on-chain from the frontend.
    // Prefer fetching a user's entries first, then resolving specific pools by bet_id via getPoolById.

    async function getPoolById(betId: number, opts?: { force?: boolean; ttlMs?: number }) {
      const activeProgram = program.value || getReadOnlyProgram()
      const ttl = opts?.ttlMs ?? TTL.pool
      const cached = poolCache.value.get(betId)
      if (!opts?.force && cached && Date.now() - cached.fetchedAt < ttl) return cached.data
      try {
        const [poolStatePda] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
          programID,
        )
        const data = await rateLimitGuard(`pool:${betId}`, () =>
          activeProgram.account.poolState.fetch(poolStatePda),
        )
        poolCache.value.set(betId, { data, fetchedAt: Date.now() })
        // no manual persistence needed
        return data
      } catch (error) {
        log.error('Failed to fetch pool by ID:', error)
        return cached?.data ?? null
      }
    }

    // Batch fetch multiple pools by bet IDs using a single RPC call
    async function getPoolsByIds(betIds: number[], opts?: { force?: boolean; ttlMs?: number }) {
      if (!program.value) throw new Error('Program not available')
      try {
        const uniqueIds = Array.from(new Set(betIds)).filter((n) => Number.isFinite(n))
        if (uniqueIds.length === 0) return []
        const ttl = opts?.ttlMs ?? TTL.pool
        const need: number[] = []
        const collected: PoolAccountMinimal[] = []
        uniqueIds.forEach((id) => {
          const c = poolCache.value.get(id)
          if (!opts?.force && c && Date.now() - c.fetchedAt < ttl && c.data) collected.push(c.data)
          else need.push(id)
        })
        if (need.length === 0) return collected
        const pdas = need.map(
          (id) =>
            PublicKey.findProgramAddressSync(
              [new TextEncoder().encode('pool'), new BN(id).toArrayLike(Uint8Array, 'le', 8)],
              programID,
            )[0],
        )
        const fetched = (await rateLimitGuard(`pools:${need.length}`, () =>
          program.value!.account.poolState.fetchMultiple(pdas),
        )) as Array<PoolAccountMinimal | null>
        fetched.forEach((acc, i) => {
          const bid = need[i] as number
          if (acc) {
            poolCache.value.set(bid, { data: acc, fetchedAt: Date.now() })
            collected.push(acc)
          } else {
            poolCache.value.set(bid, { data: null, fetchedAt: Date.now() })
          }
        })
        // no manual persistence needed
        return collected
      } catch (error) {
        log.error('Failed to fetch pools by IDs:', error)
        return betIds
          .map((id) => poolCache.value.get(id)?.data)
          .filter((p): p is PoolAccountMinimal => !!p)
      }
    }

    async function getPoolByUuid(shareUuid: string) {
      const activeProgram = program.value || getReadOnlyProgram()
      try {
        const pools = await activeProgram.account.poolState.all()
        type PoolWithShare = { account: PoolAccountMinimal & { shareUuid?: string } }
        const matchingPool = pools.find(
          (pool: unknown) =>
            !!(
              (pool as PoolWithShare).account &&
              (pool as PoolWithShare).account.shareUuid === shareUuid
            ),
        )
        if (!matchingPool) return null
        return matchingPool.account
      } catch (error) {
        log.error('Failed to fetch pool by UUID:', error)
        return null
      }
    }

    // Fetch all pools (used for global discovery features like Trending view)
    // NOTE: This can be expensive on large datasets. Caller should consider caching
    // or limiting frequency. Returns a minimal typed array of pool accounts.
    async function getAllPools(opts?: {
      force?: boolean
      ttlMs?: number
    }): Promise<PoolAccountMinimal[]> {
      const activeProgram = program.value || getReadOnlyProgram()
      const ttl = opts?.ttlMs ?? TTL.allPools
      if (!opts?.force && allPoolsCache.value) {
        const age = Date.now() - allPoolsCache.value.fetchedAt
        if (age < ttl) return allPoolsCache.value.data
      }
      try {
        const all = await rateLimitGuard('allPools', () => activeProgram.account.poolState.all())
        const data = all.map((p) => p.account as unknown as PoolAccountMinimal)
        allPoolsCache.value = { data, fetchedAt: Date.now() }
        data.forEach((p) => {
          const id = p.betId.toNumber()
          if (!poolCache.value.has(id)) poolCache.value.set(id, { data: p, fetchedAt: Date.now() })
        })
        // no manual persistence needed
        return data
      } catch (e) {
        log.error('Failed to fetch all pools:', e)
        if (allPoolsCache.value) return allPoolsCache.value.data
        return []
      }
    }

    function invalidateAllPoolsCache() {
      allPoolsCache.value = null
    }

    async function getHistoryForBet(betId: number, opts?: { force?: boolean; ttlMs?: number }) {
      const activeProgram = program.value || getReadOnlyProgram()
      const [historyStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('history'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )
      const ttl = opts?.ttlMs ?? TTL.history
      const cached = historyCache.value.get(betId)
      if (!opts?.force && cached && Date.now() - cached.fetchedAt < ttl) return cached.data
      try {
        const accountsObj = activeProgram.account as unknown as Record<
          string,
          { fetch: (pk: PublicKey) => Promise<unknown> }
        >
        const raw = await rateLimitGuard(`history:${betId}`, () => {
          const accDef = accountsObj['poolHistoryState']
          if (!accDef) throw new Error('poolHistoryState account not available in IDL')
          return accDef.fetch(historyStatePda)
        })
        const data = raw as PoolHistoryMinimal
        historyCache.value.set(betId, { data, fetchedAt: Date.now() })
        return data
      } catch (e) {
        log.debug?.('history fetch failed, returning empty history', e)
        const empty = {
          betId: { toNumber: () => betId } as unknown as { toNumber(): number },
          points: [],
        } as PoolHistoryMinimal
        historyCache.value.set(betId, { data: empty, fetchedAt: Date.now() })
        return empty
      }
    }

    async function getUserEntries(userPubkey?: PublicKey, opts?: { force?: boolean }) {
      if (!program.value) {
        throw new Error('Program not available')
      }

      const userKey = userPubkey || wallet.value?.publicKey
      if (!userKey) {
        throw new Error('User not available')
      }
      const base58 = userKey.toBase58()
      if (!opts?.force && userEntriesCache.value && userEntriesCache.value.wallet === base58) {
        const age = Date.now() - userEntriesCache.value.fetchedAt
        if (age < TTL.userEntries) return userEntriesCache.value.data
      }
      try {
        const entries = await rateLimitGuard('userEntries', () =>
          program.value!.account.entryState.all([{ memcmp: { offset: 8, bytes: base58 } }]),
        )
        userEntriesCache.value = { wallet: base58, data: entries, fetchedAt: Date.now() }
        return entries
      } catch (error) {
        log.error('Failed to fetch user entries:', error)
        return userEntriesCache.value?.data || []
      }
    }

    // Fetch pools where the user is the creator or the referee using memcmp filters
    // Offsets (after 8-byte discriminator):
    // - creator: 0 -> memcmp offset = 8
    // - referee: 120 -> memcmp offset = 8 + 120 = 128
    async function getPoolsByCreatorOrReferee(userPubkey?: PublicKey) {
      if (!program.value) {
        throw new Error('Program not available')
      }

      const userKey = userPubkey || wallet.value?.publicKey
      if (!userKey) {
        throw new Error('User not available')
      }

      try {
        const CREATOR_OFFSET = 8 // 8 (discriminator) + 0 (creator)
        const REFEREE_OFFSET = 128 // 8 (discriminator) + 120 (referee field offset)

        const [creatorPools, refereePools] = await Promise.all([
          program.value.account.poolState.all([
            { memcmp: { offset: CREATOR_OFFSET, bytes: userKey.toBase58() } },
          ]),
          program.value.account.poolState.all([
            { memcmp: { offset: REFEREE_OFFSET, bytes: userKey.toBase58() } },
          ]),
        ])

        // Merge and dedupe by betId
        const seen = new Set<string>()
        const merged = [...creatorPools, ...refereePools]
          .filter(({ account }) => {
            const acc = account as unknown as { betId: { toString(): string } }
            const id = acc.betId?.toString?.() ?? ''
            if (!id || seen.has(id)) return false
            seen.add(id)
            return true
          })
          .map(({ account }) => account as unknown as PoolAccountMinimal)

        return merged
      } catch (error) {
        log.error('Failed to fetch pools by creator/referee:', error)
        return []
      }
    }

    async function getUserEntryForBet(betId: number, userPubkey?: PublicKey) {
      if (!program.value) {
        throw new Error('Program not available')
      }

      const userKey = userPubkey || wallet.value?.publicKey
      if (!userKey) {
        throw new Error('User not available')
      }

      try {
        // First derive the pool state PDA
        const [poolStatePda] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
          programID,
        )

        // Then derive the entry state PDA using the pool state PDA
        const [entryStatePda] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('entry'), poolStatePda.toBuffer(), userKey.toBuffer()],
          programID,
        )

        return await program.value.account.entryState.fetch(entryStatePda)
      } catch (error) {
        log.error('Failed to fetch user entry for bet:', error)
        return null
      }
    }

    async function getMainState(opts?: { force?: boolean }) {
      const activeProgram = program.value || getReadOnlyProgram()
      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )
      if (!opts?.force && mainStateCache.value) {
        const age = Date.now() - mainStateCache.value.fetchedAt
        if (age < TTL.mainState) return mainStateCache.value.data
      }
      try {
        const accountsObj = activeProgram.account as unknown as Record<
          string,
          { fetch: (pk: PublicKey) => Promise<unknown> }
        >
        const raw = await rateLimitGuard('mainState', () => {
          const accDef = accountsObj['mainState']
          if (!accDef) throw new Error('mainState account not available in IDL')
          return accDef.fetch(mainStatePda)
        })
        const data = raw as MainStateMinimal
        mainStateCache.value = { data, fetchedAt: Date.now() }
        return data
      } catch (error) {
        log.error('Failed to fetch main state:', error)
        return mainStateCache.value?.data || null
      }
    }

    // Admin: list pools where platform fee can be claimed (owner-only action)
    async function getClaimablePlatformFeePools() {
      if (!program.value) throw new Error('Program not available')
      try {
        const all = await program.value.account.poolState.all()
        // Filter claimable: completed and not yet claimed
        const claimable = all
          .map((p) => p.account as unknown as PoolAccountMinimal & { platformFeeClaimed?: boolean })
          .filter((p) => p.complete && !p.platformFeeClaimed)
        return claimable
      } catch (e) {
        log.error('Failed to fetch claimable platform fee pools:', e)
        return []
      }
    }

    async function getAllEntriesForBet(betId: number, opts?: { force?: boolean }) {
      const activeProgram = program.value || getReadOnlyProgram()
      const cached = entriesByBetCache.value.get(betId)
      if (!opts?.force && cached && Date.now() - cached.fetchedAt < TTL.entriesByBet)
        return cached.data
      try {
        const betIdLe = new BN(betId).toArrayLike(Uint8Array, 'le', 8)
        const entries = await rateLimitGuard(`entriesBet:${betId}`, () =>
          activeProgram.account.entryState.all([
            { memcmp: { offset: 8 + 32, bytes: bs58.encode(betIdLe) } },
          ]),
        )
        entriesByBetCache.value.set(betId, { data: entries, fetchedAt: Date.now() })
        return entries
      } catch (error) {
        log.error('Failed to fetch entries for bet:', error)
        try {
          const allEntries = await rateLimitGuard('entriesFallbackAll', () =>
            activeProgram.account.entryState.all(),
          )
          const filtered = allEntries.filter((entry) => entry.account.betId.toNumber() === betId)
          entriesByBetCache.value.set(betId, { data: filtered, fetchedAt: Date.now() })
          return filtered
        } catch {
          return cached?.data || []
        }
      }
    }

    async function ensureMainStateInitialized() {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const mainState = await getMainState()
      if (!mainState || !mainState.initialized) {
        throw new Error('Main state is not initialized. Please contact the administrator.')
      }
      return mainState
    }

    async function createEntry(betId: number) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const [entryStatePda] = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode('entry'),
          poolStatePda.toBuffer(),
          wallet.value.publicKey.toBuffer(),
        ],
        programID,
      )

      const tx = await program.value.methods
        .createEntry({
          betId: new BN(betId),
        })
        .accounts({
          user: wallet.value.publicKey,
          mainState: mainStatePda,
          poolState: poolStatePda,
          entryState: entryStatePda,
          systemProgram: SystemProgram.programId,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc()

      // Help avoid immediate read-after-write races in subsequent flows
      await confirmFinalized(tx)
      // Entry creation may increase participants/volume
      invalidateAllPoolsCache()
      poolCache.value.delete(betId)
      entriesByBetCache.value.delete(betId)
      userEntriesCache.value = null
      return tx
    }

    async function deposit(betId: number, isYes: boolean, amount: number) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      // Convert SOL amount to lamports
      const lamports = new BN(amount * 1e9)

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const [entryStatePda] = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode('entry'),
          poolStatePda.toBuffer(),
          wallet.value.publicKey.toBuffer(),
        ],
        programID,
      )

      const [solVaultPda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('sol-vault')],
        programID,
      )

      const [historyStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('history'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const tx = await program.value.methods
        .deposit({
          betId: new BN(betId),
          isYes,
          amount: lamports,
        })
        .accounts({
          user: wallet.value.publicKey,
          poolState: poolStatePda,
          entryState: entryStatePda,
          historyState: historyStatePda,
          solVault: solVaultPda,
          systemProgram: SystemProgram.programId,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc()

      // Liquidity / volume changed
      invalidateAllPoolsCache()
      poolCache.value.delete(betId)
      entriesByBetCache.value.delete(betId)
      return tx
    }

    async function setWinner(betId: number, isYes: boolean) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const tx = await program.value.methods
        .setWinner({
          betId: new BN(betId),
          isYes,
        })
        .accounts({
          referee: wallet.value.publicKey,
          mainState: mainStatePda,
          poolState: poolStatePda,
          solVault: PublicKey.findProgramAddressSync(
            [new TextEncoder().encode('sol-vault')],
            programID,
          )[0],
          platformOwner: (await program.value.account.mainState.fetch(mainStatePda)).owner,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc()

      // Market completion impacts trending
      invalidateAllPoolsCache()
      poolCache.value.delete(betId)
      entriesByBetCache.value.delete(betId)
      return tx
    }

    async function claim(betId: number) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const [entryStatePda] = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode('entry'),
          poolStatePda.toBuffer(),
          wallet.value.publicKey.toBuffer(),
        ],
        programID,
      )

      const [solVaultPda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('sol-vault')],
        programID,
      )

      const tx = await program.value.methods
        .claim({
          betId: new BN(betId),
        })
        .accounts({
          user: wallet.value.publicKey,
          mainState: mainStatePda,
          poolState: poolStatePda,
          entryState: entryStatePda,
          solVault: solVaultPda,
          systemProgram: SystemProgram.programId,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc()

      // Claim does not change pool public metrics materially; keep for safety
      invalidateAllPoolsCache()
      entriesByBetCache.value.delete(betId)
      userEntriesCache.value = null
      return tx
    }

    async function claimCreatorFee(betId: number) {
      if (!program.value || !wallet.value) {
        throw new Error('Wallet not connected or program not available')
      }

      const [mainStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('main')],
        programID,
      )

      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool'), new BN(betId).toArrayLike(Uint8Array, 'le', 8)],
        programID,
      )

      const [solVaultPda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('sol-vault')],
        programID,
      )

      const tx = await program.value.methods
        .claimCreatorFee({
          betId: new BN(betId),
        })
        .accounts({
          creator: wallet.value.publicKey,
          mainState: mainStatePda,
          poolState: poolStatePda,
          solVault: solVaultPda,
          systemProgram: SystemProgram.programId,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc()

      // Fee claim doesn't affect trending but may alter fee claimed flag
      invalidateAllPoolsCache()
      poolCache.value.delete(betId)
      return tx
    }

    function clearAllCaches() {
      allPoolsCache.value = null
      poolCache.value.clear()
      entriesByBetCache.value.clear()
      userEntriesCache.value = null
      historyCache.value.clear()
      mainStateCache.value = null
      // no manual persistence needed
    }

    return {
      // User state
      user,
      isAuthenticated,
      walletLoading,
      walletInitialized,
      logout,

      // Solana workspace
      wallet,
      connection,
      provider,
      program,
      getReadOnlyProgram,
      programID,
      walletAddress,

      // Expose resolved endpoint for diagnostics (not secret)
      rpcHttpEndpoint,

      // Smart contract functions
      createPool,
      getMainState,
      ensureMainStateInitialized,
      getPoolById,
      getPoolsByIds,
      getPoolsByCreatorOrReferee,
      getPoolByUuid,
      getHistoryForBet,
      getUserEntries,
      getUserEntryForBet,
      getAllEntriesForBet,
      getAllPools,
      invalidateAllPoolsCache,
      clearAllCaches,
      createEntry,
      deposit,
      setWinner,
      claim,
      claimCreatorFee,
      getClaimablePlatformFeePools,
      // telemetry
      rateLimitHitCount,
      // debug helpers
    }
  },
  {
    persist: true, // Enable persistence to localStorage
  },
)
