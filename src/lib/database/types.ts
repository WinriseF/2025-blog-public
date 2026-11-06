export const MAX_DATABASE_BYTES = 20_000_000_000
export const PAGE_ROWS = 200
export const MAX_RESULT_ROWS = 10_000
export const MAX_RESULT_BYTES = 16 * 1024 * 1024
export const DATABASE_OPERATION_TIMEOUT_MS = 120_000
export const DATABASE_TIMEOUT_MESSAGE = '数据库操作超过 120 秒，已停止。请缩小筛选范围，或在 SQL 编辑器中优化查询后重试。'

export type CellValue = string | number | bigint | null | { blobBytes: number; preview: string }
export type QueryResult = {
	columns: string[]
	rows: CellValue[][]
	hasMore: boolean
	truncated: boolean
	elapsedMs: number
	stats: { bytesRead: number; readCalls: number; maxOffset: number; tempFiles: number; wasmBytes: number }
}
export type DatabaseObject = { name: string; type: 'table' | 'view' }
export type DatabaseInfo = { name: string; size: number; version: string; objects: DatabaseObject[] }
export type ColumnInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
export type TableStructure = { columns: ColumnInfo[]; indexes: Record<string, unknown>[]; foreignKeys: Record<string, unknown>[]; sql: string | null }
export type TableQuery = {
	table: string
	offset: number
	sort?: { column: string; desc: boolean }
	filter?: { column: string; operator: 'contains' | 'eq' | 'gt' | 'lt' | 'null'; value: string }
}
export type DatabaseCommand =
	| { type: 'open'; file: File; session: string }
	| { type: 'structure'; table: string }
	| { type: 'table'; query: TableQuery }
	| { type: 'count'; query: Pick<TableQuery, 'table' | 'filter'> }
	| { type: 'query'; sql: string }
	| { type: 'next' }
	| { type: 'close' }
export type DatabaseRequest = DatabaseCommand & { id: number }
export type DatabaseResponse = { id: number; ok: true; data: DatabaseInfo | TableStructure | QueryResult | null } | { id: number; ok: false; error: string }

export function quoteIdentifier(value: string) {
	return '"' + value.replaceAll('"', '""') + '"'
}

function selectSql(query: Pick<TableQuery, 'table' | 'filter'>, projection: '*' | 'COUNT(*)') {
	let sql = `SELECT ${projection} FROM ${quoteIdentifier(query.table)}`
	const bindings: (string | number)[] = []
	if (query.filter) {
		const { column, operator, value } = query.filter
		const name = quoteIdentifier(column)
		if (operator === 'null') sql += ` WHERE ${name} IS NULL`
		else {
			const operations = { contains: 'LIKE', eq: '=', gt: '>', lt: '<' }
			sql += ` WHERE ${name} ${operations[operator]} ?${operator === 'contains' ? " ESCAPE '\\'" : ''}`
			bindings.push(operator === 'contains' ? `%${value.replace(/[\\%_]/g, '\\$&')}%` : value)
		}
	}
	return { sql, bindings }
}

export function countSql(query: Pick<TableQuery, 'table' | 'filter'>) {
	return selectSql(query, 'COUNT(*)')
}

export function tableSql(query: TableQuery) {
	let { sql, bindings } = selectSql(query, '*')
	if (query.sort) sql += ` ORDER BY ${quoteIdentifier(query.sort.column)} ${query.sort.desc ? 'DESC' : 'ASC'}`
	sql += ' LIMIT ? OFFSET ?'
	bindings.push(PAGE_ROWS + 1, Math.max(0, Math.trunc(query.offset)))
	return { sql, bindings }
}
