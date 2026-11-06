'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { loadWorkspaceMonaco } from '@/lib/version-control/monaco-runtime'
import { useTimeTheme } from '@/components/time-theme-provider'
import styles from './database.module.css'

export function SqlEditor({
	value,
	onChange,
	onRun,
	disabled
}: {
	value: string
	onChange: (value: string) => void
	onRun: (sql: string) => void
	disabled: boolean
}) {
	const element = useRef<HTMLDivElement>(null)
	const instance = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
	const latest = useRef({ value, onChange, onRun, disabled })
	latest.current = { value, onChange, onRun, disabled }
	const [ready, setReady] = useState(false)
	const [loadFailed, setLoadFailed] = useState(false)
	const { theme } = useTimeTheme()
	useEffect(() => {
		let disposed = false
		let cleanup: (() => void) | undefined
		void loadWorkspaceMonaco()
			.then(monaco => {
				if (disposed || !element.current) return
				const model = monaco.editor.createModel(latest.current.value, 'sql', monaco.Uri.parse(`inmemory://database/${crypto.randomUUID()}.sql`))
				const editor = monaco.editor.create(element.current, {
					model,
					automaticLayout: true,
					readOnly: latest.current.disabled,
					minimap: { enabled: false },
					fontSize: 13,
					lineHeight: 21,
					lineNumbersMinChars: 3,
					padding: { top: 10, bottom: 8 },
					overviewRulerLanes: 0,
					scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
					scrollBeyondLastLine: false,
					ariaLabel: 'SQL 查询',
					theme: 'vs-dark'
				})
				instance.current = editor
				const change = editor.onDidChangeModelContent(() => latest.current.onChange(editor.getValue()))
				editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
					if (latest.current.disabled) return
					const selection = editor.getSelection()
					latest.current.onRun(selection && !selection.isEmpty() ? model.getValueInRange(selection) : editor.getValue())
				})
				cleanup = () => {
					change.dispose()
					editor.dispose()
					model.dispose()
				}
				setReady(true)
			})
			.catch(() => {
				if (!disposed) setLoadFailed(true)
			})
		return () => {
			disposed = true
			cleanup?.()
			instance.current = null
		}
	}, [])
	useEffect(() => {
		if (instance.current && instance.current.getValue() !== value) instance.current.setValue(value)
	}, [value])
	useEffect(() => {
		instance.current?.updateOptions({ readOnly: disabled })
	}, [disabled])
	useEffect(() => {
		if (ready)
			void loadWorkspaceMonaco().then(monaco => {
				if (!element.current) return
				const css = getComputedStyle(element.current)
				// CSS minification can shorten hex colors; Monaco's token map requires six digits.
				const color = (name: string) =>
					css
						.getPropertyValue(name)
						.trim()
						.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3')
				monaco.editor.defineTheme('database-sql', {
					base: theme.name === 'night' ? 'vs-dark' : 'vs',
					inherit: true,
					rules: [],
					colors: {
						'editor.background': color('--db-bg'),
						'editor.foreground': color('--db-text'),
						'editorLineNumber.foreground': color('--db-muted'),
						'editor.lineHighlightBackground': color('--db-panel'),
						'editor.lineHighlightBorder': '#00000000'
					}
				})
				monaco.editor.setTheme('database-sql')
			})
	}, [theme.name, ready])
	return (
		<div className={styles.editor}>
			{loadFailed && (
				<div role='status' className={styles.editorFallback}>
					高级编辑器加载失败，已切换为基础编辑器，仍可输入和执行 SQL。
				</div>
			)}
			<div className={styles.editorSurface}>
				<div ref={element} className='absolute inset-0' />
				{!ready && (
					<textarea
						aria-label='SQL 查询'
						className='font-mono'
						value={value}
						disabled={disabled}
						onChange={event => onChange(event.target.value)}
						onKeyDown={event => {
							if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
								event.preventDefault()
								onRun(event.currentTarget.value.substring(event.currentTarget.selectionStart, event.currentTarget.selectionEnd) || value)
							}
						}}
					/>
				)}
			</div>
		</div>
	)
}
