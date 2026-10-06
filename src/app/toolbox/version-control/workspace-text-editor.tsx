'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { useTimeTheme } from '@/components/time-theme-provider'
import { loadWorkspaceMonaco } from '@/lib/version-control/monaco-runtime'
import { diffThemes, type DiffThemeDefinition } from './diff-themes'

type Props = { path: string; value: string; onChange: (value: string) => void; onSave: () => void; disabled: boolean }

export function WorkspaceTextEditor(props: Props) {
	const { theme } = useTimeTheme()
	const colors = diffThemes[theme.name]
	const container = useRef<HTMLDivElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
	const monaco = useRef<typeof Monaco | null>(null)
	const latest = useRef({ ...props, colors })
	latest.current = { ...props, colors }
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

	useEffect(() => {
		let disposed = false
		let cleanup: (() => void) | undefined
		setStatus('loading')
		void loadWorkspaceMonaco().then(runtime => {
			if (disposed || !container.current) return
			const current = latest.current
			const name = props.path.split('/').at(-1)?.toLowerCase() || ''
			const language = runtime.languages.getLanguages().find(language =>
				language.filenames?.some(filename => filename.toLowerCase() === name) || language.extensions?.some(extension => name.endsWith(extension.toLowerCase()))
			)?.id || 'plaintext'
			const uri = runtime.Uri.from({ scheme: 'inmemory', authority: crypto.randomUUID(), path: `/${props.path}` })
			const model = runtime.editor.createModel(current.value, language, uri)
			cleanup = () => model.dispose()
			applyTheme(runtime, current.colors)
			const instance = runtime.editor.create(container.current, {
				model, theme: 'workspace-editor', automaticLayout: true, readOnly: current.disabled,
				wordWrap: 'on', minimap: { enabled: false }, fontSize: 13, lineHeight: 24,
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
				padding: { top: 16, bottom: 16 }, scrollBeyondLastLine: false,
				find: { addExtraSpaceOnTop: false }, ariaLabel: `编辑 ${props.path}`
			})
			editor.current = instance
			monaco.current = runtime
			const subscription = instance.onDidChangeModelContent(() => {
				const value = instance.getValue()
				if (value !== latest.current.value) latest.current.onChange(value)
			})
			instance.addCommand(runtime.KeyMod.CtrlCmd | runtime.KeyCode.KeyS, () => {
				if (!latest.current.disabled) latest.current.onSave()
			})
			cleanup = () => { subscription.dispose(); instance.dispose(); model.dispose() }
			setStatus('ready')
		}).catch(() => { if (!disposed) { cleanup?.(); cleanup = undefined; setStatus('error') } })
		return () => { disposed = true; cleanup?.(); editor.current = null; monaco.current = null }
	}, [props.path])

	useEffect(() => { editor.current?.updateOptions({ readOnly: props.disabled }) }, [props.disabled])
	useEffect(() => {
		if (editor.current && editor.current.getValue() !== props.value) editor.current.setValue(props.value)
	}, [props.value])
	useEffect(() => { if (monaco.current) applyTheme(monaco.current, colors) }, [colors])

	return <div className='relative min-h-0 flex-1 overflow-hidden'>
		<div ref={container} className='absolute inset-0' />
		{status !== 'ready' && <div role={status === 'error' ? 'alert' : 'status'} className='text-secondary absolute inset-0 flex items-center justify-center px-6 text-center text-xs'>
			{status === 'error' ? 'Monaco CDN 加载失败，请检查网络后重新打开页面。' : '正在加载编辑器…'}
		</div>}
	</div>
}

function applyTheme(monaco: typeof Monaco, colors: DiffThemeDefinition) {
	monaco.editor.defineTheme('workspace-editor', {
		base: colors.type === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules: [],
		colors: {
			'editor.background': '#00000000', 'editorGutter.background': '#00000000',
			'editor.foreground': colors.foreground, 'editorLineNumber.foreground': `${colors.foreground}80`,
			'editorLineNumber.activeForeground': colors.foreground,
			'editor.lineHighlightBackground': `${colors.foreground}0a`, 'editor.lineHighlightBorder': '#00000000',
			'editorWidget.background': colors.background, 'editorWidget.foreground': colors.foreground,
			'editorWidget.border': `${colors.foreground}30`, 'input.background': `${colors.foreground}12`
		}
	})
	monaco.editor.setTheme('workspace-editor')
}
