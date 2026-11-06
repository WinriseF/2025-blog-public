import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chromium, baseUrl, serveLocalMonaco } from './browser-helpers.mjs'
const fixture = '.tmp/database/cells.sqlite'
assert.equal(spawnSync('python3', ['tests/database/make-cells-fixture.py']).status, 0)
const expected = JSON.parse(
	spawnSync(
		'python3',
		[
			'-c',
			'import sqlite3,json;print(json.dumps(sqlite3.connect(".tmp/database/cells.sqlite").execute("SELECT name,note,json_text FROM cells WHERE id=1").fetchone()))'
		],
		{ encoding: 'utf8' }
	).stdout
)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
	const page = await context.newPage(),
		errors = []
	page.on('pageerror', error => errors.push(error.message))
	await serveLocalMonaco(page)
	// Hold one query request so the menu/result transition is deterministic.
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage
		Worker.prototype.postMessage = function (message, ...args) {
			if (message.type === 'query' && globalThis.holdDatabaseQuery) {
				globalThis.holdDatabaseQuery = false
				globalThis.releaseDatabaseQuery = () => post.call(this, message, ...args)
			} else post.call(this, message, ...args)
		}
	})
	await page.addInitScript(() => sessionStorage.setItem('blog-time-theme', 'noon'))
	await page.goto(`${baseUrl}/toolbox/database`)
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(fixture)
	const grid = page.getByRole('grid', { name: '查询结果' })
	const cell = (row, column) => grid.locator(`[role=row][aria-rowindex="${row + 1}"] [role=gridcell][aria-colindex="${column + 1}"]`)
	const readClipboard = () => page.evaluate(() => navigator.clipboard.readText())
	const shortcutCopy = async () => {
		await page.keyboard.press('ControlOrMeta+c')
		return readClipboard()
	}
	await cell(1, 2).click()
	assert.equal(await grid.locator('[aria-selected=true]').count(), 1)
	assert.equal(await shortcutCopy(), expected[0])
	await page.keyboard.press('ArrowDown')
	assert.equal(await shortcutCopy(), 'row-2')
	await page.keyboard.press('ArrowUp')
	await page.keyboard.press('Shift+ArrowDown')
	assert.equal(await grid.locator('[aria-selected=true]').count(), 2)
	assert.equal(await shortcutCopy(), 'row-1\nrow-2')
	await cell(1, 1).click()
	await cell(2, 2).click({ modifiers: ['Shift'] })
	assert.equal(await shortcutCopy(), '1\trow-1\n2\trow-2')
	// Pointer drag creates the same rectangle, rather than a browser text selection.
	const from = await cell(1, 1).boundingBox(),
		to = await cell(3, 2).boundingBox()
	await page.mouse.move(from.x + from.width / 2, from.y + 14)
	await page.mouse.down()
	await page.mouse.move(to.x + to.width / 2, to.y + 14, { steps: 10 })
	await page.mouse.up()
	assert.equal(await shortcutCopy(), '1\trow-1\n2\trow-2\n3\trow-3')
	// Drag beyond the viewport: virtual rows enter the selection and scrolling stops on release.
	const area = await grid.boundingBox()
	await page.mouse.move(from.x + from.width / 2, from.y + 14)
	await page.mouse.down()
	await page.mouse.move(from.x + from.width / 2, area.y + area.height + 8, { steps: 8 })
	await page.waitForFunction(() => document.querySelector('[role=grid][aria-label=查询结果]').scrollTop > 100)
	await page.mouse.up()
	const stoppedAt = await grid.evaluate(el => el.scrollTop)
	await page.waitForTimeout(80)
	assert.equal(await grid.evaluate(el => el.scrollTop), stoppedAt)
	await grid.evaluate(el => (el.scrollTop = 0))
	await grid.getByRole('rowheader', { name: '选择第 1 行', exact: true }).click()
	assert.equal(await grid.locator('[aria-selected=true]').count(), 8)
	// Switching from a cell anchor to whole rows must include every column.
	await cell(1, 2).click()
	await grid.getByRole('rowheader', { name: '选择第 3 行', exact: true }).click({ modifiers: ['Shift'] })
	assert.equal(await grid.locator('[aria-selected=true]').count(), 24)
	assert.ok((await shortcutCopy()).startsWith('1\trow-1\t'))
	await cell(3, 2).click()
	await page.keyboard.down('Shift')
	const rowHeader = await grid.getByRole('rowheader', { name: '选择第 2 行', exact: true }).boundingBox()
	await page.mouse.move(rowHeader.x + 20, rowHeader.y + 14)
	await page.mouse.down()
	await page.mouse.move(rowHeader.x + 20, rowHeader.y - 14, { steps: 5 })
	await page.mouse.up()
	await page.keyboard.up('Shift')
	assert.equal(await grid.locator('[aria-selected=true]').count(), 24)
	assert.ok((await shortcutCopy()).startsWith('1\trow-1\t'))
	await cell(1, 2).click({ button: 'right' })
	await page.getByRole('menuitem', { name: '复制值', exact: true }).click()
	assert.equal(await readClipboard(), 'row-1')
	await cell(1, 2).click({ button: 'right' })
	await page.getByRole('textbox', { name: '搜索表', exact: true }).click()
	assert.ok(
		await page.getByRole('textbox', { name: '搜索表', exact: true }).evaluate(el => el === document.activeElement),
		'dismissing the menu must preserve the clicked control focus'
	)
	// Long values open without a new SQLite operation and are copied verbatim.
	await cell(1, 3).dblclick()
	const viewer = page.getByRole('complementary', { name: '单元格查看器' })
	await viewer.waitFor()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database-value'))
	const modelValue = () =>
		page.evaluate(() =>
			globalThis.monaco.editor
				.getModels()
				.find(model => model.uri.authority === 'database-value')
				.getValue()
		)
	assert.equal(await modelValue(), expected[1])
	await viewer.getByRole('button', { name: '复制原值', exact: true }).click()
	assert.equal(await readClipboard(), expected[1])
	await viewer.getByRole('textbox', { name: '查找单元格内容' }).fill('FIND-ME-END')
	await viewer.getByRole('button', { name: '查找下一个' }).click()
	assert.equal(await shortcutCopy(), 'FIND-ME-END', 'copying a text fragment must not copy the entire selected grid cell')
	await page.keyboard.type('should-not-edit')
	assert.equal(await modelValue(), expected[1], 'the inspector must remain read-only')
	await viewer.getByRole('button', { name: '自动换行' }).click()
	assert.equal(await viewer.getByRole('button', { name: '自动换行' }).getAttribute('aria-pressed'), 'false')
	// Resizable viewer; source selection and contents survive the resize.
	const divider = page.getByRole('separator', { name: '调整单元格查看器宽度' }),
		before = await viewer.boundingBox(),
		handle = await divider.boundingBox()
	await page.mouse.move(handle.x, handle.y + 60)
	await page.mouse.down()
	await page.mouse.move(handle.x - 60, handle.y + 60, { steps: 8 })
	await page.mouse.up()
	assert.ok((await viewer.boundingBox()).width > before.width + 50)
	await page.getByRole('button', { name: '关闭单元格查看器' }).click()
	await grid.evaluate(el => (el.scrollLeft = 0))
	await cell(1, 4).dblclick()
	await viewer.getByRole('button', { name: '格式化 JSON' }).click()
	assert.ok((await modelValue()).includes('9223372036854775807'))
	assert.ok((await modelValue()).includes('1.0000'))
	assert.ok((await modelValue()).includes('\n'))
	await viewer.getByRole('button', { name: '复制原值', exact: true }).click()
	assert.equal(await readClipboard(), expected[2])
	await viewer.getByRole('button', { name: '显示原文' }).click()
	assert.equal(await modelValue(), expected[2])
	await viewer.getByRole('button', { name: '格式化 JSON' }).click()
	await page.screenshot({ path: '.tmp/database/cell-viewer-light.png' })
	await page.getByRole('button', { name: '关闭单元格查看器' }).click()
	await grid.evaluate(el => (el.scrollLeft = el.scrollWidth))
	await cell(1, 7).click()
	assert.equal(await shortcutCopy(), '9223372036854775807')
	await cell(1, 5).click()
	assert.equal(await shortcutCopy(), '')
	await cell(1, 6).click()
	assert.equal(await shortcutCopy(), 'NULL')
	await cell(1, 8).dblclick()
	await viewer.getByText('仅显示前 32 字节预览，未加载完整二进制内容。', { exact: true }).waitFor()
	await viewer.getByRole('button', { name: '复制预览' }).click()
	assert.ok((await readClipboard()).includes('32 bytes preview'))
	await page.getByRole('button', { name: '关闭单元格查看器' }).click()
	await grid.focus()
	await page.keyboard.press('ControlOrMeta+End')
	await page.keyboard.press('Home')
	await page.keyboard.press('ArrowRight')
	assert.equal(await shortcutCopy(), 'row-200', 'keyboard navigation must cross virtualized rows and columns')
	await page.getByRole('button', { name: '下一页', exact: true }).click()
	await grid.getByRole('gridcell', { name: 'row-201', exact: true }).waitFor()
	assert.equal(await grid.locator('[aria-selected=true]').count(), 0)
	assert.equal(await page.getByRole('button', { name: 'SQL 查询', exact: true }).count(), 1)
	assert.equal(await page.getByText('只读工作区', { exact: true }).count(), 0)
	assert.equal(await page.getByText('本地只读', { exact: true }).count(), 1)
	assert.equal(await page.getByRole('button', { name: '表结构', exact: true }).count(), 0)
	// A failed metadata read must not leave the count action pointing at the previous table.
	await page.getByRole('button', { name: '打开视图 broken_view', exact: true }).click()
	const alert = page.getByRole('region', { name: '数据库工作台' }).getByRole('alert')
	await alert.filter({ hasText: 'missing_table' }).waitFor()
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await alert.filter({ hasText: 'missing_table' }).waitFor()
	assert.equal(await page.getByLabel('行数统计结果', { exact: true }).count(), 0)
	// SQL failures preserve visible rows but invalidate the old paging cursor.
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database'))
	const run = async sql => {
		await page.evaluate(
			sql =>
				globalThis.monaco.editor
					.getModels()
					.find(model => model.uri.authority === 'database')
					.setValue(sql),
			sql
		)
		await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	}
	const idle = () => page.waitForFunction(() => document.querySelector('button[aria-label="取消"]').disabled)
	const more = page.getByRole('button', { name: '加载更多', exact: true })
	await run('SELECT id, name FROM cells')
	await idle()
	assert.equal(await more.isEnabled(), true)
	await run('SELECT * FROM missing_table')
	await alert.filter({ hasText: 'missing_table' }).waitFor()
	assert.equal(await more.isEnabled(), false)
	assert.equal(await grid.getAttribute('aria-rowcount'), '201')
	await run('SELECT CASE WHEN id > 201 THEN abs(-9223372036854775808) ELSE id END AS id FROM cells')
	await idle()
	assert.equal(await more.isEnabled(), true)
	await more.click()
	await alert.filter({ hasText: 'integer overflow' }).waitFor()
	assert.equal(await more.isEnabled(), false)
	assert.equal(await grid.getAttribute('aria-rowcount'), '201')
	await run('SELECT id, name FROM cells')
	await idle()
	await more.click()
	await idle()
	assert.equal(await grid.getAttribute('aria-rowcount'), '241')
	assert.equal(await more.isEnabled(), false)
	// Replace results while an old menu is open: same size, fewer rows, and empty.
	for (const sql of ['SELECT id, name FROM cells ORDER BY id DESC', 'SELECT 42 AS answer', 'SELECT id FROM cells WHERE 0']) {
		await run('SELECT id, name FROM cells')
		await idle()
		await page.evaluate(() => (globalThis.holdDatabaseQuery = true))
		await run(sql)
		await cell(3, 2).click({ button: 'right' })
		await page.getByRole('menu', { name: '单元格操作' }).waitFor()
		await page.evaluate(() => globalThis.releaseDatabaseQuery())
		await idle()
		assert.equal(await page.getByRole('menu', { name: '单元格操作' }).count(), 0)
		assert.equal(await grid.count(), 1)
		assert.deepEqual(errors, [])
	}
	// Load the dark palette through the real theme preference.
	await page.addInitScript(() => sessionStorage.setItem('blog-time-theme', 'night'))
	await page.reload()
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(fixture)
	await cell(1, 4).dblclick()
	await viewer.getByRole('button', { name: '格式化 JSON' }).click()
	await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.uri.authority === 'database-value'))
	await page.screenshot({ path: '.tmp/database/cell-viewer-dark.png' })
	assert.deepEqual(errors, [])
	// Existing CDN fallback remains selectable, searchable and copyable.
	const offline = await context.newPage(),
		offlineErrors = []
	offline.on('pageerror', error => offlineErrors.push(error.message))
	await offline.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => route.abort())
	await offline.goto(`${baseUrl}/toolbox/database`)
	await offline.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(fixture)
	await offline.locator('[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="4"]').dblclick()
	const fallback = offline.getByRole('textbox', { name: '单元格完整内容', exact: true })
	assert.equal(await fallback.inputValue(), expected[1])
	await offline.getByRole('button', { name: '复制原值', exact: true }).click()
	assert.equal(await offline.evaluate(() => navigator.clipboard.readText()), expected[1])
	assert.deepEqual(offlineErrors, [])
	console.log(
		'PASS: cell/row/range selection; Shift whole-row click/drag; stale-menu result replacement; query/paging failure recovery; native clipboard; long text and JSON fidelity; viewer/search/resize; virtual navigation; BLOB/NULL/empty/int64; compact toolbar; CDN fallback'
	)
} catch (error) {
	const page = browser.contexts()[0]?.pages()[0]
	if (page) {
		await page.screenshot({ path: '.tmp/database/cells-failure.png' })
		console.error((await page.locator('body').innerText()).slice(-1500))
	}
	throw error
} finally {
	await browser.close()
}
