import { test, expect } from '@playwright/test'

// TODO: Add e2e tests with playwright

// See here how to get started:
// https://playwright.dev/docs/intro
test('visits the app root url', async ({ page }) => {
  await page.goto('/')
  expect(true).toBe(true)
})
