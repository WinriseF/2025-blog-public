'use client'

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileWarning, LoaderCircle } from 'lucide-react'
import { buildDiffMetadata, type DiffRenderRequest, type DiffRenderResponse, type DiffViewerSource } from '@/lib/version-control/diff-renderer'
import type { DiffFile } from '@/lib/version-control/types'
import type { DiffThemeDefinition } from './diff-themes'

export function PierreDiffViewer({
	file,
	source,
	modelKey,
	theme,
	sideBySide,
	changesOnly
}: {
	file: DiffFile
	source: DiffViewerSource | null
	modelKey: string
	theme: DiffThemeDefinition
	sideBySide: boolean
	changesOnly: boolean
}) {
	const [metadata, setMetadata] = useState<FileDiffMetadata | null>(null)
	const [error, setError] = useState<string | null>(null)
	const requestId = useRef(0)

	useEffect(() => {
		const id = ++requestId.current
		setMetadata(null)
		setError(null)
		if (!source) return
		let disposed = false
		let worker: Worker | null = null
		let usedFallback = false
		const request: DiffRenderRequest = { id, modelKey, file, source }
		const accept = (response: DiffRenderResponse) => {
			if (disposed || response.id !== requestId.current) return
			worker?.terminate()
			worker = null
			if (response.type === 'success') setMetadata(response.metadata)
			else setError(response.error)
		}
		const fallback = () => {
			if (disposed || usedFallback) return
			usedFallback = true
			worker?.terminate()
			worker = null
			try {
				accept({ id, type: 'success', metadata: buildDiffMetadata(request) })
			} catch (cause) {
				accept({ id, type: 'error', error: cause instanceof Error ? cause.message : 'Diff 解析失败' })
			}
		}
		try {
			worker = new Worker(new URL('../../../lib/version-control/diff-render.worker.ts', import.meta.url))
			worker.onmessage = (event: MessageEvent<DiffRenderResponse>) => accept(event.data)
			worker.onerror = event => {
				event.preventDefault()
				fallback()
			}
			worker.postMessage(request)
		} catch {
			fallback()
		}
		return () => {
			disposed = true
			worker?.terminate()
		}
	}, [file, modelKey, source])

	const options = useMemo(
		() => ({
			diffStyle: sideBySide ? ('split' as const) : ('unified' as const),
			diffIndicators: 'bars' as const,
			lineDiffType: 'word-alt' as const,
			overflow: 'wrap' as const,
			hunkSeparators: 'line-info' as const,
			stickyHeader: true,
			expandUnchanged: !changesOnly,
			disableErrorHandling: true,
			theme: theme.shiki,
			themeType: theme.type
		}),
		[changesOnly, sideBySide, theme.shiki, theme.type]
	)

	if (error) return <ViewerState error={error} />
	if (!source || !metadata) return <ViewerState />
	const emptyMessage = metadata.hunks.length ? null : emptyText(file, metadata)

	return (
		<DiffErrorBoundary key={modelKey} resetKey={theme.shiki}>
			<Virtualizer
				className='h-full overflow-auto [background-color:var(--diff-background)]'
				contentClassName='min-h-full p-3'>
				<div className='rounded-lg border [background-color:var(--diff-background)] [border-color:var(--diff-border)]'>
					<FileDiff
						fileDiff={metadata}
						options={options}
						disableWorkerPool
						renderHeaderMetadata={() => <HeaderMetadata file={file} />}
					/>
					{emptyMessage && (
						<div className='border-t px-5 py-10 text-center text-xs [border-color:var(--diff-border)] [color:var(--diff-muted)]'>
							{emptyMessage}
						</div>
					)}
				</div>
			</Virtualizer>
		</DiffErrorBoundary>
	)
}

function HeaderMetadata({ file }: { file: DiffFile }) {
	return (
		<span className='flex items-center gap-2 text-[11px] [color:var(--diff-muted)]'>
			<span className='rounded px-1.5 py-0.5 font-sans font-medium [background-color:var(--diff-active)] [color:var(--diff-foreground)]'>{file.status}</span>
			{file.propertiesChanged && <span className='font-sans'>属性</span>}
		</span>
	)
}

function ViewerState({ error }: { error?: string }) {
	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 text-xs [background-color:var(--diff-background)] [color:var(--diff-muted)]'>
			{error ? <FileWarning size={24} className='text-red-500' /> : <LoaderCircle size={20} className='animate-spin opacity-60' />}
			<p className='max-w-xl px-8 text-center'>{error || '正在准备差异…'}</p>
		</div>
	)
}

function emptyText(file: DiffFile, metadata: FileDiffMetadata) {
	if (file.propertiesChanged) return '仅包含 SVN 属性变更，没有文本内容变化。'
	if (metadata.type === 'rename-pure') return '文件仅重命名，内容未变化。'
	return '没有可显示的文本变化。'
}

class DiffErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
	state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
		if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
	}
	render() {
		return this.state.failed ? <ViewerState error='差异渲染失败，请切换主题或重新打开文件。' /> : this.props.children
	}
}
