import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import {
	DATABASE_OPERATION_TIMEOUT_MS,
	DATABASE_TIMEOUT_MESSAGE,
	MAX_RESULT_BYTES,
	MAX_RESULT_ROWS,
	PAGE_ROWS,
	type CellValue,
	type QueryResult
} from './types'

export function installReadOnlyPolicy(sqlite: Sqlite3Static, db: Database) {
	const c = sqlite.capi
	db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-262144; PRAGMA temp.cache_size=-8192')
	c.sqlite3_limit(db.pointer!, c.SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024)
	c.sqlite3_limit(db.pointer!, c.SQLITE_LIMIT_SQL_LENGTH, 1024 * 1024)
	c.sqlite3_limit(db.pointer!, c.SQLITE_LIMIT_ATTACHED, 0)
	const pragmas = new Set([
		'table_info',
		'table_xinfo',
		'index_list',
		'index_info',
		'index_xinfo',
		'foreign_key_list',
		'database_list',
		'compile_options',
		'page_count',
		'page_size',
		'encoding',
		'user_version',
		'schema_version'
	])
	const argumentPragmas = new Set(['table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list'])
	c.sqlite3_set_authorizer(
		db.pointer!,
		(_context, action, arg1, arg2) => {
			if (action === c.SQLITE_SELECT || action === c.SQLITE_READ || action === c.SQLITE_RECURSIVE) return c.SQLITE_OK
			if (action === c.SQLITE_FUNCTION)
				return ['load_extension', 'writefile', 'readfile', 'eval'].includes(String(arg2).toLowerCase()) ? c.SQLITE_DENY : c.SQLITE_OK
			if (action === c.SQLITE_PRAGMA && pragmas.has(String(arg1).toLowerCase()) && (!arg2 || argumentPragmas.has(String(arg1).toLowerCase())))
				return c.SQLITE_OK
			return c.SQLITE_DENY
		},
		0
	)
}

/** Keeps a prepared cursor in the Worker; never materializes an entire query result. */
export class QueryCursor {
	private statement = 0
	private columns: string[] = []
	private count = 0
	private bytes = 0
	private started = 0
	private elapsed = 0
	private deadline = 0
	constructor(
		private sqlite: Sqlite3Static,
		private db: Database,
		private stats: () => QueryResult['stats']
	) {}

	close() {
		if (this.statement) this.sqlite.capi.sqlite3_finalize(this.statement)
		this.statement = 0
		this.sqlite.capi.sqlite3_progress_handler(this.db.pointer!, 0, 0, 0)
	}

	start(sql: string, bindings: (string | number)[] = []) {
		this.close()
		this.count = this.bytes = this.elapsed = 0
		this.started = performance.now()
		this.deadline = this.started + DATABASE_OPERATION_TIMEOUT_MS
		const { capi: c, wasm: w } = this.sqlite
		c.sqlite3_progress_handler(this.db.pointer!, 10_000, () => (performance.now() > this.deadline ? 1 : 0), 0)
		const scope = w.scopedAllocPush()
		try {
			if (!sql.trim() || sql.includes('\0')) throw new Error('请输入有效的 SQL。')
			const input = w.scopedAllocCString(sql, false) as unknown as number
			const out = w.scopedAlloc(8)
			let next = input
			while (next && w.peek(next, 'i8')) {
				this.db.checkRc(c.sqlite3_prepare_v3(this.db.pointer!, next, -1, 0, out, out + 4))
				const statement = Number(w.peek(out, 'i32'))
				const tail = Number(w.peek(out + 4, 'i32'))
				if (statement) {
					if (this.statement) {
						c.sqlite3_finalize(statement)
						throw new Error('每次执行一条 SQL；可以选中编辑器中的语句再运行。')
					}
					this.statement = statement
					if (!c.sqlite3_stmt_readonly(statement)) throw new Error('仅允许只读 SQL 查询。')
				}
				if (tail <= next) break
				next = tail
			}
			if (!this.statement) throw new Error('没有可执行的 SQL。')
			bindings.forEach((value, index) => {
				if (typeof value === 'number') this.db.checkRc(c.sqlite3_bind_double(this.statement, index + 1, value))
				else {
					// Bind UTF-8 through the C pointer API (the 3.54.1 JS-string overload is broken).
					const [pointer, length] = w.scopedAllocCString(value, true)
					this.db.checkRc(c.sqlite3_bind_text(this.statement, index + 1, pointer, length, c.SQLITE_TRANSIENT))
				}
			})
			this.columns = Array.from({ length: c.sqlite3_column_count(this.statement) }, (_, index) => c.sqlite3_column_name(this.statement, index))
			this.elapsed = performance.now() - this.started
			return this.next(false)
		} catch (error) {
			this.close()
			throw performance.now() >= this.deadline ? new Error(DATABASE_TIMEOUT_MESSAGE) : error
		} finally {
			w.scopedAllocPop(scope)
			c.sqlite3_progress_handler(this.db.pointer!, 0, 0, 0)
		}
	}

	next(resetDeadline = true): QueryResult {
		if (!this.statement) throw new Error('查询已经结束，请重新运行。')
		const begin = performance.now()
		if (resetDeadline) this.deadline = begin + DATABASE_OPERATION_TIMEOUT_MS
		const c = this.sqlite.capi
		c.sqlite3_progress_handler(this.db.pointer!, 10_000, () => (performance.now() >= this.deadline ? 1 : 0), 0)
		const rows: CellValue[][] = []
		let truncated = false
		try {
			while (rows.length < PAGE_ROWS) {
				const rc = c.sqlite3_step(this.statement)
				if (rc === c.SQLITE_DONE) {
					this.close()
					break
				}
				this.db.checkRc(rc === c.SQLITE_ROW ? c.SQLITE_OK : rc)
				const row: CellValue[] = []
				let rowBytes = 0
				for (let i = 0; i < this.columns.length; i++) {
					const type = c.sqlite3_column_type(this.statement, i)
					if (type === c.SQLITE_NULL) row.push(null)
					else if (type === c.SQLITE_INTEGER) {
						const value = c.sqlite3_column_int64(this.statement, i)
						row.push(value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value)
						rowBytes += 8
					} else if (type === c.SQLITE_FLOAT) {
						row.push(c.sqlite3_column_double(this.statement, i))
						rowBytes += 8
					} else {
						const length = c.sqlite3_column_bytes(this.statement, i)
						if (type === c.SQLITE_BLOB) {
							const pointer = c.sqlite3_column_blob(this.statement, i)
							const preview = Array.from(this.sqlite.wasm.heap8u().subarray(pointer, pointer + Math.min(32, length)), b =>
								b.toString(16).padStart(2, '0')
							).join(' ')
							row.push({ blobBytes: length, preview })
							rowBytes += 128
						} else {
							if (length > 1024 * 1024) throw new Error('单个文本超过 1 MB，请使用 substr() 截取后查询。')
							rowBytes += length * 2
							if (this.bytes + rowBytes > MAX_RESULT_BYTES) break
							const pointer = c.sqlite3_column_blob(this.statement, i)
							row.push(new TextDecoder().decode(this.sqlite.wasm.heap8u().subarray(pointer, pointer + length)))
						}
					}
				}
				if (this.count >= MAX_RESULT_ROWS || this.bytes + rowBytes > MAX_RESULT_BYTES) {
					truncated = true
					this.close()
					break
				}
				rows.push(row)
				this.count++
				this.bytes += rowBytes
			}
			this.elapsed += performance.now() - begin
			return { columns: this.columns, rows, hasMore: !!this.statement, truncated, elapsedMs: this.elapsed, stats: this.stats() }
		} catch (error) {
			this.close()
			throw performance.now() >= this.deadline ? new Error(DATABASE_TIMEOUT_MESSAGE) : error
		} finally {
			c.sqlite3_progress_handler(this.db.pointer!, 0, 0, 0)
		}
	}
}
