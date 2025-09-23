<script setup lang="ts">
defineOptions({ name: 'PrivacyView' })
import { onMounted, ref } from 'vue'
import Header from '@/components/Header.vue'
import LegalPage from '@/components/LegalPage.vue'

const html = ref('')

async function load() {
  try {
    const res = await fetch('/legal/privacy.html')
    if (!res.ok) throw new Error('Not found')
    html.value = await res.text()
  } catch {
    html.value = `
      <p>This Privacy Policy explains how DelphiMarkets processes information.</p>
      <h2>Data We Collect</h2>
      <p>We may process wallet addresses and on-chain data necessary to provide the service.</p>
      <h2>Your Choices</h2>
      <p>You may disconnect your wallet at any time. Contact us for privacy inquiries.</p>
    `
  }
}

onMounted(load)
</script>

<template>
  <Header />
  <LegalPage title="Privacy Policy" :html="html" />
</template>
