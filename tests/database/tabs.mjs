import assert from 'node:assert/strict'
import { chromium, baseUrl } from './browser-helpers.mjs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1000, height: 768 } })
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => route.abort())
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage
		globalThis.databaseRequests = []
		Worker.prototype.postMessage = function (message, ...args) {
			globalThis.databaseRequests.push(message.type)
			if (message.type === 'query' && globalThis.holdQuery) {
				globalThis.holdQuery = false
				globalThis.releaseQuery = () => post.call(this, message, ...args)
			} else post.call(this, message, ...args)
		}
	})
	await page.goto(`${baseUrl}/toolbox/database`)
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles('.tmp/database/functional.sqlite')
	const nav = page.getByRole('navigation', { name: '数据库视图' })
	const tab = name => nav.getByRole('button', { name: `标签 ${name}`, exact: true })
	const open = name => page.getByRole('button', { name: `打开表 ${name}`, exact: true }).click()
	const idle = () => page.waitForFunction(() => !document.querySelector('[data-busy="true"]'))
	const grid = page.getByRole('grid', { name: '查询结果' })
	await idle()
	await open('records')
	await idle()
	await page.getByRole('button', { name: '下一页', exact: true }).click()
	await idle()
	await page.getByRole('button', { name: '筛选', exact: true }).click()
	await page.getByLabel('筛选列').selectOption('name')
	await page.getByLabel('筛选值').fill('记录')
	await page.getByRole('button', { name: '应用筛选', exact: true }).click()
	await idle()
	await page.getByRole('button', { name: '下一页', exact: true }).click()
	await idle()
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await idle()
	await grid.evaluate(el => {
		el.scrollTop = 700
		el.scrollLeft = 50
	})
	await page.waitForFunction(() => document.querySelector('[role=grid]').scrollTop === 700)
	await open('special')
	await idle()
	const requests = await page.evaluate(() => globalThis.databaseRequests.length)
	await tab('records').click()
	await page.waitForFunction(() => document.querySelector('[role=grid]').scrollTop === 700)
	assert.equal(await page.evaluate(() => globalThis.databaseRequests.length), requests, 'cached switching must not read SQLite')
	assert.equal(await page.getByLabel('筛选值').inputValue(), '记录')
	assert.equal(await page.getByLabel('行数统计结果').innerText(), '匹配 601 行')
	assert.ok((await page.locator('body').innerText()).includes('201–400 行'))
	await open('records')
	assert.equal(await tab('records').count(), 1)
	await page.getByRole('button', { name: '结构', exact: true }).click()
	await tab('special').click()
	await tab('records').click()
	await page.getByText('CREATE TABLE records', { exact: false }).waitFor()
	await page.getByRole('button', { name: '数据', exact: true }).click()
	await page.waitForFunction(() => document.querySelector('[role=grid]').scrollTop === 700)
	// Query tabs retain independent text and results, and one live cursor.
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	const editor = page.getByRole('textbox', { name: 'SQL 查询', exact: true })
	const run = async sql => {
		await editor.fill(sql)
		await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
		await idle()
	}
	await run('SELECT id FROM records')
	assert.equal(await page.getByRole('button', { name: '加载更多', exact: true }).isEnabled(), true)
	await tab('records').click()
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	assert.equal(await page.getByRole('button', { name: '加载更多', exact: true }).isEnabled(), true)
	await page.getByRole('button', { name: '新建 SQL 查询', exact: true }).click()
	await run('SELECT 42 AS answer')
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	assert.equal(await editor.inputValue(), 'SELECT id FROM records')
	assert.equal(await grid.getAttribute('aria-rowcount'), '201')
	assert.equal(await page.getByRole('button', { name: '加载更多', exact: true }).isEnabled(), false)
	// A result arriving after switching tabs must update its owner only.
	await editor.fill('SELECT 73 AS owner_answer')
	await page.evaluate(() => (globalThis.holdQuery = true))
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await tab('records').click()
	await page.evaluate(() => globalThis.releaseQuery())
	await idle()
	assert.ok((await page.locator('body').innerText()).includes('201–400 行'))
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await grid.getByRole('gridcell', { name: '73', exact: true }).waitFor()
	// Closing a running document cancels it and leaves other documents usable.
	await editor.fill('SELECT 99')
	await page.evaluate(() => (globalThis.holdQuery = true))
	await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	await page.getByRole('button', { name: '关闭标签 SQL 查询', exact: true }).click()
	await page.getByRole('button', { name: 'SQL 查询 2', exact: true }).click()
	await grid.getByRole('gridcell', { name: '42', exact: true }).waitFor()
	await run('SELECT 43 AS answer')
	await grid.getByRole('gridcell', { name: '43', exact: true }).waitFor()
	// Closing an inactive tab keeps the active one; overflow stays horizontal.
	await page.getByRole('button', { name: '关闭标签 special', exact: true }).click()
	assert.equal(await page.getByRole('button', { name: 'SQL 查询 2', exact: true }).getAttribute('aria-pressed'), 'true')
	for (let i = 0; i < 9; i++) await page.getByRole('button', { name: '新建 SQL 查询', exact: true }).click()
	const overflow = await nav
		.locator('div')
		.first()
		.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, left: el.scrollLeft }))
	assert.ok(overflow.scroll > overflow.width && overflow.left > 0)
	await page.screenshot({ path: '.tmp/database/tabs-overflow.png' })
	while (await nav.getByRole('button', { name: /^关闭标签 / }).count())
		await nav
			.getByRole('button', { name: /^关闭标签 / })
			.last()
			.click()
	await page.getByText('从左侧打开表或视图，或新建 SQL 查询。', { exact: true }).waitFor()
	await open('records')
	await idle()
	assert.equal(await grid.evaluate(el => el.scrollTop), 0)
	assert.ok((await page.locator('body').innerText()).includes('1–200 行'))
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles('.tmp/database/cells.sqlite')
	await idle()
	assert.equal(await tab('records').count(), 0)
	await tab('cells').waitFor()
	await grid.evaluate(el => {
		el.scrollTop = 280
		el.scrollLeft = 200
	})
	await page.waitForFunction(() => document.querySelector('[role=grid]').scrollLeft === 200)
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await tab('cells').click()
	await page.waitForFunction(() => {
		const el = document.querySelector('[role=grid]')
		return el.scrollTop === 280 && el.scrollLeft === 200
	})
	assert.deepEqual(errors, [])
	console.log(
		'PASS: independent tabs, filters/counts/pages/scroll, structure mode, duplicate activation, SQL drafts/results/cursor, switching during query, closing busy/inactive/all tabs, overflow, file replacement'
	)
} finally {
	await browser.close()
}
