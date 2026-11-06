import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
const output = path.resolve('.tmp/database')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { browser: browser.version(), layouts: [] }
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	// Serve the exact installed Monaco version so visual checks do not depend on CDN availability.
	await page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => {
		const asset = new URL(route.request().url()).pathname.split('/min/')[1]
		return route.fulfill({ path: path.resolve('node_modules/monaco-editor/min', asset), headers: { 'access-control-allow-origin': '*' } })
	})
	await page.addInitScript(() => sessionStorage.setItem('blog-time-theme', 'noon'))
	await page.goto(`${process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'}/toolbox/database`)
	const workspace = page.getByRole('region', { name: '数据库工作台' })
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(path.join(output, 'functional.sqlite'))
	await page.getByRole('button', { name: '打开表 records', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 1', exact: true }).waitFor()
	const grid = page.getByRole('grid', { name: '查询结果' })
	for (const size of [
		{ width: 1366, height: 768 },
		{ width: 1440, height: 900 },
		{ width: 1920, height: 1080 }
	]) {
		await page.setViewportSize(size)
		await page.waitForFunction(() => document.querySelector('[aria-label="数据库工作台"]').clientWidth === innerWidth)
		const bounds = await workspace.boundingBox()
		const table = await grid.boundingBox()
		assert.deepEqual(bounds, { x: 0, y: 0, ...size })
		assert.ok(table.height > size.height * 0.7, 'data grid must use the available window height')
		assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, 'the document must not scroll')
		await page.waitForFunction(() => {
			const el = document.querySelector('[role=grid][aria-label=查询结果]')
			return el.scrollWidth <= el.clientWidth
		})
		report.layouts.push({ ...size, grid: table })
	}
	await page.setViewportSize({ width: 1440, height: 900 })
	async function drag(locator, dx, dy) {
		const rect = await locator.boundingBox()
		const x = rect.x + rect.width / 2,
			y = rect.y + rect.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + dx, y + dy, { steps: 8 })
		await page.mouse.up()
	}
	const sidebar = page.getByRole('complementary', { name: '对象导航' })
	const oldWidth = (await sidebar.boundingBox()).width
	await drag(page.getByRole('separator', { name: '调整对象导航宽度' }), 48, 0)
	assert.equal((await sidebar.boundingBox()).width, oldWidth + 48)
	const column = grid.getByRole('columnheader').first()
	const oldColumnWidth = (await column.boundingBox()).width
	await drag(page.getByRole('separator', { name: '调整列 id 宽度', exact: true }), 50, 0)
	assert.equal((await column.boundingBox()).width, oldColumnWidth + 50)
	await page.getByRole('separator', { name: '调整列 id 宽度', exact: true }).dblclick()
	assert.equal(await page.locator('html').getAttribute('data-time-theme'), 'noon')
	await page.screenshot({ path: path.join(output, 'workspace-data-light.png') })
	await page.getByRole('button', { name: '结构', exact: true }).click()
	await page.getByText('CREATE TABLE records', { exact: false }).waitFor()
	await page.screenshot({ path: path.join(output, 'workspace-structure.png') })
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database'))
	const sql =
		'SELECT g.name AS group_name,\n       COUNT(*) AS record_count,\n       SUM(r.amount) AS total_amount\nFROM records AS r\nJOIN groups AS g ON r.grp = g.id\nGROUP BY g.id\nORDER BY total_amount DESC;'
	await page.evaluate(
		sql =>
			globalThis.monaco.editor
				.getModels()
				.find(model => model.uri.authority === 'database')
				.setValue(sql),
		sql
	)
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await grid.getByRole('columnheader').filter({ hasText: 'group_name' }).waitFor()
	const split = page.getByRole('separator', { name: '调整 SQL 编辑区高度' })
	const beforeSplit = (await split.boundingBox()).y
	await drag(split, 0, -45)
	assert.ok(Math.abs((await split.boundingBox()).y - beforeSplit + 45) < 2)
	await page.getByRole('button', { name: '打开表 records', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 1', exact: true }).waitFor()
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database'))
	assert.equal(
		await page.evaluate(() =>
			globalThis.monaco.editor
				.getModels()
				.find(model => model.uri.authority === 'database')
				.getValue()
		),
		sql
	)
	await grid.getByRole('columnheader').filter({ hasText: 'group_name' }).waitFor()
	await page.screenshot({ path: path.join(output, 'workspace-sql-light.png') })
	// Reload the existing explicit night-theme preference and verify the complete editor palette.
	await page.addInitScript(() => sessionStorage.setItem('blog-time-theme', 'night'))
	await page.reload()
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(path.join(output, 'functional.sqlite'))
	await page.getByRole('button', { name: '打开表 records', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 1', exact: true }).waitFor()
	assert.equal(await page.locator('html').getAttribute('data-time-theme'), 'night')
	await page.screenshot({ path: path.join(output, 'workspace-data-dark.png') })
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database'))
	await page.evaluate(
		sql =>
			globalThis.monaco.editor
				.getModels()
				.find(model => model.uri.authority === 'database')
				.setValue(sql),
		sql
	)
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await grid.getByRole('columnheader').filter({ hasText: 'group_name' }).waitFor()
	await page.waitForFunction(() => {
		const grid = document.querySelector('[role=grid][aria-label=查询结果]')
		const headers = grid.querySelectorAll('[role=columnheader]')
		return Math.abs(headers[headers.length - 1].getBoundingClientRect().right - grid.getBoundingClientRect().right) < 2
	})
	await page.screenshot({ path: path.join(output, 'workspace-sql-dark.png') })
	assert.deepEqual(errors, [])
	report.interactions = ['sidebar drag', 'column resize and reset', 'SQL split drag', 'table/SQL draft and result retention', 'light/dark Monaco']
	writeFileSync(path.join(output, 'layout-report.json'), JSON.stringify(report, null, 2))
	console.log('PASS', JSON.stringify(report))
} catch (error) {
	const page = browser.contexts()[0]?.pages()[0]
	if (page) {
		console.error((await page.locator('body').innerText()).slice(-3000))
		await page.screenshot({ path: path.join(output, 'layout-failure.png') })
	}
	throw error
} finally {
	await browser.close()
}
