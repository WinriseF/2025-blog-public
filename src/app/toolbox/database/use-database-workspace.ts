'use client'

import { useEffect, useRef, useState } from 'react'
import { DatabaseClient, cleanDatabaseScratch } from '@/lib/database/client'
import { quoteIdentifier, type DatabaseInfo, type QueryResult, type TableQuery, type TableStructure } from '@/lib/database/types'

export function useDatabaseWorkspace() {
	const client = useRef<DatabaseClient | null>(null)
	const task = useRef(0)
	const seededSql = useRef(false)
	const [info, setInfo] = useState<DatabaseInfo | null>(null)
	const [table, setTable] = useState('')
	const [structure, setStructure] = useState<TableStructure | null>(null)
	const [tab, setTab] = useState<'data' | 'structure' | 'sql'>('data')
	const [tableResult, setTableResult] = useState<QueryResult | null>(null)
	const [sqlResult, setSqlResult] = useState<QueryResult | null>(null)
	const [query, setQuery] = useState<TableQuery>({ table: '', offset: 0 })
	const [sql, setSql] = useState('SELECT name, type FROM sqlite_schema;')
	const [busy, setBusy] = useState(false)
	const [counting, setCounting] = useState(false)
	const [count, setCount] = useState<{ key: string; value: number | bigint; elapsedMs: number } | null>(null)
	const countKey = JSON.stringify([query.table, query.filter || null])
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')
	useEffect(() => {
		client.current = new DatabaseClient()
		return () => {
			task.current++
			client.current?.dispose()
			void cleanDatabaseScratch().catch(() => {})
		}
	}, [])
	async function perform(work: (id: number) => Promise<void>, kind: 'read' | 'count' = 'read') {
		const id = ++task.current
		setBusy(true)
		setCounting(kind === 'count')
		setError('')
		setNotice('')
		try {
			await work(id)
		} catch (e) {
			if (id === task.current) setError(e instanceof Error ? e.message : '操作失败。')
		} finally {
			if (id === task.current) {
				setBusy(false)
				setCounting(false)
			}
		}
	}
	function invalidateCursor() {
		setSqlResult(previous => (previous ? { ...previous, hasMore: false } : null))
	}
	async function loadTable(name: string, id: number) {
		setCount(null)
		setTable(name)
		setTab('data')
		setStructure(null)
		setTableResult(null)
		invalidateCursor()
		const schema = await client.current!.call<TableStructure>({ type: 'structure', table: name })
		if (id !== task.current) return
		setStructure(schema)
		const next = { table: name, offset: 0 }
		setQuery(next)
		const data = await client.current!.call<QueryResult>({ type: 'table', query: next })
		if (id === task.current) setTableResult(data)
	}
	function open(file?: File) {
		if (!file) return
		setCount(null)
		setInfo(null)
		setTable('')
		setStructure(null)
		setTableResult(null)
		setSqlResult(null)
		setTab('data')
		seededSql.current = false
		setSql('SELECT name, type FROM sqlite_schema;')
		void perform(async id => {
			const opened = await client.current!.open(file)
			if (id !== task.current) return
			setInfo(opened)
			const first = opened.objects.find(object => object.type === 'table') || opened.objects[0]
			if (first) await loadTable(first.name, id)
		})
	}
	function browse(next: TableQuery) {
		invalidateCursor()
		void perform(async id => {
			const data = await client.current!.call<QueryResult>({ type: 'table', query: next })
			if (id === task.current) {
				setQuery(next)
				setTableResult(data)
			}
		})
	}
	function selectTable(name: string) {
		if (name === table && tableResult) {
			setTab('data')
			return
		}
		void perform(id => loadTable(name, id))
	}
	function countRows() {
		if (busy || !query.table) return
		invalidateCursor()
		void perform(async id => {
			const result = await client.current!.call<QueryResult>({ type: 'count', query: { table: query.table, filter: query.filter } })
			const value = result.rows[0]?.[0]
			if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('未能取得行数统计结果。')
			if (id === task.current) setCount({ key: countKey, value, elapsedMs: result.elapsedMs })
		}, 'count')
	}
	function showSql() {
		if (!seededSql.current) {
			if (table) setSql(`SELECT *\nFROM ${quoteIdentifier(table)}\nLIMIT 200;`)
			seededSql.current = true
		}
		setTab('sql')
	}
	function run(statement: string) {
		if (busy) return
		void perform(async id => {
			const data = await client.current!.call<QueryResult>({ type: 'query', sql: statement })
			if (id === task.current) setSqlResult(data)
		})
	}
	function more() {
		void perform(async id => {
			const data = await client.current!.call<QueryResult>({ type: 'next' })
			if (id === task.current) setSqlResult(previous => ({ ...data, rows: [...(previous?.rows || []), ...data.rows] }))
		})
	}
	function cancel() {
		task.current++
		client.current?.cancel()
		setBusy(false)
		setCounting(false)
		setNotice('查询已取消。')
		invalidateCursor()
	}
	function close() {
		setCount(null)
		setCounting(false)
		task.current++
		client.current?.dispose()
		setInfo(null)
		setTableResult(null)
		setSqlResult(null)
		setStructure(null)
		setTable('')
		setBusy(false)
		setError('')
		setNotice('')
		void cleanDatabaseScratch().catch(() => setNotice('临时文件将在下次打开数据库时清理。'))
	}
	return {
		info,
		table,
		structure,
		tab,
		setTab,
		tableResult,
		sqlResult,
		query,
		sql,
		setSql,
		busy,
		counting,
		rowCount: count?.key === countKey ? count : null,
		countRows,
		error,
		setError,
		notice,
		open,
		browse,
		selectTable,
		showSql,
		run,
		more,
		cancel,
		close
	}
}
