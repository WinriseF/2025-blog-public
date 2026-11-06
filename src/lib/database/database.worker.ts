import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { createFileVfs } from './file-vfs'
import { installReadOnlyPolicy, QueryCursor } from './engine'
import {
	MAX_DATABASE_BYTES,
	PAGE_ROWS,
	quoteIdentifier,
	tableSql,
	countSql,
	type DatabaseRequest,
	type DatabaseResponse,
	type DatabaseObject,
	type ColumnInfo,
	type TableStructure
} from './types'

let sqlite: Sqlite3Static
let db: Database | undefined
let pool: SAHPoolUtil | undefined
let vfs: ReturnType<typeof createFileVfs> | undefined
let cursor: QueryCursor | undefined

async function close() {
	cursor?.close()
	cursor = undefined
	db?.close()
	db = undefined
	vfs?.dispose()
	vfs = undefined
	if (pool) {
		await pool.removeVfs()
		pool = undefined
	}
}

async function execute(request: DatabaseRequest) {
	if (request.type === 'close') {
		await close()
		return null
	}
	if (request.type === 'open') {
		await close()
		const { file, session } = request
		if (!file.size || file.size > MAX_DATABASE_BYTES) throw new Error('请选择不超过 20 GB 的 SQLite 文件。')
		const header = new Uint8Array(await file.slice(0, 100).arrayBuffer())
		if (new TextDecoder().decode(header.subarray(0, 16)) !== 'SQLite format 3\0') throw new Error('文件不是普通 SQLite 数据库，或文件已加密。')
		if (!sqlite) {
			// Serve the matching official JS/WASM unchanged. Turbopack cannot bundle
			// the package's optional dynamic sub-worker URLs.
			const url = new URL('/toolbox/database/runtime/3.54.1-build1/index.mjs', self.location.origin).href
			const runtime = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as typeof import('@sqlite.org/sqlite-wasm')
			sqlite = await runtime.default()
		}
		pool = await sqlite.installOpfsSAHPoolVfs({ name: 'database-scratch', directory: `/database-viewer/${session}`, initialCapacity: 12, clearOnInit: true })
		try {
			vfs = createFileVfs(sqlite, file, 'database-scratch')
			db = new sqlite.oo1.DB({ filename: 'file:/selected.sqlite?immutable=1', flags: 'r', vfs: vfs.name })
			installReadOnlyPolicy(sqlite, db)
			cursor = new QueryCursor(sqlite, db, () => ({ ...vfs!.stats, wasmBytes: sqlite.wasm.heap8u().buffer.byteLength }))
			const objects = db.selectObjects(
				"SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
			) as DatabaseObject[]
			return { name: file.name, size: file.size, version: sqlite.capi.sqlite3_libversion(), objects }
		} catch (error) {
			await close()
			throw error
		}
	}
	if (!db || !cursor) throw new Error('请先打开数据库文件。')
	if (request.type === 'structure') {
		const name = quoteIdentifier(request.table)
		return {
			columns: db.selectObjects(`PRAGMA table_xinfo(${name})`) as ColumnInfo[],
			indexes: db.selectObjects(`PRAGMA index_list(${name})`),
			foreignKeys: db.selectObjects(`PRAGMA foreign_key_list(${name})`),
			sql: db.selectValue('SELECT sql FROM sqlite_schema WHERE name=?', [request.table])
		} as TableStructure
	}
	if (request.type === 'query') return cursor.start(request.sql)
	if (request.type === 'next') return cursor.next()
	if (request.type === 'count') {
		const { sql, bindings } = countSql(request.query)
		return cursor.start(sql, bindings)
	}
	const { sql, bindings } = tableSql(request.query)
	const result = cursor.start(sql, bindings)
	// The extra row establishes whether another table page exists without COUNT(*).
	if (result.hasMore) {
		const extra = cursor.next(false)
		result.hasMore = extra.rows.length > 0
		result.elapsedMs = extra.elapsedMs
		result.stats = extra.stats
	}
	cursor.close()
	result.rows = result.rows.slice(0, PAGE_ROWS)
	return result
}

let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<DatabaseRequest>) => {
	queue = queue.then(async () => {
		const { id } = event.data
		let response: DatabaseResponse
		try {
			response = { id, ok: true, data: await execute(event.data) }
		} catch (error) {
			response = { id, ok: false, error: error instanceof Error ? error.message : '数据库操作失败。' }
		}
		self.postMessage(response)
	})
}
