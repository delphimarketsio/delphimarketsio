<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import HowItWorksDialog from './HowItWorksDialog.vue'

const props = defineProps<{
  storageKey?: string
  enabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-change', value: boolean): void
}>()

const isOpen = ref(false)
const dontShowAgain = ref(false)
const key = props.storageKey ?? 'dm.howItWorks.dismissed'
const enabled = computed(() => props.enabled !== false)

onMounted(() => {
  try {
    const stored = localStorage.getItem(key)
    dontShowAgain.value = stored === '1'
  } catch {}
})

const onClick = (e: Event) => {
  // If dialog is already open, allow inner button click to propagate
  if (isOpen.value) return
  if (!enabled.value || dontShowAgain.value) return // allow normal click to propagate

  // We intercept first click and show dialog
  e.preventDefault()
  e.stopPropagation()
  isOpen.value = true
  emit('open-change', true)
}

const onAckChange = (value: boolean) => {
  dontShowAgain.value = value
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {}
}
</script>

<template>
  <div class="inline-flex items-center" @click.capture="onClick">
    <!-- Expose the Wallet button via slot so it renders exactly as provided -->
    <slot name="button" />

    <!-- Modal dialog -->
    <HowItWorksDialog v-model="isOpen" @ack-change="onAckChange">
      <slot />
      <div class="mt-4" @click="isOpen = false">
        <!-- Render the same button inside dialog to proceed -->
        <slot name="button" />
      </div>
    </HowItWorksDialog>
  </div>
</template>

<style scoped></style>
