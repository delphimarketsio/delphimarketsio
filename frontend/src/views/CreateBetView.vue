<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLogger } from 'vue-logger-plugin'
import { useToastStore } from '@/stores/toast'
import Header from '@/components/Header.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Info } from 'lucide-vue-next'

const router = useRouter()
const workspace = useWorkspaceStore()
const log = useLogger()
const toast = useToastStore()

// Form data
const betTitle = ref('')
const betDescription = ref('')
const endDate = ref('')
const noEndDate = ref(false)
const refereeAddress = ref('')

// Fixed bet options (Yes/No as required by smart contract)
const betOptions = ['Yes', 'No']

// Loading state
const isCreating = ref(false)

// Main state (for transparent fee disclosure)
const mainState = ref<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
onMounted(async () => {
  try {
    mainState.value = await workspace.getMainState()
  } catch (e) {
    log.debug?.('Failed to load main state for fee hint (non-blocking)', e)
  }
})

// Fee percent helpers (basis points --> % label)
const creatorFeePercentBps = computed(
  () => mainState.value?.creatorFeePercent?.toNumber?.() ?? 100, // default 1.00%
)
const platformFeePercentBps = computed(
  () => mainState.value?.platformFeePercent?.toNumber?.() ?? 200, // default 2.00%
)
const formatBps = (bps: number) => {
  const pct = bps / 100
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`
}
const creatorFeePercentLabel = computed(() => formatBps(creatorFeePercentBps.value))
const platformFeePercentLabel = computed(() => formatBps(platformFeePercentBps.value))

// Utility functions for setting current user's wallet address
const setCurrentUserAsReferee = () => {
  if (workspace.walletAddress) {
    refereeAddress.value = workspace.walletAddress
  }
}

const createBet = async () => {
  // Validate form
  if (
    !betTitle.value ||
    !betDescription.value ||
    (!noEndDate.value && !endDate.value) ||
    !refereeAddress.value
  ) {
    toast.warning('Please fill in all required fields', 'Missing fields')
    return
  }

  // Check if wallet is connected and program is available
  if (!workspace.program || !workspace.wallet) {
    toast.info('Please connect your wallet first', 'Wallet required')
    return
  }

  try {
    isCreating.value = true

    // Ensure main state is initialized before creating a pool
    try {
      await workspace.ensureMainStateInitialized()
    } catch (e) {
      log.warn('Main state not initialized yet, attempting to initialize...', e)
      // Try once more, then surface a helpful message if it still fails
      try {
        await workspace.ensureMainStateInitialized()
      } catch (e2) {
        log.warn('Second attempt to initialize main state failed', e2)
        throw new Error('Platform is still initializing. Please try again shortly.')
      }
    }

    // Convert end date to timestamp (or -1 for open-ended)
    const endTimestamp = noEndDate.value ? -1 : Math.floor(new Date(endDate.value).getTime() / 1000)

    // Use the specified referee address
    const referee = refereeAddress.value.trim()

    // Create the betting pool using the workspace utility function
    const tx = await workspace.createPool(
      betTitle.value,
      betDescription.value,
      endTimestamp,
      referee,
    )

    log.info('Market created successfully! Transaction:', tx)
    log.info('Pool created with:', {
      title: betTitle.value,
      description: betDescription.value,
      options: betOptions, // Fixed Yes/No options
      endDate: endDate.value,
      // min stake removed
      refereeAddress: refereeAddress.value,
      transaction: tx,
    })

    toast.success('Market created successfully!', 'Market created')
    // Redirect to root dashboard (previously '/dashboard')
    router.push('/')
  } catch (error) {
    log.error('Error creating market:', error)
    const err = error as Record<string, unknown> | null
    const txMsg =
      typeof err?.transactionMessage === 'string' && err.transactionMessage.trim()
        ? (err.transactionMessage as string)
        : undefined
    const msg = txMsg || (error instanceof Error ? error.message : 'Unknown error')
    toast.error(`Failed to create market: ${msg}`, 'Creation failed')
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <Header />
  <main class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-4xl mx-auto px-4 py-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">Create New Market</h1>
        <p class="text-gray-600 dark:text-gray-400">
          Set up a public market and share the link for others to participate
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Market Details</CardTitle>
          <CardDescription
            >Create a market that anyone can join via a shareable link</CardDescription
          >
        </CardHeader>

        <CardContent class="space-y-6">
          <!-- Transparent Fee / Cost Hint -->
          <div
            class="flex gap-3 rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/70 dark:bg-gray-800/40 px-4 py-3 text-xs text-gray-600 dark:text-gray-300"
          >
            <Info class="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400 mt-0.5" />
            <p class="leading-relaxed">
              Creating a market requires a one‑time on‑chain account allocation (~0.014 SOL rent + a
              tiny network fee). No part of that is a protocol fee and no stake is locked from you
              now. At resolution, <span class="font-medium">{{ creatorFeePercentLabel }}</span> of
              the total pool (from the losing side) is paid as a creator fee and
              <span class="font-medium">{{ platformFeePercentLabel }}</span> as a platform fee
              before distributing winnings to the winning side. Percentages are protocol parameters
              and may change only through an administrative update.
            </p>
          </div>
          <!-- Market Title -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Market Title *
            </label>
            <input
              v-model="betTitle"
              type="text"
              placeholder="e.g., Will it rain tomorrow?"
              class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-[#3B82F6] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              required
            />
          </div>

          <!-- Market Description -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description *
            </label>
            <textarea
              v-model="betDescription"
              rows="3"
              placeholder="Provide more details about the market question and how it will be resolved..."
              class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-[#3B82F6] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              required
            ></textarea>
          </div>

          <!-- Outcomes -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Outcomes
            </label>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  value="Yes"
                  disabled
                  class="flex-1 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-gray-600 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-300"
                />
                <span class="text-sm text-gray-500 dark:text-gray-400">Option 1</span>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  value="No"
                  disabled
                  class="flex-1 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-gray-600 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-300"
                />
                <span class="text-sm text-gray-500 dark:text-gray-400">Option 2</span>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Outcomes are fixed to "Yes" and "No"
            </p>
          </div>

          <!-- End Date -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              End Date <span class="text-gray-500 text-xs">(optional)</span>
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model="endDate"
                type="datetime-local"
                :disabled="noEndDate"
                class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-[#3B82F6] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              />
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" v-model="noEndDate" />
              This market has no fixed end date (referee can resolve anytime)
            </label>
          </div>

          <!-- Referee Address -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Referee Address *
            </label>
            <div class="flex items-center gap-2">
              <input
                v-model="refereeAddress"
                type="text"
                placeholder="Wallet address of the referee (e.g., 7k8mh...)"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 focus:border-[#3B82F6] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                required
              />
              <Button
                @click="setCurrentUserAsReferee"
                variant="outline"
                size="sm"
                :disabled="!workspace.walletAddress"
                class="whitespace-nowrap"
              >
                Use Me
              </Button>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              The referee will determine the winner when the market ends
            </p>
          </div>
        </CardContent>

        <CardFooter class="flex justify-between">
          <Button @click="router.push('/')" variant="outline" :disabled="isCreating">
            Cancel
          </Button>
          <Button
            @click="createBet"
            class="bg-[#3B82F6] hover:bg-[#3B82F6]/90"
            :disabled="isCreating"
          >
            {{ isCreating ? 'Creating Market...' : 'Create Market' }}
          </Button>
        </CardFooter>
      </Card>
    </div>
  </main>
</template>
