import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useWorkspaceStore, type MainStateMinimal } from '@/stores/workspace'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      // Public: will show trending markets even if not authenticated; user sections gated inside component
      meta: {},
    },
    {
      path: '/create-bet',
      name: 'create-bet',
      component: () => import('../views/CreateBetView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // Canonical bet route now uses UUID only (no incremental numeric IDs in URL)
      path: '/bet/:uuid',
      name: 'bet-share', // keep existing component expecting uuid path param
      component: () => import('../views/BetDetailsView.vue'),
      meta: {},
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../views/AdminView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('../views/TermsView.vue'),
      meta: {},
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('../views/PrivacyView.vue'),
      meta: {},
    },
    {
      path: '/risk',
      name: 'risk',
      component: () => import('../views/RiskView.vue'),
      meta: {},
    },
  ],
})

// Navigation guard to check authentication
router.beforeEach(async (to, from, next) => {
  const workspaceStore = useWorkspaceStore()

  // If wallet is still loading, wait for it to initialize
  if (workspaceStore.walletLoading) {
    // Wait for wallet initialization or timeout
    let timeoutId: ReturnType<typeof setTimeout>
    const waitForWallet = new Promise<void>((resolve) => {
      const stopWatcher = watch(
        () => workspaceStore.walletInitialized,
        (initialized: boolean) => {
          if (initialized) {
            clearTimeout(timeoutId)
            stopWatcher()
            resolve()
          }
        },
        { immediate: true },
      )

      // Fallback timeout after 3 seconds
      timeoutId = setTimeout(() => {
        stopWatcher()
        resolve()
      }, 3000)
    })

    await waitForWallet
  }

  // Now proceed with normal navigation logic
  if (to.meta.requiresAuth && !workspaceStore.isAuthenticated) {
    next('/')
  } else if (to.meta.requiresAdmin) {
    // Admin-only routes: require wallet to be the MainState owner
    try {
      const mainState = (await workspaceStore.getMainState()) as MainStateMinimal | null
      const ownerStr = mainState?.owner?.toString?.()
      const isOwner = !!ownerStr && ownerStr === workspaceStore.walletAddress
      if (!isOwner) {
        next('/')
      } else {
        next()
      }
    } catch {
      next('/')
    }
  } else {
    next()
  }
})

export default router
