<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router'
import { nextTick, onBeforeUnmount, onMounted, watch, type WatchStopHandle } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import SiteFooter from '@/components/Footer.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'

const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()

// Start the auth watcher only after the initial navigation/render is complete to avoid race conditions
let stopAuthWatch: WatchStopHandle | null = null

onMounted(async () => {
  // Ensure the router finished resolving the initial route (e.g., when pasting a deep link)
  await router.isReady()
  // Let the view finish its first render cycle
  await nextTick()

  stopAuthWatch = watch(
    () => workspaceStore.isAuthenticated,
    (isAuthed) => {
      if (!isAuthed) {
        // If user logs out (or loses auth) while on a protected route, send them to public dashboard root
        const requiresAuth = route.matched.some((r) => r.meta?.requiresAuth)
        if (requiresAuth) router.replace('/')
      }
      // No redirect needed on login anymore because '/' already renders DashboardView
    },
    { immediate: true },
  )
})

onBeforeUnmount(() => {
  if (stopAuthWatch) {
    stopAuthWatch()
    stopAuthWatch = null
  }
})
</script>

<template>
  <div class="app-layout">
    <RouterView />
    <SiteFooter />
    <ToastContainer position="top-right" />
  </div>
</template>

<style>
.app-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    'header'
    'main'
    'footer';
  min-height: 100vh;
  width: 100%;
}

@media (min-width: 1024px) {
  .app-layout {
    grid-template-columns: 1fr;
  }
}
</style>
