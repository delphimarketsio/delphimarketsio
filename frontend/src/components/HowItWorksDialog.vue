<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

const props = defineProps<{
  modelValue: boolean
  showAck?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'ack-change', value: boolean): void
}>()

const internalOpen = ref(props.modelValue)
const dontShowAgain = ref(false)

watch(
  () => props.modelValue,
  (v) => {
    internalOpen.value = v
  },
)

watch(internalOpen, (v) => emit('update:modelValue', v))

const onClose = () => {
  internalOpen.value = false
}

const onAckToggle = (e: Event) => {
  const target = e.target as HTMLInputElement
  dontShowAgain.value = target.checked
  emit('ack-change', target.checked)
}

onMounted(() => {
  // focus trap could be added here if needed later
})
</script>

<template>
  <teleport to="body">
    <div
      v-show="internalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      <div class="absolute inset-0 bg-black/50" @click="onClose" />
      <div class="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div class="mb-4">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white">How it works</h2>
          <p class="mt-1 text-gray-600 dark:text-gray-300">
            Quick primer before you connect your wallet.
          </p>
        </div>

        <ol class="space-y-3 text-gray-700 dark:text-gray-200">
          <li class="flex gap-3">
            <span
              class="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white"
              >1</span
            >
            <div>
              <p class="font-medium">Connect your Solana wallet</p>
              <p class="text-sm text-gray-600 dark:text-gray-300">
                We support Phantom, Solflare and more via Solana Wallet Adapter.
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <span
              class="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white"
              >2</span
            >
            <div>
              <p class="font-medium">Create or join markets</p>
              <p class="text-sm text-gray-600 dark:text-gray-300">
                Spin up a market or join via a shareable link. All actions are on-chain.
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <span
              class="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white"
              >3</span
            >
            <div>
              <p class="font-medium">Stake and settle</p>
              <p class="text-sm text-gray-600 dark:text-gray-300">
                Funds are locked by smart contracts; winners can claim instantly on resolve.
              </p>
            </div>
          </li>
        </ol>

        <div class="mt-5 flex items-center justify-between">
          <div v-if="props.showAck !== false" class="flex items-center">
            <label class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                class="h-4 w-4"
                :checked="dontShowAgain"
                @change="onAckToggle"
              />
              Don't show this again
            </label>
          </div>
          <div v-else class="text-xs text-gray-500 dark:text-gray-400">
            Explore. Place a view. Own the outcome.
          </div>
          <button
            class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 align-right"
            type="button"
            @click="onClose"
          >
            Close
          </button>
        </div>

        <div class="mt-4">
          <!-- Consumer should place WalletMultiButton here via slot for consistent styling -->
          <slot />
        </div>

        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
          By continuing, you agree to our
          <RouterLink to="/terms" class="underline hover:text-gray-700 dark:hover:text-gray-200"
            >Terms & Conditions</RouterLink
          >, acknowledge our
          <RouterLink to="/privacy" class="underline hover:text-gray-700 dark:hover:text-gray-200"
            >Privacy Policy</RouterLink
          >, and accept the
          <RouterLink to="/risk" class="underline hover:text-gray-700 dark:hover:text-gray-200"
            >Risk Disclosure</RouterLink
          >. You understand that on-chain interactions may prompt your wallet for approvals. You
          certify that you are 18 years of age or older.
        </p>
      </div>
    </div>
  </teleport>
</template>

<style scoped></style>
