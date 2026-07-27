'use client'

import { loader } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'

type Monaco = typeof import('monaco-editor')

export function MonacoDiffViewer({
	original,
	modified,
	language,
	modelKey,
	night,
	sideBySide,
	onError
}: {
	original: string | null
	modified: string | null
	language: string
	modelKey: string
	night: boolean
	sideBySide: boolean
	onError: (message: string) => void
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const monacoRef = useRef<Monaco | null>(null)
	const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let disposed = false
		void loader
			.init()
			.then(monaco => {
				if (disposed || !hostRef.current) return
				monacoRef.current = monaco
				editorRef.current = monaco.editor.createDiffEditor(hostRef.current, {
					readOnly: true,
					originalEditable: false,
					renderSideBySide: sideBySide,
					diffAlgorithm: 'advanced',
					maxComputationTime: 30_000,
					maxFileSize: 3,
					minimap: { enabled: false },
					fontSize: 12,
					wordWrap: 'off',
					diffWordWrap: 'off',
					automaticLayout: true,
					scrollBeyondLastLine: false,
					renderOverviewRuler: false
				})
				monaco.editor.setTheme(night ? 'vs-dark' : 'light')
				setReady(true)
			})
			.catch(cause => {
				if (!disposed) onError(cause instanceof Error ? cause.message : String(cause))
			})
		return () => {
			disposed = true
			const instance = editorRef.current
			const models = instance?.getModel()
			instance?.setModel(null)
			instance?.dispose()
			models?.original.dispose()
			models?.modified.dispose()
			editorRef.current = null
			monacoRef.current = null
		}
	}, [])

	useEffect(() => {
		const instance = editorRef.current
		const monaco = monacoRef.current
		if (!ready || !instance || !monaco || original === null || modified === null) return
		const previous = instance.getModel()
		const next = {
			original: monaco.editor.createModel(original, language),
			modified: monaco.editor.createModel(modified, language)
		}
		instance.setModel(next)
		previous?.original.dispose()
		previous?.modified.dispose()
	}, [language, modelKey, modified, original, ready])

	useEffect(() => {
		editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
	}, [sideBySide])

	useEffect(() => {
		monacoRef.current?.editor.setTheme(night ? 'vs-dark' : 'light')
	}, [night])

	return (
		<div className='relative h-full'>
			<div ref={hostRef} className='h-full' />
			{(!ready || original === null || modified === null) && (
				<div className='bg-article text-secondary absolute inset-0 flex items-center justify-center text-xs'>正在读取本机源码流…</div>
			)}
		</div>
	)
}
