import { expect, test } from '@playwright/test'

test('known article finishes client loading and renders its title/content', async ({ page }) => {
  await page.goto('/blog/2025-blog-public')
  await expect(page.getByText('加载中...')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /2025 Blog/ }).first()).toBeVisible()
  await expect(page.locator('article, main').first()).toBeVisible()
})

test('unknown article fails gracefully instead of crashing the app', async ({ page }) => {
  await page.goto('/blog/__e2e_missing_article__')
  await expect(page.locator('body')).toContainText(/文章不存在|Blog config not found|加载失败/)
  await expect(page.locator('body')).not.toContainText('Application error: a client-side exception has occurred')
})
