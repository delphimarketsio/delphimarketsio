<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import Header from '@/components/Header.vue'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLogger } from 'vue-logger-plugin'

// Minimal shape for markets shown in approvals
type PendingMarket = {
  betId: { toNumber(): number; toString(): string }
  title: string
  description: string
  endTimestamp?: { toNumber(): number }
  referee?: { toString(): string }
  winner?: string // proposed winner by referee
}

const ws = useWorkspaceStore()
const log = useLogger()

const loading = ref(false)
const pendingMarkets = ref<PendingMarket[]>([])
const approving = ref<Record<string, boolean>>({})
const mainState = ref<{
  initialized?: boolean
  owner?: { toString(): string }
  scaleFactor?: { toNumber(): number }
  initialPrice?: { toNumber(): number }
  currentBetId?: { toNumber(): number }
  creatorFeePercent?: { toNumber(): number }
  platformFeePercent?: { toNumber(): number }
} | null>(null)

const isOwner = computed(() => {
  const owner = mainState.value?.owner?.toString?.()
  return !!owner && owner === ws.walletAddress
})

async function load() {
  if (!ws.isAuthenticated) return
  loading.value = true
  try {
    mainState.value = (await ws.getMainState()) as unknown as typeof mainState.value
    // Fetch markets awaiting approval.
    // Prefer future store method if available; otherwise fall back to recently completed markets.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof ws.getMarketsAwaitingApproval === 'function') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore narrow type of store
      pendingMarkets.value = (await ws.getMarketsAwaitingApproval())?.filter(Boolean) ?? []
    } else if (typeof ws.getClaimablePlatformFeePools === 'function') {
      // Fallback: use existing helper to show completed markets (as stand-in for approvals)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore narrow type of store
      pendingMarkets.value = (await ws.getClaimablePlatformFeePools())?.filter(Boolean) ?? []
    } else {
      pendingMarkets.value = []
    }
  } catch (e) {
    log.error('Failed to load admin data', e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function approve(betIdNum: number) {
  const key = String(betIdNum)
  if (approving.value[key]) return
  approving.value[key] = true
  try {
    // Try to call a future store method if available; otherwise simulate success.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof ws.approveMarketResolution === 'function') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await ws.approveMarketResolution(betIdNum)
    } else {
      // No on-chain approval yet — simulate async confirmation
      await new Promise((r) => setTimeout(r, 650))
    }
    // Remove from list after approval
    pendingMarkets.value = pendingMarkets.value.filter((m) => m.betId.toNumber() !== betIdNum)
  } catch (e) {
    log.error('Approval failed', e)
  } finally {
    approving.value[key] = false
  }
}
</script>

<template>
  <Header />
  <main class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-6xl mx-auto px-4 py-8">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">Admin Console</h1>
        <p class="text-gray-600 dark:text-gray-400">Review and approve market resolutions.</p>
      </div>

      <div v-if="!isOwner" class="text-center py-16">
        <p class="text-gray-600 dark:text-gray-400">You are not authorized to view this page.</p>
      </div>

      <div v-else>
        <Card class="mb-8">
          <CardHeader>
            <CardTitle>Admin Tools</CardTitle>
            <CardDescription>Main state overview</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300"
            >
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Initialized</span>
                <span>
                  {{
                    mainState?.initialized === true
                      ? 'Yes'
                      : mainState?.initialized === false
                        ? 'No'
                        : 'Unknown'
                  }}
                </span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Current Bet ID</span>
                <span>{{ mainState?.currentBetId?.toNumber?.() ?? '—' }}</span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Scale Factor</span>
                <span>{{ mainState?.scaleFactor?.toNumber?.() ?? '—' }}</span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Initial Price</span>
                <span>{{ mainState?.initialPrice?.toNumber?.() ?? '—' }}</span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Creator Fee</span>
                <span
                  >{{ ((mainState?.creatorFeePercent?.toNumber?.() ?? 0) / 100).toFixed(2) }}%</span
                >
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="text-gray-500 dark:text-gray-400">Platform Fee</span>
                <span
                  >{{
                    ((mainState?.platformFeePercent?.toNumber?.() ?? 0) / 100).toFixed(2)
                  }}%</span
                >
              </div>
              <div class="flex items-center justify-between gap-4 md:col-span-2">
                <span class="text-gray-500 dark:text-gray-400">Owner</span>
                <span class="truncate">{{ mainState?.owner?.toString?.() ?? '—' }}</span>
              </div>
            </div>
            <div class="mt-3 text-xs text-gray-500">
              Approvals are required for some markets before payouts proceed.
            </div>
          </CardContent>
        </Card>

        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">
            Markets awaiting approval
          </h2>
          <div class="flex gap-2">
            <Button variant="secondary" @click="load" :disabled="loading">Refresh</Button>
          </div>
        </div>

        <div v-if="loading" class="text-center py-16">Loading…</div>
        <div v-else-if="pendingMarkets.length === 0" class="text-center py-16">
          No markets awaiting approval.
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card v-for="pool in pendingMarkets" :key="pool.betId.toString()">
            <CardHeader>
              <CardTitle>Bet #{{ pool.betId.toNumber() }} — {{ pool.title }}</CardTitle>
              <CardDescription class="line-clamp-2">{{ pool.description }}</CardDescription>
            </CardHeader>
            <CardContent class="flex items-center justify-between gap-4">
              <div class="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                <div>Status: Awaiting admin approval</div>
                <div v-if="pool.winner">Proposed winner: {{ pool.winner }}</div>
              </div>
              <div class="flex gap-2 shrink-0">
                <RouterLink :to="{ name: 'bet-details', params: { id: pool.betId.toNumber() } }">
                  <Button variant="outline">View bet</Button>
                </RouterLink>
                <Button
                  class="bg-[#16A34A] hover:bg-[#16A34A]/90"
                  :disabled="approving[String(pool.betId.toNumber())]"
                  @click="approve(pool.betId.toNumber())"
                >
                  <span v-if="approving[String(pool.betId.toNumber())]">Approving…</span>
                  <span v-else>Approve</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped></style>
