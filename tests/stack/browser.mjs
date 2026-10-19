import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { createRequire } from 'node:module'
import { startPocketBase, stopProcess } from './pocketbase-fixture.mjs'
import { checkScale } from './browser-scale.mjs'
import { checkFeatures } from './browser-features.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const production = process.env.INKSTACK_BROWSER_PRODUCTION === '1'
const output = '/workspace/.tmp/stack-browser'
mkdirSync(output, { recursive: true })
const fixture = await startPocketBase(process.env.INKSTACK_TEST_ARCHIVE)
let server, browser, page
let passphrase = 'Browser encryption passphrase 2026'
try {
	server = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(production ? ['start'] : ['dev', '--turbopack']), '-p', '2026', '-H', '127.0.0.1'], {
		env: { ...process.env, NEXT_PUBLIC_POCKETBASE_URL: fixture.url }, stdio: ['ignore', openSync(output + '/next.log', 'w'), 'pipe']
	})
	server.stderr.on('data', chunk => process.stderr.write(chunk))
	for (let i = 0; i < 120; i++) {
		if (await fetch('http://127.0.0.1:2026/home').then(r => r.ok).catch(() => false)) break
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	browser = await chromium.launch({ headless: true })
	page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	page.setDefaultTimeout(20000)
	if (production) {
		// Exercise the built client against the disposable backend, never real users.
		await page.route(/\/api\/(?:stack\/v1|collections\/users)(?:\/|\?)/, async route => {
			const url = new URL(route.request().url())
			const response = await route.fetch({ url: fixture.url + url.pathname + url.search })
			await route.fulfill({ response })
		})
	}
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated/i.test(message.text())) errors.push(message.text()) })
	await page.goto('http://127.0.0.1:2026/')
	await page.locator('a[href="/home"]').first().click()
	await page.locator('input[name=email]').fill(fixture.email)
	await page.locator('input[name=password]').fill(fixture.password)
	await page.locator('form').getByRole('button', { name: '登录', exact: true }).click()
	await page.locator('input[name=encryption-passphrase]').fill(passphrase)
	await page.getByPlaceholder('再次输入加密口令').fill(passphrase)
	await page.getByRole('button', { name: '生成恢复密钥' }).click()
	await page.getByRole('checkbox').check()
	await page.getByRole('button', { name: '开启墨栈' }).click()
	await page.getByRole('button', { name: '新建笔记', exact: true }).first().click()
	await page.getByLabel('笔记标题', { exact: true }).fill('Docker 浏览器验收')
	await page.getByLabel('笔记正文', { exact: true }).fill('中文 Markdown **加密保存**\n\n```go\nfmt.Println("InkStack")\n```')
	await page.waitForTimeout(2500)
	await page.getByRole('button', { name: '锁定空间', exact: true }).first().click()
	const unlock = async () => {
		await page.locator('input[name=encryption-passphrase]').fill(passphrase)
		await page.getByRole('button', { name: '解锁空间' }).click()
		await page.getByText('Docker 浏览器验收', { exact: true }).click()
		assert.match(await page.getByLabel('笔记正文', { exact: true }).inputValue(), /加密保存/)
	}
	await unlock()
	passphrase = await checkFeatures(page, fixture, passphrase)
	for (const theme of ['dawn', 'noon', 'sunset', 'night']) {
		await page.evaluate(value => sessionStorage.setItem('blog-time-theme', value), theme)
		await page.reload(); await unlock()
		assert.equal(await page.locator('html').getAttribute('data-time-theme'), theme)
		await page.screenshot({ path: `${output}/${theme}.png` })
	}
	await page.setViewportSize({ width: 390, height: 844 })
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
	await page.screenshot({ path: `${output}/mobile.png` })
	await page.route('**/api/stack/v1/items/**', route => route.request().method() === 'PUT' ? route.abort() : route.fallback())
	await page.getByLabel('笔记正文', { exact: true }).fill('未保存的离线草稿')
	await page.waitForTimeout(1500)
	let guarded = false
	page.once('dialog', async dialog => { guarded = dialog.type() === 'beforeunload'; await dialog.dismiss() })
	await page.goBack({ timeout: 3000 }).catch(() => {})
	assert.equal(guarded, true)
	assert.equal(await page.getByLabel('笔记正文', { exact: true }).inputValue(), '未保存的离线草稿')
	await page.unroute('**/api/stack/v1/items/**')
	await page.getByRole('button', { name: '重试', exact: true }).click()
	await page.getByRole('button', { name: '已加密保存', exact: true }).waitFor()
	if (process.env.INKSTACK_SCALE === '1') await checkScale(page, fixture, passphrase, output)
	assert.deepEqual(errors, [], 'Unexpected browser errors')
	console.log('PASS: login, setup, encrypted save/unlock, four themes, mobile width, offline unload protection')
} catch (error) {
	await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {})
	throw error
} finally {
	await browser?.close(); await stopProcess(server); await fixture.close()
}
