'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { Copy, Search, WrapText, X } from 'lucide-react'
import { loadWorkspaceMonaco } from '@/lib/version-control/monaco-runtime'
import { cellText, formattedJson, isBlob, isJson, writeCellClipboard } from '@/lib/database/cells'
import type { CellValue } from '@/lib/database/types'
import { useTimeTheme } from '@/components/time-theme-provider'
import { applyDatabaseEditorTheme } from './editor-theme'
import styles from './database.module.css'

export function ValueViewer({ value, column, row, onClose }: { value: CellValue; column: string; row: number; onClose: () => void }) {
	const raw = cellText(value)
	const json = useMemo(() => typeof value === 'string' && isJson(value), [value])
	const [pretty, setPretty] = useState(false)
	const [wrap, setWrap] = useState(true)
	const [search, setSearch] = useState('')
	const [message, setMessage] = useState('')
	const [ready, setReady] = useState(false)
	const surface = useRef<HTMLDivElement>(null)
	const fallback = useRef<HTMLTextAreaElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
	const runtime = useRef<typeof Monaco | null>(null)
	const match = useRef(-1)
	const text = useMemo(() => (pretty && json ? formattedJson(raw) : raw), [pretty, json, raw])
	const latest = useRef({ text, json, wrap })
	latest.current = { text, json, wrap }
	const { theme } = useTimeTheme()
	const chars = useMemo(() => {
		let count = 0
		for (const _ of raw) count++
		return count
	}, [raw])
	useEffect(() => {
		setPretty(false)
		setMessage('')
		match.current = -1
	}, [value, column, row])
	useEffect(() => {
		let disposed = false
		let cleanup: (() => void) | undefined
		void loadWorkspaceMonaco()
			.then(monaco => {
				if (disposed || !surface.current) return
				runtime.current = monaco
				applyDatabaseEditorTheme(monaco, surface.current, document.documentElement.dataset.timeTheme === 'night')
				const model = monaco.editor.createModel(
					latest.current.text,
					latest.current.json ? 'json' : 'plaintext',
					monaco.Uri.parse(`inmemory://database-value/${crypto.randomUUID()}`)
				)
				const instance = monaco.editor.create(surface.current, {
					model,
					theme: 'database-sql',
					readOnly: true,
					automaticLayout: true,
					minimap: { enabled: false },
					fontSize: 12,
					lineHeight: 20,
					lineNumbersMinChars: 3,
					wordWrap: latest.current.wrap ? 'on' : 'off',
					scrollBeyondLastLine: false,
					padding: { top: 10, bottom: 10 },
					ariaLabel: '单元格完整内容',
					renderWhitespace: 'selection',
					unicodeHighlight: { ambiguousCharacters: false },
					scrollbar: { vertical: 'visible', horizontal: 'visible', verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
				})
				editor.current = instance
				cleanup = () => {
					instance.dispose()
					model.dispose()
				}
				setReady(true)
			})
			.catch(() => {
				/* The read-only text area remains available without the CDN. */
			})
		return () => {
			disposed = true
			cleanup?.()
			editor.current = null
			runtime.current = null
		}
	}, [])
	useEffect(() => {
		const model = editor.current?.getModel()
		if (model && runtime.current) {
			model.setValue(text)
			runtime.current.editor.setModelLanguage(model, json ? 'json' : 'plaintext')
			editor.current?.setScrollTop(0)
		}
		match.current = -1
	}, [text, json])
	useEffect(() => {
		editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' })
	}, [wrap])
	useEffect(() => {
		if (runtime.current && surface.current) applyDatabaseEditorTheme(runtime.current, surface.current, theme.name === 'night')
	}, [theme.name, ready])
	async function copy() {
		try {
			await writeCellClipboard({ text: raw })
			setMessage(isBlob(value) ? '已复制 BLOB 预览' : '已复制原始值')
		} catch {
			setMessage('复制失败，请在内容区选择文字后复制。')
		}
	}
	function find() {
		if (!search) return
		const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
		expression.lastIndex = Math.max(0, match.current)
		let found = expression.exec(text)
		if (!found) {
			expression.lastIndex = 0
			found = expression.exec(text)
		}
		if (!found) {
			setMessage('未找到匹配内容')
			return
		}
		const index = found.index,
			length = found[0].length
		match.current = index + length
		setMessage('已定位匹配内容')
		const model = editor.current?.getModel()
		if (model && runtime.current) {
			const start = model.getPositionAt(index),
				end = model.getPositionAt(index + length)
			const range = new runtime.current.Range(start.lineNumber, start.column, end.lineNumber, end.column)
			editor.current!.setSelection(range)
			editor.current!.revealRangeInCenter(range)
			editor.current!.focus()
		} else {
			fallback.current?.focus()
			fallback.current?.setSelectionRange(index, index + length)
		}
	}
	return (
		<aside className={styles.valueViewer} aria-label='单元格查看器'>
			<div className={styles.valueHeading}>
				<strong title={column}>{column}</strong>
				<span>第 {row} 行</span>
				<span className={styles.spacer} />
				<button className={styles.button} onClick={onClose} aria-label='关闭单元格查看器'>
					<X size={14} />
				</button>
			</div>
			<div className={styles.valueMeta}>
				<span>
					{value === null
						? 'NULL · 数据库空值'
						: isBlob(value)
							? `BLOB · ${value.blobBytes.toLocaleString()} 字节`
							: typeof value === 'string'
								? `TEXT · ${chars.toLocaleString()} 字符${value === '' ? ' · 空字符串' : ''}`
								: `${typeof value === 'bigint' || Number.isInteger(value) ? 'INTEGER' : 'REAL'} · 原始数值`}
				</span>
			</div>
			<div className={styles.valueToolbar}>
				<button className={styles.button} onClick={copy}>
					<Copy size={12} />
					{isBlob(value) ? '复制预览' : '复制原值'}
				</button>
				{json && (
					<button className={styles.button} aria-pressed={pretty} onClick={() => setPretty(!pretty)}>
						{pretty ? '显示原文' : '格式化 JSON'}
					</button>
				)}
				<span className={styles.spacer} />
				<button className={styles.button} aria-label='自动换行' aria-pressed={wrap} onClick={() => setWrap(!wrap)} title='自动换行'>
					<WrapText size={14} />
				</button>
			</div>
			<div className={styles.valueSearch}>
				<Search size={12} />
				<input
					aria-label='查找单元格内容'
					placeholder='查找内容'
					value={search}
					onChange={event => {
						setSearch(event.target.value)
						match.current = -1
					}}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							event.preventDefault()
							find()
						}
					}}
				/>
				<button className={styles.button} disabled={!search} onClick={find}>
					查找下一个
				</button>
			</div>
			{isBlob(value) && <p className={styles.valueNote}>仅显示前 {Math.min(32, value.blobBytes)} 字节预览，未加载完整二进制内容。</p>}
			<div className={styles.valueContent}>
				<div ref={surface} className='absolute inset-0' />
				{!ready && <textarea ref={fallback} readOnly aria-label='单元格完整内容' value={text} wrap={wrap ? 'soft' : 'off'} />}
			</div>
			<div className={styles.valueStatus} role='status'>
				{message || (pretty ? '格式化预览 · 复制保留原文' : '可选择文字片段复制')}
			</div>
		</aside>
	)
}
