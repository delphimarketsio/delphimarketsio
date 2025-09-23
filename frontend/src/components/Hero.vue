<script setup lang="ts">
import { useLogger } from 'vue-logger-plugin'
// Hero component for landing page
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const log = useLogger()
const selectBetOption = (option: string) => {
  log.info(`Selected ${option} for World Cup bet`)
  // Here you would navigate to a bet placement page or open a modal
}
</script>

<template>
  <section
    class="bg-gradient-to-b from-[#3B82F6]/10 via-white to-[#60A5FA]/10 py-16 dark:from-[#3B82F6]/20 dark:via-gray-900 dark:to-[#60A5FA]/20"
  >
    <div class="container mx-auto px-4">
      <div class="flex flex-col items-center md:flex-row md:justify-between">
        <div class="mb-10 max-w-2xl md:mb-0 md:pr-8">
          <h1
            class="mb-4 text-4xl font-extrabold leading-tight text-gray-900 md:text-5xl dark:text-white"
          >
            Predict Smarter with
            <span class="bg-gradient-to-r from-[#3B82F6] to-[#60A5FA] bg-clip-text text-transparent"
              >Solana</span
            >
          </h1>
          <p class="mb-6 text-lg text-gray-600 dark:text-gray-300">
            Join thousands of users trading on outcomes across sports, politics, finance, and more.
            Secure, transparent, and powered by Solana smart contracts.
          </p>
          <div class="flex flex-col space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
            <Button variant="default" class="bg-[#3B82F6] hover:bg-[#3B82F6]/90">
              Explore Markets
            </Button>
            <Button variant="secondary" class="bg-[#60A5FA]/80 hover:bg-[#60A5FA]/90 text-gray-900">
              How It Works
            </Button>
          </div>
          <div class="mt-8 flex items-center">
            <div class="flex -space-x-2">
              <img
                class="h-10 w-10 rounded-full border-2 border-white dark:border-gray-800"
                src="https://randomuser.me/api/portraits/men/32.jpg"
                alt="User"
              />
              <img
                class="h-10 w-10 rounded-full border-2 border-white dark:border-gray-800"
                src="https://randomuser.me/api/portraits/women/44.jpg"
                alt="User"
              />
              <img
                class="h-10 w-10 rounded-full border-2 border-white dark:border-gray-800"
                src="https://randomuser.me/api/portraits/men/46.jpg"
                alt="User"
              />
            </div>
            <p class="ml-4 text-sm text-gray-600 dark:text-gray-300">
              <span class="font-semibold">8,500+</span> users already joined
            </p>
          </div>
        </div>
        <div class="w-full max-w-md">
          <Card
            class="p-6 shadow-xl border border-[#3B82F6]/10 dark:border-[#3B82F6]/20 bg-white/80 backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="mb-4 text-center">
              <span
                class="inline-block rounded-full bg-[#3B82F6]/10 px-3 py-1 text-xs font-semibold text-[#3B82F6] dark:bg-[#3B82F6]/20 dark:text-[#3B82F6]/90"
              >
                Featured Market
              </span>
            </div>

            <CardHeader class="p-0 text-center">
              <CardTitle class="text-xl text-gray-800 dark:text-white">
                FIFA World Cup 2026
              </CardTitle>
              <CardDescription class="text-gray-600 dark:text-gray-300">
                Will Brazil win the World Cup 2026?
              </CardDescription>
            </CardHeader>

            <CardContent class="mb-4 p-0 pt-4 space-y-2">
              <div class="mb-3 flex gap-2">
                <Button
                  variant="default"
                  class="flex-1 bg-[#3B82F6] hover:bg-[#3B82F6]/90"
                  @click="selectBetOption('Yes')"
                >
                  Yes
                </Button>
                <Button
                  variant="outline"
                  class="flex-1 border-[#3B82F6]/30 text-[#3B82F6] hover:bg-[#3B82F6]/10 dark:border-[#60A5FA]/30 dark:text-[#60A5FA]"
                  @click="selectBetOption('No')"
                >
                  No
                </Button>
              </div>

              <div class="pt-2">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm text-gray-500 dark:text-gray-400">Pool Size</span>
                  <span class="font-semibold text-[#3B82F6] dark:text-[#3B82F6]/90"
                    >345,000 SOL</span
                  >
                </div>
                <div class="mb-0 flex items-center justify-between">
                  <span class="text-sm text-gray-500 dark:text-gray-400">Ends on</span>
                  <span class="font-semibold text-gray-800 dark:text-white">June 1, 2026</span>
                </div>
              </div>
            </CardContent>

            <CardFooter class="p-0 pt-4">
              <Button variant="default" class="w-full bg-[#3B82F6] hover:bg-[#3B82F6]/90">
                Make a Prediction
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  </section>
</template>
