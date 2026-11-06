'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { loadWorkspaceMonaco } from '@/lib/version-control/monaco-runtime'
import { useTimeTheme } from '@/components/time-theme-provider'

type EditorProps = {
	value: string
	language: 'sql' | 'json' | 'plaintext'
	options: Monaco.editor.IStandaloneEditorConstructionOptions
	onChange?: (value: string) => void
	onRun?: (sql: string) => void
}

/** Shared lifetime for the SQL editor and the read-only cell viewer. */
export function useDatabaseEditor(props: EditorProps) {
	const element = useRef<HTMLDivElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
	const runtime = useRef<typeof Monaco | null>(null)
	const latest = useRef(props)
	latest.current = props
	const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
	const { theme } = useTimeTheme()
	useEffect(() => {
		let disposed = false
		let cleanup: (() => void) | undefined
		void loadWorkspaceMonaco()
			.then(monaco => {
				if (disposed || !element.current) return
				runtime.current = monaco
				const current = latest.current
				applyDatabaseEditorTheme(monaco, element.current, document.documentElement.dataset.timeTheme === 'night')
				const authority = current.language === 'sql' ? 'database' : 'database-value'
				const model = monaco.editor.createModel(current.value, current.language, monaco.Uri.parse(`inmemory://${authority}/${crypto.randomUUID()}`))
				cleanup = () => model.dispose()
				const instance = monaco.editor.create(element.current, {
					model,
					theme: 'database-sql',
					automaticLayout: true,
					minimap: { enabled: false },
					lineNumbersMinChars: 3,
					scrollBeyondLastLine: false,
					padding: { top: 10, bottom: 10 },
					...current.options
				})
				editor.current = instance
				const change = instance.onDidChangeModelContent(() => latest.current.onChange?.(instance.getValue()))
				if (current.onRun)
					instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
						if (latest.current.options.readOnly) return
						const selection = instance.getSelection()
						latest.current.onRun?.(selection && !selection.isEmpty() ? model.getValueInRange(selection) : instance.getValue())
					})
				cleanup = () => {
					change.dispose()
					instance.dispose()
					model.dispose()
				}
				setStatus('ready')
			})
			.catch(() => {
				cleanup?.()
				cleanup = undefined
				if (!disposed) setStatus('failed')
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
		if (!model) return
		if (model.getValue() !== props.value) model.setValue(props.value)
		if (model.getLanguageId() !== props.language) runtime.current!.editor.setModelLanguage(model, props.language)
	}, [props.value, props.language])
	useEffect(() => {
		editor.current?.updateOptions(props.options)
	}, [props.options])
	useEffect(() => {
		if (runtime.current && element.current) applyDatabaseEditorTheme(runtime.current, element.current, theme.name === 'night')
	}, [theme.name, status])
	return { element, editor, status }
}

function applyDatabaseEditorTheme(monaco: typeof Monaco, element: HTMLElement, dark: boolean) {
	const css = getComputedStyle(element)
	const color = (name: string) =>
		css
			.getPropertyValue(name)
			.trim()
			.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3')
	monaco.editor.defineTheme('database-sql', {
		base: dark ? 'vs-dark' : 'vs',
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
}
