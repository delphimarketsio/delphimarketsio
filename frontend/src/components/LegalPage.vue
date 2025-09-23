<script setup lang="ts">
defineOptions({ name: 'LegalPage' })
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  title: string
  html: string
}>()

// Build a simple table of contents from h2 headings in the provided HTML
const toc = computed(() => {
  const container = document.createElement('div')
  container.innerHTML = props.html || ''
  const items = Array.from(container.querySelectorAll('h2')).map((h, idx) => ({
    id: h.id || `section-${idx + 1}`,
    text: h.textContent || `Section ${idx + 1}`,
  }))
  return items
})

// Inject IDs into the HTML for anchor links
const processedHtml = ref('')
const process = () => {
  const container = document.createElement('div')
  container.innerHTML = props.html || ''
  let sectionIdx = 0
  container.querySelectorAll('h2').forEach((h) => {
    sectionIdx += 1
    if (!h.id) h.id = `section-${sectionIdx}`
  })
  processedHtml.value = container.innerHTML
}

watch(
  () => props.html,
  () => process(),
  { immediate: true },
)
</script>

<template>
  <main class="legal-page bg-white dark:bg-gray-900">
    <div class="max-w-7xl mx-auto px-4 py-10">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">{{ title }}</h1>

      <div class="grid grid-cols-1 gap-8">
        <!-- Top TOC -->
        <div>
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              On this page
            </h2>
            <nav class="space-y-2 legal-toc">
              <a v-for="item in toc" :key="item.id" :href="`#${item.id}`" class="block text-sm">{{
                item.text
              }}</a>
            </nav>
          </div>
        </div>

        <!-- Content -->
        <article class="max-w-none">
          <div class="legal-article">
            <div class="legal-content" v-html="processedHtml"></div>
          </div>
        </article>
      </div>
    </div>
  </main>
</template>

<style>
/* Article card */
.legal-page .legal-article {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.125rem;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
}
@media (min-width: 768px) {
  .legal-page .legal-article {
    padding: 1.75rem;
  }
}

.legal-page .legal-content {
  color: var(--foreground);
  line-height: 1.75;
}

.legal-page .legal-content h1,
.legal-page .legal-content h2,
.legal-page .legal-content h3,
.legal-page .legal-content h4 {
  color: var(--foreground);
  margin-top: 1.75rem;
  margin-bottom: 0.75rem;
  font-weight: 700;
  scroll-margin-top: 96px; /* avoid overlap with sticky header */
}
.legal-page .legal-content h1 {
  font-size: 1.875rem;
  letter-spacing: -0.01em;
}
.legal-page .legal-content h2 {
  font-size: 1.625rem;
  letter-spacing: -0.01em;
  border-left: 3px solid var(--primary);
  padding-left: 0.5rem;
  position: relative;
}
.legal-page .legal-content h2::after {
  content: '';
  position: absolute;
  left: 0.5rem;
  right: 0;
  bottom: -0.4rem;
  height: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, transparent 60%);
  opacity: 0.25;
}
.legal-page .legal-content h3 {
  font-size: 1.25rem;
  color: oklch(0.4 0 0 / 1);
}
.legal-page .legal-content h4 {
  font-size: 1.125rem;
}

.legal-page .legal-content p {
  margin: 0.85rem 0 1.15rem 0;
  color: oklch(0.32 0 0 / 1);
  font-size: 1.05rem;
  letter-spacing: 0.005em;
  max-width: 75ch;
}
.dark .legal-page .legal-content p {
  color: oklch(0.92 0 0 / 1);
}

/* Improve measure for primary text blocks */
.legal-page .legal-content ul,
.legal-page .legal-content ol,
.legal-page .legal-content blockquote {
  max-width: 72ch;
}

.legal-page .legal-content a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1.5px;
}
.legal-page .legal-content a:hover {
  opacity: 0.9;
}

.legal-page .legal-content ul,
.legal-page .legal-content ol {
  margin: 0.5rem 0 1rem 0;
  padding-left: 1.25rem;
}
.legal-page .legal-content ul {
  list-style: disc;
}
.legal-page .legal-content ol {
  list-style: decimal;
}
.legal-page .legal-content li {
  margin: 0.25rem 0;
}
.legal-page .legal-content li::marker {
  color: var(--primary);
}
.legal-page .legal-content ul ul,
.legal-page .legal-content ol ol {
  margin-top: 0.25rem;
}
.legal-page .legal-content h2 + ul,
.legal-page .legal-content h2 + p {
  margin-top: 0.5rem;
}

.legal-page .legal-content strong {
  font-weight: 600;
}
.legal-page .legal-content em {
  opacity: 0.9;
}

.legal-page .legal-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}

.legal-page .legal-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}
.legal-page .legal-content th,
.legal-page .legal-content td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
}
.legal-page .legal-content thead th {
  background: oklch(0.97 0 0);
}
.dark .legal-page .legal-content thead th {
  background: oklch(0.2 0 0);
}

/* Small top meta text (e.g., last updated) */
.legal-page .legal-content p:first-child em {
  display: inline-block;
  background: var(--accent);
  color: var(--accent-foreground);
  border: 1px solid var(--border);
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.8125rem;
}

/* Improve spacing after consecutive headings */
.legal-page .legal-content h2 + h3 {
  margin-top: 0.5rem;
}

/* Blockquote */
.legal-page .legal-content blockquote {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border-left: 3px solid var(--primary);
  background: oklch(0.98 0 0);
}
.dark .legal-page .legal-content blockquote {
  background: oklch(0.18 0 0);
}

/* Tables */
.legal-page .legal-content caption {
  text-align: left;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

/* TOC styles */
.legal-page .legal-toc a {
  color: oklch(0.45 0 0 / 1);
  padding: 0.25rem 0.375rem;
  border-radius: 6px;
}
.dark .legal-page .legal-toc a {
  color: oklch(0.85 0 0 / 1);
}
.legal-page .legal-toc a:hover {
  background: oklch(0.97 0 0);
  color: var(--foreground);
}
.dark .legal-page .legal-toc a:hover {
  background: oklch(0.22 0 0);
}
</style>
