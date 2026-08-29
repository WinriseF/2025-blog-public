import { expect, test } from '@playwright/test'

const routes = [
  '/', '/blog', '/toolbox', '/toolbox/password', '/toolbox/zip', '/toolbox/ocr', '/toolbox/compress',
  '/toolbox/codex-session', '/toolbox/version-control', '/toolbox/face-mask', '/calendar', '/world-clock', '/projects', '/about', '/t'
]

for (const route of routes) {
  test(`${route} renders without a fatal Next.js page error`, async ({ page }) => {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
    expect(response, `No navigation response for ${route}`).not.toBeNull()
    expect(response!.status(), `${route} returned ${response!.status()}`).toBeLessThan(400)
    await expect(page.locator('body')).not.toContainText('Application error: a client-side exception has occurred')
    await expect(page.locator('body')).not.toContainText('Internal Server Error')
  })
}
