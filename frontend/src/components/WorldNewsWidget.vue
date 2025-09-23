<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Euronews RSS feed via local dev proxy (/news-feed configured in Vite / server).
const FEED_URL = '/news-feed'

interface NewsItem {
  title: string
  link: string
  pubDate?: string
  description?: string
  image?: string // optional thumbnail image URL
}

const loading = ref(true)
const error = ref<string | null>(null)
const items = ref<NewsItem[]>([])

function parseRss(xmlText: string): NewsItem[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Failed to parse feed')
  const out: NewsItem[] = []
  doc.querySelectorAll('item, entry').forEach((node) => {
    const title = node.querySelector('title')?.textContent?.trim() || 'Untitled'
    const linkEl = node.querySelector('link')
    let link = linkEl?.getAttribute('href') || linkEl?.textContent || '#'
    if (link && !/^https?:\/\//i.test(link)) {
      link = `https://www.euronews.com${link}`
    }
    const pubDate =
      node.querySelector('pubDate')?.textContent ||
      node.querySelector('updated')?.textContent ||
      undefined
    const description = node.querySelector('description')?.textContent || undefined

    // Image extraction (best-effort): prioritize MRSS media:content / media:thumbnail
    let image: string | undefined
    const mediaContent = node.querySelector('media\\:content, content')
    if (mediaContent) {
      const url = mediaContent.getAttribute('url')
      if (url) image = url
    }
    if (!image) {
      const mediaThumb = node.querySelector('media\\:thumbnail')
      const url = mediaThumb?.getAttribute('url')
      if (url) image = url
    }
    if (!image) {
      const enclosure = node.querySelector('enclosure')
      const url = enclosure?.getAttribute('url')
      if (url && /^https?:\/\//i.test(url)) image = url
    }
    if (!image && description) {
      // crude: pull first <img src="..."> from description HTML if present
      const match = description.match(/<img[^>]+src=["']([^"'>]+)["']/i)
      if (match) image = match[1]
    }

    // Ensure absolute if starting with //
    if (image && image.startsWith('//')) {
      image = 'https:' + image
    }

    out.push({ title, link, pubDate, description, image })
  })
  return out.slice(0, 12)
}

async function loadFeed() {
  loading.value = true
  error.value = null
  try {
    let res: Response
    try {
      res = await fetch(FEED_URL, { cache: 'no-store' })
    } catch {
      throw new Error('Network error contacting feed')
    }
    if (!res.ok) throw new Error(`Feed request failed: ${res.status}`)
    const text = await res.text()
    items.value = parseRss(text)
  } catch (e) {
    // If it's a CORS issue, the browser will block access before we can read details; message accordingly.
    if (
      e instanceof Error &&
      (e.message.includes('Failed to fetch') || e.message.includes('CORS'))
    ) {
      error.value = 'CORS blocked direct feed fetch. Use a server-side proxy.'
    } else {
      error.value = (e as Error).message || 'Unknown error'
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadFeed()
})

function formatDate(dateStr?: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white">World News</h2>
      <button
        class="text-xs text-[#3B82F6] hover:underline disabled:opacity-50"
        :disabled="loading"
        @click="loadFeed"
      >
        Refresh
      </button>
    </div>
    <p class="text-xs text-gray-500 dark:text-gray-400">
      Latest global headlines. Headlines are for context only and not investment advice.
    </p>

    <div
      class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
    >
      <div v-if="loading" class="p-4 text-sm text-gray-500 dark:text-gray-400">Loading news...</div>
      <div v-else-if="error" class="p-4 text-sm text-red-600 dark:text-red-400">
        Failed to load news: {{ error }}
      </div>
      <ul v-else class="divide-y divide-gray-200 dark:divide-gray-700">
        <li
          v-for="item in items"
          :key="item.link"
          class="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/40"
        >
          <a
            :href="item.link"
            target="_blank"
            rel="noopener noreferrer"
            class="flex gap-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#3B82F6] rounded"
          >
            <div
              v-if="item.image"
              class="relative shrink-0 w-16 h-16 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
            >
              <img
                :src="item.image"
                alt=""
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover"
                @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                {{ item.title }}
              </p>
              <div
                class="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <span v-if="item.pubDate">{{ formatDate(item.pubDate) }}</span>
              </div>
            </div>
          </a>
        </li>
        <li
          v-if="!items.length && !loading && !error"
          class="p-4 text-xs text-gray-500 dark:text-gray-400"
        >
          No headlines available.
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* clamp lines for title; fallback if no tailwind plugin */
.line-clamp-2 {
  display: -webkit-box;
  line-clamp: 2; /* Standard property */
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
