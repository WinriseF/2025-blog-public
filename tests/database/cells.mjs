import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
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
const base = process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
	const page = await context.newPage(),
		errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => {
		const asset = new URL(route.request().url()).pathname.split('/min/')[1]
		return route.fulfill({ path: path.resolve('node_modules/monaco-editor/min', asset), headers: { 'access-control-allow-origin': '*' } })
	})
	await page.addInitScript(() => sessionStorage.setItem('blog-time-theme', 'noon'))
	await page.goto(`${base}/toolbox/database`)
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
	await offline.goto(`${base}/toolbox/database`)
	await offline.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(fixture)
	await offline.locator('[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="4"]').dblclick()
	const fallback = offline.getByRole('textbox', { name: '单元格完整内容', exact: true })
	assert.equal(await fallback.inputValue(), expected[1])
	await offline.getByRole('button', { name: '复制原值', exact: true }).click()
	assert.equal(await offline.evaluate(() => navigator.clipboard.readText()), expected[1])
	assert.deepEqual(offlineErrors, [])
	console.log(
		'PASS: cell/row/range selection; native clipboard; long text and JSON fidelity; viewer/search/resize; virtual navigation; BLOB/NULL/empty/int64; compact toolbar; CDN fallback'
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
