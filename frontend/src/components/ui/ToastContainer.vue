<script setup lang="ts">
import { computed } from 'vue'
import { useToastStore } from '@/stores/toast'
import { Check, X, Info, TriangleAlert } from 'lucide-vue-next'

const props = defineProps<{
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
}>()
const toast = useToastStore()

const posClass = computed(() => {
  switch (props.position ?? 'top-right') {
    case 'top-left':
      return 'top-4 left-4'
    case 'bottom-right':
      return 'bottom-4 right-4'
    case 'bottom-left':
      return 'bottom-4 left-4'
    default:
      return 'top-4 right-4'
  }
})

const ringByType: Record<string, string> = {
  success: 'ring-green-500/30',
  error: 'ring-red-500/30',
  info: 'ring-blue-500/30',
  warning: 'ring-yellow-500/30',
}

const bgByType: Record<string, string> = {
  success: 'bg-green-50 dark:bg-green-900/40',
  error: 'bg-red-50 dark:bg-red-900/40',
  info: 'bg-blue-50 dark:bg-blue-900/40',
  warning: 'bg-yellow-50 dark:bg-yellow-900/40',
}
</script>

<template>
  <div :class="['pointer-events-none fixed z-[9999] flex flex-col gap-2', posClass]">
    <TransitionGroup name="toast" tag="div">
      <div
        v-for="t in toast.toasts"
        :key="t.id"
        :class="[
          'pointer-events-auto w-[min(92vw,420px)] rounded-xl border border-black/5 p-4 shadow-lg ring-1 backdrop-blur',
          'dark:border-white/5',
          bgByType[t.type],
          ringByType[t.type],
        ]"
      >
        <div class="flex items-start gap-3">
          <div class="shrink-0">
            <Check v-if="t.type === 'success'" class="h-5 w-5 text-green-900 dark:text-green-100" />
            <X v-if="t.type === 'error'" class="h-5 w-5 text-red-900 dark:text-red-100" />
            <Info v-if="t.type === 'info'" class="h-5 w-5 text-blue-900 dark:text-blue-100" />
            <TriangleAlert
              v-if="t.type === 'warning'"
              class="h-5 w-5 text-yellow-900 dark:text-yellow-100"
            />
          </div>
          <div class="min-w-0 flex-1">
            <p v-if="t.title" class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ t.title }}
            </p>
            <p class="mt-0.5 text-sm text-gray-700 dark:text-gray-300 break-words">
              {{ t.message }}
            </p>
          </div>
          <button
            class="rounded-md p-1 text-gray-500 hover:bg-black/5 hover:text-gray-700 focus:outline-none dark:text-gray-300 dark:hover:bg-white/10"
            aria-label="Close"
            @click="toast.remove(t.id)"
          >
            <X class="h-5 w-5 text-gray-500 dark:text-gray-300" />
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 180ms ease;
}
.toast-move {
  transition: transform 180ms ease;
}
</style>
