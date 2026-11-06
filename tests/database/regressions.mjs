import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const baseUrl = process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'
try {
	// Exercise the actual Windows CSS branch in Chromium, including a failed CDN load.
	const page = await browser.newPage({
		viewport: { width: 1366, height: 768 },
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
	})
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => route.abort())
	await page.goto(`${baseUrl}/toolbox/database`)
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles('.tmp/database/functional.sqlite')
	await page.getByRole('button', { name: 'SQL 查询' }).click()
	await page.getByText('高级编辑器加载失败，已切换为基础编辑器，仍可输入和执行 SQL。', { exact: true }).waitFor()
	const sql = `SELECT id AS first_column, ${Array.from({ length: 40 }, (_, i) => `'value-${i}' AS column_${i}`).join(', ')}, 'right-edge' AS last_column FROM records LIMIT 200;`
	await page.getByRole('textbox', { name: 'SQL 查询', exact: true }).fill(sql)
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	const grid = page.getByRole('grid', { name: '查询结果' })
	await grid.getByRole('columnheader').filter({ hasText: 'first_column' }).waitFor()
	assert.ok(await page.locator('html').evaluate(el => el.classList.contains('windows')))
	const geometry = await grid.evaluate(el => ({
		client: el.clientWidth,
		scroll: el.scrollWidth,
		scrollbar: getComputedStyle(el, '::-webkit-scrollbar').display,
		width: getComputedStyle(el).scrollbarWidth,
		height: el.offsetHeight - el.clientHeight
	}))
	assert.ok(geometry.scroll > geometry.client * 3, 'the result must have offscreen columns')
	assert.notEqual(geometry.scrollbar, 'none', 'Windows must not hide the horizontal scrollbar')
	assert.notEqual(geometry.width, 'none')
	const scrollbar = page.getByRole('slider', { name: '横向滚动查询结果' })
	const scrollBox = await scrollbar.boundingBox()
	assert.ok(scrollBox.height >= 14, 'the scrollbar must reserve visible space at the bottom')
	// Drag the persistent scrollbar thumb while still at the top of a 200-row result.
	const box = await grid.boundingBox()
	const thumbWidth = (geometry.client * geometry.client) / geometry.scroll
	await page.mouse.move(scrollBox.x + thumbWidth / 2, scrollBox.y + scrollBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(scrollBox.x + scrollBox.width - 2, scrollBox.y + scrollBox.height / 2, { steps: 12 })
	await page.mouse.up()
	await page.waitForFunction(() => {
		const grid = document.querySelector('[role=grid][aria-label=查询结果]')
		return grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 2
	})
	const header = grid.getByRole('columnheader').filter({ hasText: 'last_column' })
	const cell = grid.getByRole('gridcell', { name: 'right-edge', exact: true }).first()
	await header.waitFor()
	const headerBox = await header.boundingBox(),
		cellBox = await cell.boundingBox()
	assert.ok(headerBox.x >= box.x && headerBox.x + headerBox.width <= box.x + geometry.client + 1)
	assert.equal(headerBox.x, cellBox.x, 'headers must stay aligned with cells while scrolling')
	assert.equal(await grid.evaluate(el => el.scrollTop), 0, 'the bottom scrollbar must work before scrolling through the rows')
	await page.screenshot({ path: '.tmp/database/horizontal-scroll-windows.png' })
	await page.getByRole('button', { name: '打开表 records', exact: true }).click()
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await page.getByRole('textbox', { name: 'SQL 查询', exact: true }).fill('SELECT 42 AS answer')
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await grid.getByRole('gridcell', { name: '42', exact: true }).waitFor()
	assert.deepEqual(errors, [], 'failed editor loading and tab reopen must not raise an uncaught Event')
	await page.close()
	// The loader script may succeed while the editor module fails; this must also be handled.
	const modulePage = await browser.newPage()
	const moduleErrors = []
	modulePage.on('pageerror', error => moduleErrors.push(error.message))
	await modulePage.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => {
		const asset = new URL(route.request().url()).pathname.split('/min/')[1]
		if (asset === 'vs/editor/editor.main.js') return route.abort()
		return route.fulfill({ path: path.resolve('node_modules/monaco-editor/min', asset), headers: { 'access-control-allow-origin': '*' } })
	})
	await modulePage.goto(`${baseUrl}/toolbox/database`)
	await modulePage.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles('.tmp/database/functional.sqlite')
	await modulePage.getByRole('button', { name: 'SQL 查询' }).click()
	await modulePage.getByText('高级编辑器加载失败，已切换为基础编辑器，仍可输入和执行 SQL。', { exact: true }).waitFor()
	await modulePage.getByRole('textbox', { name: 'SQL 查询', exact: true }).fill('SELECT 43 AS answer')
	await modulePage.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await modulePage.getByRole('gridcell', { name: '43', exact: true }).waitFor()
	assert.deepEqual(moduleErrors, [])
	console.log('PASS: failed loader/module requests; SQL fallback and tab reopen; visible Windows scrollbar; drag to column 42; header alignment')
} finally {
	await browser.close()
}
