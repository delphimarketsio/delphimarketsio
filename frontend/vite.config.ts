import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools({
      launchEditor: 'code',
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Ensure the Node.js 'buffer' module resolves to the browser polyfill package
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    // Pre-bundle buffer so Vite doesn't externalize the Node core module name
    include: ['buffer'],
  },
  server: {
    proxy: {
      '/news-feed': {
        target: 'https://decrypt.co',
        changeOrigin: true,
        rewrite: () => '/feed',
        headers: {
          // Some feeds require a user-agent; set a generic one
          'User-Agent': 'DelphiMarketsFeedProxy/1.0',
          // Ensure correct Host header for some CDNs
          Host: 'decrypt.co',
        },
      },
    },
  },
})
