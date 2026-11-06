import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Use an installed Playwright or an explicit external installation; no production dependency.
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
const output = path.resolve('.tmp/database')
mkdirSync(output, { recursive: true })
const fixture = path.join(output, 'functional.sqlite')
const generated = spawnSync('python3', ['tests/database/make-fixture.py', '--output', fixture], { encoding: 'utf8' })
assert.equal(generated.status, 0, generated.stderr)
const originalFile = readFileSync(fixture)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { browser: browser.version(), platform: process.platform, functional: [], large: [] }
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	let workerUrl
	page.on('worker', worker => {
		if (!worker.url().startsWith('blob:')) workerUrl = worker.url()
	})
	await page.goto(`${process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'}/toolbox/database`)
	await page.getByLabel('选择 SQLite 文件').setInputFiles(fixture)
	await page.getByRole('button', { name: '打开表 records', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 1', exact: true }).waitFor()
	assert.equal(await page.getByLabel('行数统计结果', { exact: true }).count(), 0, 'counting must be opt-in')
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await page.getByLabel('行数统计结果', { exact: true }).filter({ hasText: '共 601 行' }).waitFor()
	await page.getByRole('button', { name: '下一页', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 201', exact: true }).waitFor()
	assert.equal(await page.getByLabel('行数统计结果', { exact: true }).innerText(), '共 601 行', 'paging must preserve the count')
	await page.getByRole('button', { name: '结构', exact: true }).click()
	await page.getByText('CREATE TABLE records', { exact: false }).waitFor()
	await page.getByRole('button', { name: '数据', exact: true }).click()
	await page.getByRole('button', { name: '筛选', exact: true }).click()
	await page.getByLabel('筛选列').selectOption('name')
	await page.getByLabel('筛选条件').selectOption('eq')
	await page.getByLabel('筛选值').fill('记录 50')
	await page.getByRole('button', { name: '应用筛选' }).click()
	await page.getByRole('gridcell', { name: '记录 50', exact: true }).waitFor()
	assert.equal(await page.getByLabel('行数统计结果', { exact: true }).count(), 0, 'a changed filter must invalidate the displayed count')
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await page.getByLabel('行数统计结果', { exact: true }).filter({ hasText: '匹配 1 行' }).waitFor()
	await page.getByLabel('筛选值').fill('no matching row')
	await page.getByRole('button', { name: '应用筛选' }).click()
	await page.getByText('查询完成，没有匹配的记录。', { exact: true }).waitFor()
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await page.getByLabel('行数统计结果', { exact: true }).filter({ hasText: '匹配 0 行' }).waitFor()
	await page.getByRole('button', { name: '打开视图 names', exact: true }).click()
	await page.getByRole('gridcell', { name: '记录 1', exact: true }).waitFor()
	assert.equal(await page.getByLabel('行数统计结果', { exact: true }).count(), 0, 'switching objects must clear the previous count')
	await page.getByRole('button', { name: '统计行数', exact: true }).click()
	await page.getByLabel('行数统计结果', { exact: true }).filter({ hasText: '共 601 行' }).waitFor()
	report.functional.push('on-demand counts, filtered/zero/view counts, paging retention and invalidation')
	report.functional.push('open, table paging, structure, bound filtering')
	await page.getByRole('button', { name: 'SQL 查询', exact: true }).click()
	async function run(sql) {
		await page.evaluate(sql => {
			const model = globalThis.monaco?.editor.getModels().find(model => model.uri.authority === 'database')
			if (model) model.setValue(sql)
			else {
				const input = document.querySelector('textarea[aria-label="SQL 查询"]')
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, sql)
				input.dispatchEvent(new Event('input', { bubbles: true }))
			}
		}, sql)
		await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
	}
	await run('SELECT sum(r.amount) AS total FROM records r JOIN groups g ON r.grp=g.id')
	await page.getByRole('gridcell', { name: '180901', exact: true }).waitFor()
	await run('SELECT n, empty, data FROM special ORDER BY n DESC')
	await page.getByRole('gridcell', { name: '9223372036854775807', exact: true }).waitFor()
	await page.getByRole('gridcell', { name: 'NULL', exact: true }).waitFor()
	await run('DELETE FROM records')
	await page.getByRole('region', { name: '数据库工作台' }).getByRole('alert').waitFor()
	await run('SELECT count(*) FROM records')
	await page.getByRole('gridcell', { name: '601', exact: true }).waitFor()
	await run('SELECT sum(a.id*b.id*c.id) FROM records a,records b,records c')
	await page.getByRole('button', { name: '取消', exact: true }).click()
	await page.getByText('查询已取消。', { exact: true }).waitFor()
	await run('SELECT 42 AS answer')
	await page.getByRole('gridcell', { name: '42', exact: true }).waitFor()
	report.functional.push('join aggregate, bigint/null/blob, write rejection, cancel and reopen')
	await page.screenshot({ path: path.join(output, 'viewer.png') })
	await page.getByRole('button', { name: '关闭数据库', exact: true }).click()
	await page.waitForFunction(
		async () => {
			const root = await navigator.storage.getDirectory()
			try {
				const folder = await root.getDirectoryHandle('database-viewer')
				const names = []
				for await (const name of folder.keys()) names.push(name)
				return names.length === 0
			} catch (e) {
				if (e.name === 'NotFoundError') return true
				throw e
			}
		},
		undefined,
		{ timeout: 10_000 }
	)
	assert.deepEqual(errors, [])
	assert.ok(originalFile.equals(readFileSync(fixture)), 'read-only operations must preserve the source file bytes')

	if (process.env.DATABASE_LARGE === '1') {
		const file = path.join(output, 'large.sqlite')
		for (const size of (process.env.DATABASE_SIZES || '5,10,20').split(',').map(Number)) {
			console.log('Generating', size, 'GB')
			const generated = spawnSync('python3', ['tests/database/make-fixture.py', '--output', file, '--size-gb', String(size)], {
				encoding: 'utf8',
				timeout: 600_000
			})
			assert.equal(generated.status, 0, generated.stderr)
			console.log(generated.stdout.trim())
			await page.evaluate(() => {
				const input = document.createElement('input')
				input.type = 'file'
				input.id = 'benchmark-file'
				document.body.append(input)
			})
			await page.locator('#benchmark-file').setInputFiles(file)
			let peakRssKiB = 0
			const sampleMemory = () => {
				if (process.platform === 'win32') return
				const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
				const rows = ps.stdout
					.trim()
					.split('\n')
					.map(line => line.trim().split(/\s+/).map(Number))
				const descendants = new Set([process.pid])
				for (let round = 0; round < 6; round++) for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid)
				peakRssKiB = Math.max(
					peakRssKiB,
					rows.reduce((total, [pid, , rss]) => total + (pid !== process.pid && descendants.has(pid) ? rss : 0), 0)
				)
			}
			const memorySampler = setInterval(sampleMemory, 500)
			sampleMemory()
			let result
			try {
				result = await page.evaluate(
					async ({ workerUrl, size }) => {
						// Turbopack's emitted bootstrap is a classic worker, even for a module source.
						const worker = new Worker(workerUrl)
						let sequence = 0
						const pending = new Map()
						worker.onmessage = event => {
							const p = pending.get(event.data.id)
							pending.delete(event.data.id)
							event.data.ok ? p.resolve(event.data.data) : p.reject(new Error(event.data.error))
						}
						worker.onerror = event => {
							for (const p of pending.values()) p.reject(new Error(event.message))
							pending.clear()
						}
						const call = command =>
							new Promise((resolve, reject) => {
								const id = ++sequence
								pending.set(id, { resolve, reject })
								worker.postMessage({ ...command, id })
							})
						const selected = document.querySelector('#benchmark-file').files[0]
						const started = performance.now()
						await call({ type: 'open', file: selected, session: `benchmark-${size}` })
						const openMs = performance.now() - started
						const indexed = await call({ type: 'query', sql: 'SELECT id, name FROM records ORDER BY id DESC LIMIT 1' })
						const grouped = await call({
							type: 'query',
							sql: 'SELECT g.name, count(*),sum(r.amount) FROM records r JOIN groups g ON r.grp=g.id GROUP BY g.id ORDER BY g.id'
						})
						const scanned = await call({ type: 'query', sql: "SELECT count(*) FROM records WHERE substr(name,1,2)='记录'" })
						// Sort enough actual text to spill beyond the configured SQLite cache.
						const sorted = await call({
							type: 'query',
							sql: 'SELECT substr(CAST(payload AS TEXT),1,2048) AS p,id FROM records WHERE id<=50000 ORDER BY p DESC'
						})
						await call({ type: 'close' })
						worker.terminate()
						document.querySelector('#benchmark-file').remove()
						return {
							size: selected.size,
							openMs,
							indexed,
							grouped,
							scanned,
							sorted: { ...sorted, rows: sorted.rows.map(row => [row[0].slice(0, 16), row[1]]) }
						}
					},
					{ workerUrl, size }
				)
			} finally {
				clearInterval(memorySampler)
			}
			result.peakBrowserProcessRssMiB = peakRssKiB / 1024
			const native = spawnSync(
				'python3',
				[
					'-c',
					'import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute("SELECT id,name FROM records ORDER BY id DESC LIMIT 1").fetchall(),c.execute("SELECT g.name,count(*),sum(r.amount) FROM records r JOIN groups g ON r.grp=g.id GROUP BY g.id ORDER BY g.id").fetchall()]))',
					file
				],
				{ encoding: 'utf8' }
			)
			assert.equal(native.status, 0, native.stderr)
			const expected = JSON.parse(native.stdout)
			assert.deepEqual(result.indexed.rows, expected[0])
			assert.deepEqual(result.grouped.rows, expected[1])
			assert.equal(result.scanned.rows[0][0], expected[0][0][0])
			assert.ok(result.indexed.stats.maxOffset > 2 ** 32)
			assert.ok(result.sorted.stats.tempFiles > 0, 'large sort must use the OPFS temporary VFS')
			assert.equal(result.sorted.rows[0][1], 50000)
			assert.ok(result.size <= 20_000_000_000)
			report.large.push(result)
			writeFileSync(path.join(output, process.env.DATABASE_REPORT || 'report.json'), JSON.stringify(report, null, 2))
			console.log(
				JSON.stringify({
					size: result.size,
					openMs: result.openMs,
					indexMs: result.indexed.elapsedMs,
					groupMs: result.grouped.elapsedMs,
					scanMs: result.scanned.elapsedMs,
					sortMs: result.sorted.elapsedMs,
					peakBrowserRssMiB: result.peakBrowserProcessRssMiB,
					stats: result.sorted.stats
				})
			)
		}
	}
	writeFileSync(path.join(output, process.env.DATABASE_REPORT || 'report.json'), JSON.stringify(report, null, 2))
	console.log('PASS', report.functional, report.large.length, 'large-file cases')
} catch (error) {
	const page = browser.contexts()[0]?.pages()[0]
	if (page) {
		console.error((await page.locator('body').innerText()).slice(-4000))
		await page.screenshot({ path: path.join(output, 'failure.png') })
	}
	throw error
} finally {
	await browser.close()
}
