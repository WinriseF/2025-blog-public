import { expect, test } from '@playwright/test'

test('File System Access API is visible to ZIP tool in Chromium secure localhost context', async ({ page }) => {
  await page.goto('/toolbox/zip')
  const supported = await page.evaluate(() => 'showDirectoryPicker' in window || 'showOpenFilePicker' in window)
  expect(supported).toBe(true)
})

test('WebCrypto required by public transfer is available', async ({ page }) => {
  await page.goto('/t')
  expect(await page.evaluate(() => Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues))).toBe(true)
})

test('version-control page does not crash when native Agent is absent', async ({ page }) => {
  await page.goto('/toolbox/version-control')
  await expect(page.locator('body')).not.toContainText('Application error: a client-side exception has occurred')
})
