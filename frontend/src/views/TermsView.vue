<script setup lang="ts">
defineOptions({ name: 'TermsView' })
import { onMounted, ref } from 'vue'
import Header from '@/components/Header.vue'
import LegalPage from '@/components/LegalPage.vue'

const html = ref('')

async function load() {
  try {
    const res = await fetch('/legal/terms.html')
    if (!res.ok) throw new Error('Not found')
    html.value = await res.text()
  } catch {
    html.value = `
      <p>These Terms of Service govern your use of DelphiMarkets. By accessing or using the site, you agree to these terms.</p>
      <h2>Use of Service</h2>
      <p>You must comply with applicable laws and use the service responsibly.</p>
      <h2>Disclaimers</h2>
      <p>No financial advice is provided. Markets carry risk. See the Risk Disclosure for details.</p>
    `
  }
}

onMounted(load)
</script>

<template>
  <Header />
  <LegalPage title="Terms of Service" :html="html" />
</template>
