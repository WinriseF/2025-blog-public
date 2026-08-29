import { expect, test } from '@playwright/test'

test('repeated toolbox navigation does not accumulate fatal console/page errors', async ({ page }) => {
  const fatal: string[] = []
  page.on('pageerror', error => fatal.push(error.message))
  for (const route of ['/toolbox', '/toolbox/password', '/toolbox/zip', '/toolbox/ocr', '/toolbox/version-control', '/toolbox']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
  }
  expect(fatal).toEqual([])
})
