<script setup lang="ts">
defineOptions({ name: 'RiskView' })
import { onMounted, ref } from 'vue'
import Header from '@/components/Header.vue'
import LegalPage from '@/components/LegalPage.vue'

const html = ref('')

async function load() {
  try {
    const res = await fetch('/legal/risk.html')
    if (!res.ok) throw new Error('Not found')
    html.value = await res.text()
  } catch {
    html.value = `
      <p>Markets involve significant risks including loss of principal.</p>
      <h2>Market Risk</h2>
      <p>Outcomes are uncertain and prices can be volatile.</p>
      <h2>Technology Risk</h2>
      <p>On-chain operations can fail or be delayed. Smart contracts may have defects.</p>
    `
  }
}

onMounted(load)
</script>

<template>
  <Header />
  <LegalPage title="Risk Disclosure" :html="html" />
</template>
