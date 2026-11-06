import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import initSQLite, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { installReadOnlyPolicy, QueryCursor } from '../../src/lib/database/engine'
import { countSql, tableSql } from '../../src/lib/database/types'

let sqlite: Sqlite3Static
let db: Database
let cursor: QueryCursor
beforeEach(async () => {
	sqlite ||= await initSQLite()
	db = new sqlite.oo1.DB(':memory:')
	db.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY, name TEXT, n INTEGER, b BLOB);
		INSERT INTO records VALUES(1, 'literal %_', 9223372036854775807, x'00ff'), (2, NULL, -9223372036854775808, x'');
		WITH RECURSIVE seq(n) AS (SELECT 3 UNION ALL SELECT n+1 FROM seq WHERE n<405)
		INSERT INTO records SELECT n,'row '||n,n,NULL FROM seq;`)
	installReadOnlyPolicy(sqlite, db)
	cursor = new QueryCursor(sqlite, db, () => ({ bytesRead: 0, readCalls: 0, maxOffset: 0, tempFiles: 0, wasmBytes: 0 }))
})
afterEach(() => {
	vi.restoreAllMocks()
	cursor.close()
	db.close()
})

describe('SQLite read-only query engine', () => {
	it('counts all rows including null values, independently of paging and sorting', () => {
		const query = { table: 'records', offset: 200, sort: { column: 'id', desc: true } }
		const { sql, bindings } = countSql(query)
		expect(sql).toBe('SELECT COUNT(*) FROM "records"')
		expect(bindings).toEqual([])
		expect(cursor.start(sql, bindings).rows).toEqual([[405]])
	})
	it.each([
		{ column: 'name', operator: 'contains' as const, value: '%_', expected: 1 },
		{ column: 'name', operator: 'null' as const, value: '', expected: 1 },
		{ column: 'name', operator: 'eq' as const, value: "' OR 1=1 --", expected: 0 },
		{ column: 'id', operator: 'gt' as const, value: '400', expected: 5 }
	])('counts matching rows with bound $operator filters', ({ expected, ...filter }) => {
		const { sql, bindings } = countSql({ table: 'records', filter })
		expect(cursor.start(sql, bindings).rows).toEqual([[expected]])
	})
	it('reports a timed-out computation clearly and permits the next query', () => {
		const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(120_001)
		expect(() => cursor.start('WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000000) SELECT sum(n) FROM seq')).toThrow('120 秒')
		clock.mockRestore()
		expect(cursor.start('SELECT 42').rows).toEqual([[42]])
	})
	it('does not leave an expired progress handler attached while a cursor is idle', () => {
		cursor.start('SELECT id FROM records ORDER BY id')
		const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 200_000)
		expect(db.selectValue('SELECT count(*) FROM records a, records b')).toBe(405 * 405)
		clock.mockRestore()
		expect(cursor.next().rows[0]).toEqual([201])
	})
	it('preserves 64-bit integers, duplicate labels, nulls and binary previews', () => {
		const result = cursor.start('SELECT n AS x, name AS x, b FROM records WHERE id<=2 ORDER BY id')
		expect(result.columns).toEqual(['x', 'x', 'b'])
		expect(String(result.rows[0][0])).toBe('9223372036854775807')
		expect(String(result.rows[1][0])).toBe('-9223372036854775808')
		expect(result.rows[1][1]).toBe(null)
		expect(result.rows[0][2]).toEqual({ blobBytes: 2, preview: '00 ff' })
	})
	it('retains a cursor across bounded pages', () => {
		expect(cursor.start('SELECT id FROM records ORDER BY id').rows).toHaveLength(200)
		const next = cursor.next()
		expect(next.rows[0]).toEqual([201])
		expect(next.rows).toHaveLength(200)
		expect(cursor.next()).toMatchObject({ rows: [[401], [402], [403], [404], [405]], hasMore: false })
	})
	it('supports CTEs, joins and aggregates', () => {
		expect(cursor.start('WITH a AS (SELECT id FROM records WHERE id<3) SELECT sum(a.id) FROM a JOIN records r ON a.id=r.id').rows).toEqual([[3]])
	})
	it.each([
		'DELETE FROM records',
		"UPDATE records SET name='bad'",
		'CREATE TEMP TABLE bad(x)',
		'PRAGMA query_only=OFF',
		'PRAGMA user_version=9',
		"ATTACH ':memory:' AS extra",
		"VACUUM INTO 'other.db'",
		'BEGIN',
		'PRAGMA writable_schema=ON'
	])('rejects %s', sql => {
		expect(() => cursor.start(sql)).toThrow()
		expect(cursor.start('SELECT count(*) FROM records').rows).toEqual([[405]])
	})
	it('uses SQLite parsing to reject multiple statements, allowing semicolons in strings/comments', () => {
		expect(() => cursor.start('SELECT 1; SELECT 2')).toThrow('每次执行一条')
		expect(cursor.start("SELECT ';' /* ; */; -- trailing comment").rows).toEqual([[';']])
	})
	it('supports read-only structure pragmas', () => {
		expect(cursor.start('PRAGMA table_xinfo(records)').rows).toHaveLength(4)
	})
	it('preserves embedded NUL text and bounds text results before copying into JS', () => {
		expect(cursor.start("SELECT 'a'||char(0)||'b'").rows).toEqual([['a\0b']])
		expect(() => cursor.start("SELECT printf('%.*c',1048577,'x')")).toThrow('单个文本超过')
		expect(cursor.start('SELECT 1').rows).toEqual([[1]])
	})
	it('limits rows and recovers from invalid SQL', () => {
		expect(() => cursor.start('invalid sql')).toThrow()
		let result = cursor.start('WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10001) SELECT n FROM seq')
		let rows = result.rows.length
		while (result.hasMore) {
			result = cursor.next()
			rows += result.rows.length
		}
		expect(rows).toBe(10000)
		expect(result.truncated).toBe(true)
	})
	it('binds filter values and treats LIKE wildcard characters literally', () => {
		const { sql, bindings } = tableSql({ table: 'records', offset: 0, filter: { column: 'name', operator: 'contains', value: '%_' } })
		expect(cursor.start(sql, bindings).rows).toHaveLength(1)
		expect(tableSql({ table: 'a"b', offset: 0 }).sql).toContain('"a""b"')
	})
})
