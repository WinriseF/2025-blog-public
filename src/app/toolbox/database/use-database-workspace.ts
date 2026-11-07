'use client'

import { useEffect, useRef, useState } from 'react'
import { DatabaseClient, cleanDatabaseScratch } from '@/lib/database/client'
import { quoteIdentifier, type DatabaseInfo, type QueryResult, type TableQuery, type TableStructure } from '@/lib/database/types'
import type { GridViewport } from './result-table'

type FilterDraft = { open: boolean; column: string; operator: NonNullable<TableQuery['filter']>['operator']; value: string }
type Document = {
	id: string
	kind: 'table' | 'sql'
	title: string
	mode: 'data' | 'structure' | 'sql'
	query: TableQuery
	structure: TableStructure | null
	result: QueryResult | null
	sql: string
	count: { key: string; value: number | bigint; elapsedMs: number } | null
	filter: FilterDraft
	viewport: GridViewport
	error: string
	notice: string
}
const emptyFilter: FilterDraft = { open: false, column: '', operator: 'contains', value: '' }
function createDocument(id: string, kind: Document['kind'], title: string, sql = ''): Document {
	return {
		id,
		kind,
		title,
		mode: kind === 'sql' ? 'sql' : 'data',
		query: { table: kind === 'table' ? title : '', offset: 0 },
		structure: null,
		result: null,
		sql,
		count: null,
		filter: { ...emptyFilter },
		viewport: { top: 0, left: 0 },
		error: '',
		notice: ''
	}
}

export function useDatabaseWorkspace() {
	const client = useRef<DatabaseClient | null>(null)
	const task = useRef(0)
	const sqlSerial = useRef(0)
	const [info, setInfo] = useState<DatabaseInfo | null>(null)
	const [documents, setDocuments] = useState<Document[]>([])
	const [activeId, setActiveId] = useState('')
	const active = documents.find(document => document.id === activeId)
	const [operation, setOperation] = useState<{ owner: string; kind: 'read' | 'count' } | null>(null)
	const [fileError, setFileError] = useState('')
	const [fileNotice, setFileNotice] = useState('')
	const busy = operation !== null
	const query = active?.query || { table: '', offset: 0 }
	const countKey = JSON.stringify([query.table, query.filter || null])
	function patch(id: string, changes: Partial<Document> | ((document: Document) => Partial<Document>)) {
		setDocuments(previous =>
			previous.map(document => (document.id === id ? { ...document, ...(typeof changes === 'function' ? changes(document) : changes) } : document))
		)
	}
	useEffect(() => {
		client.current = new DatabaseClient()
		return () => {
			task.current++
			client.current?.dispose()
			void cleanDatabaseScratch().catch(() => {})
		}
	}, [])
	async function perform(owner: string, work: (id: number) => Promise<void>, kind: 'read' | 'count' = 'read') {
		const id = ++task.current
		setOperation({ owner, kind })
		setFileError('')
		setFileNotice('')
		patch(owner, { error: '', notice: '' })
		try {
			await work(id)
		} catch (e) {
			if (id === task.current) {
				const error = e instanceof Error ? e.message : '操作失败。'
				if (owner) patch(owner, { error })
				else setFileError(error)
			}
		} finally {
			if (id === task.current) setOperation(null)
		}
	}
	function invalidateCursor() {
		setDocuments(previous =>
			previous.map(document =>
				document.kind === 'sql' && document.result?.hasMore ? { ...document, result: { ...document.result, hasMore: false } } : document
			)
		)
	}
	async function loadTable(document: Document, id: number) {
		invalidateCursor()
		const structure = await client.current!.call<TableStructure>({ type: 'structure', table: document.title })
		if (id !== task.current) return
		patch(document.id, { structure })
		const result = await client.current!.call<QueryResult>({ type: 'table', query: document.query })
		if (id === task.current) patch(document.id, { result })
	}
	function resetDatabase() {
		setInfo(null)
		setDocuments([])
		setActiveId('')
		sqlSerial.current = 0
	}
	function open(file?: File) {
		if (!file) return
		resetDatabase()
		void perform('', async id => {
			const opened = await client.current!.open(file)
			if (id !== task.current) return
			setInfo(opened)
			const first = opened.objects.find(object => object.type === 'table') || opened.objects[0]
			if (first) {
				const document = createDocument(`table:${first.name}`, 'table', first.name)
				setDocuments([document])
				setActiveId(document.id)
				setOperation({ owner: document.id, kind: 'read' })
				try {
					await loadTable(document, id)
				} catch (e) {
					if (id === task.current) patch(document.id, { error: e instanceof Error ? e.message : '操作失败。' })
				}
			}
		})
	}
	function browse(next: TableQuery) {
		if (busy || !active || active.kind !== 'table') return
		const owner = active.id
		invalidateCursor()
		void perform(owner, async id => {
			const result = await client.current!.call<QueryResult>({ type: 'table', query: next })
			if (id === task.current) patch(owner, { query: next, result })
		})
	}
	function selectTable(name: string) {
		const existing = documents.find(document => document.kind === 'table' && document.title === name)
		if (existing) {
			setActiveId(existing.id)
			return
		}
		if (busy) return
		const document = createDocument(`table:${name}`, 'table', name)
		setDocuments(previous => [...previous, document])
		setActiveId(document.id)
		void perform(document.id, id => loadTable(document, id))
	}
	function countRows() {
		if (busy || !active || !query.table) return
		const owner = active.id
		invalidateCursor()
		void perform(
			owner,
			async id => {
				const result = await client.current!.call<QueryResult>({ type: 'count', query: { table: query.table, filter: query.filter } })
				const value = result.rows[0]?.[0]
				if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('未能取得行数统计结果。')
				if (id === task.current) patch(owner, { count: { key: countKey, value, elapsedMs: result.elapsedMs } })
			},
			'count'
		)
	}
	function showSql() {
		if (!info) return
		const serial = ++sqlSerial.current
		const document = createDocument(
			`sql:${serial}`,
			'sql',
			serial === 1 ? 'SQL 查询' : `SQL 查询 ${serial}`,
			query.table ? `SELECT *\nFROM ${quoteIdentifier(query.table)}\nLIMIT 200;` : 'SELECT name, type FROM sqlite_schema;'
		)
		setDocuments(previous => [...previous, document])
		setActiveId(document.id)
	}
	function run(statement: string) {
		if (busy || active?.kind !== 'sql') return
		const owner = active.id
		invalidateCursor()
		void perform(owner, async id => {
			const result = await client.current!.call<QueryResult>({ type: 'query', sql: statement })
			if (id === task.current) patch(owner, { result })
		})
	}
	function more() {
		if (busy || active?.kind !== 'sql' || !active.result?.hasMore) return
		const owner = active.id
		invalidateCursor()
		void perform(owner, async id => {
			const result = await client.current!.call<QueryResult>({ type: 'next' })
			if (id === task.current) patch(owner, document => ({ result: { ...result, rows: [...(document.result?.rows || []), ...result.rows] } }))
		})
	}
	function cancel() {
		task.current++
		client.current?.cancel()
		if (operation?.owner) patch(operation.owner, { notice: '查询已取消。' })
		else setFileNotice('查询已取消。')
		setOperation(null)
		invalidateCursor()
	}
	function closeDocument(id: string) {
		if (operation?.owner === id) cancel()
		const index = documents.findIndex(document => document.id === id)
		const remaining = documents.filter(document => document.id !== id)
		setDocuments(previous => previous.filter(document => document.id !== id))
		if (activeId === id) setActiveId(remaining[Math.min(index, remaining.length - 1)]?.id || '')
	}
	function close() {
		task.current++
		client.current?.dispose()
		resetDatabase()
		setOperation(null)
		setFileError('')
		setFileNotice('')
		void cleanDatabaseScratch().catch(() => setFileNotice('临时文件将在下次打开数据库时清理。'))
	}
	return {
		info,
		documents,
		activeId,
		activate: setActiveId,
		closeDocument,
		table: query.table,
		structure: active?.structure || null,
		tab: active?.mode || 'data',
		setTab: (mode: Document['mode']) => patch(activeId, { mode }),
		tableResult: active?.kind === 'table' ? active.result : null,
		sqlResult: active?.kind === 'sql' ? active.result : null,
		query,
		sql: active?.sql || '',
		setSql: (sql: string) => patch(activeId, { sql }),
		filter: active?.filter || emptyFilter,
		setFilter: (changes: Partial<FilterDraft>) => patch(activeId, document => ({ filter: { ...document.filter, ...changes } })),
		viewport: active?.viewport,
		busy,
		counting: operation?.kind === 'count',
		operationOwner: operation?.owner,
		rowCount: active?.count?.key === countKey ? active.count : null,
		error: active?.error || fileError,
		setError: (error: string) => {
			patch(activeId, { error })
			setFileError(error)
		},
		notice: active?.notice || fileNotice,
		countRows,
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
