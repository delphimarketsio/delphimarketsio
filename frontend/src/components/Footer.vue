<script setup lang="ts">
defineOptions({ name: 'SiteFooter' })
import { RouterLink } from 'vue-router'
const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <div class="max-w-7xl mx-auto px-4 py-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div class="text-gray-700 dark:text-gray-300">
          <span class="font-semibold text-[#3B82F6] dark:text-[#60A5FA]">DelphiMarkets</span>
          <span class="ml-2 text-sm">© {{ year }}. All rights reserved.</span>
        </div>

        <nav class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <RouterLink
            to="/terms"
            class="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >Terms of Service</RouterLink
          >
          <RouterLink
            to="/privacy"
            class="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >Privacy Policy</RouterLink
          >
          <RouterLink
            to="/risk"
            class="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >Risk Disclosure</RouterLink
          >
        </nav>
      </div>

      <p class="mt-6 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        Trading and prediction markets involve risk, including the potential loss of your capital.
        Nothing on this site constitutes financial advice. Always do your own research and only
        commit funds you can afford to lose.
      </p>
    </div>
  </footer>
</template>
