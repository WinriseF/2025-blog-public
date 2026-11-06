import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createReadStream, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
const file = process.env.DATABASE_VIEW_FILE
assert.ok(file, 'Set DATABASE_VIEW_FILE to a local SQLite database for this opt-in view regression test')
const view = process.env.DATABASE_VIEW_NAME || 'image_coverage'
const quoted = '"' + view.replaceAll('"', '""') + '"'
const sql = `SELECT * FROM ${quoted} LIMIT 200 OFFSET 0`
async function hash() {
	const digest = createHash('sha256')
	for await (const chunk of createReadStream(file)) digest.update(chunk)
	return digest.digest('hex')
}
const original = await hash()
const expected = spawnSync(
	'python3',
	[
		'-c',
		'import sqlite3,json,sys,pathlib;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro&immutable=1",uri=True);print(json.dumps(c.execute(sys.argv[2]).fetchall()))',
		file,
		sql
	],
	{ encoding: 'utf8', timeout: 120_000 }
)
assert.equal(expected.status, 0, expected.stderr)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	let workerUrl
	page.on('worker', worker => {
		if (!worker.url().startsWith('blob:')) workerUrl = worker.url()
	})
	await page.goto(`${process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'}/toolbox/database`)
	await page.getByLabel('选择 SQLite 文件', { exact: true }).setInputFiles(file)
	const button = page.getByRole('button', { name: `打开视图 ${view}`, exact: true })
	await button.click()
	await page.getByRole('button', { name: '停止读取', exact: true }).waitFor()
	await page.getByRole('button', { name: '结构', exact: true }).click()
	await page.getByText(`CREATE VIEW ${view}`, { exact: false }).waitFor()
	await page.getByRole('button', { name: '取消', exact: true }).click()
	await page.getByText('查询已取消。', { exact: true }).waitFor()
	const started = performance.now()
	await button.click()
	await page.getByRole('grid', { name: '查询结果' }).getByRole('gridcell').first().waitFor({ timeout: 120_000 })
	const uiMs = performance.now() - started
	assert.ok(uiMs < 60_000, 'the supplied view should no longer hit the old 120-second timeout')
	// Compare the actual Worker result with native SQLite; do not expose data in the report.
	await page.getByRole('button', { name: '关闭数据库', exact: true }).click()
	await page.evaluate(() => {
		const input = document.createElement('input')
		input.type = 'file'
		input.id = 'view-fixture'
		document.body.append(input)
	})
	await page.locator('#view-fixture').setInputFiles(file)
	const result = await page.evaluate(
		async ({ workerUrl, view }) => {
			const worker = new Worker(workerUrl)
			let sequence = 0
			const pending = new Map()
			worker.onmessage = event => {
				const entry = pending.get(event.data.id)
				pending.delete(event.data.id)
				event.data.ok ? entry.resolve(event.data.data) : entry.reject(new Error(event.data.error))
			}
			const call = command =>
				new Promise((resolve, reject) => {
					const id = ++sequence
					pending.set(id, { resolve, reject })
					worker.postMessage({ ...command, id })
				})
			try {
				await call({ type: 'open', file: document.querySelector('#view-fixture').files[0], session: `view-regression-${crypto.randomUUID()}` })
				const started = performance.now()
				const result = await call({ type: 'table', query: { table: view, offset: 0 } })
				return { ...result, wallMs: performance.now() - started }
			} finally {
				await call({ type: 'close' })
				worker.terminate()
			}
		},
		{ workerUrl, view }
	)
	assert.deepEqual(result.rows, JSON.parse(expected.stdout))
	assert.equal(await hash(), original, 'the source database must remain byte-identical')
	assert.deepEqual(errors, [])
	const report = {
		browser: browser.version(),
		view,
		uiMs,
		queryMs: result.wallMs,
		rows: result.rows.length,
		stats: result.stats,
		nativeMatches: true,
		sourceUnchanged: true
	}
	writeFileSync('.tmp/database/views-verified.json', JSON.stringify(report, null, 2))
	console.log('PASS', JSON.stringify(report))
} finally {
	await browser.close()
}
