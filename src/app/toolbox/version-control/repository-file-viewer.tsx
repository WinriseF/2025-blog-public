'use client'

import { File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, FileCode2, FileWarning, Loader2, RotateCcw } from 'lucide-react'
import { useTimeTheme } from '@/components/time-theme-provider'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryFileContent, RepositoryTreeEntry } from '@/lib/version-control/types'
import { ImagePreviewDialog } from '../image-preview-dialog'
import { createDiffThemeStyle, diffThemes } from './diff-themes'

type FileState =
	| { status: 'idle' | 'loading' }
	| { status: 'ready'; file: RepositoryFileContent; version: number }
	| { status: 'unavailable'; message: string }
	| { status: 'error'; message: string }

export function RepositoryFileViewer({ entry }: { entry: RepositoryTreeEntry | null }) {
	const repository = useVersionControlStore(state => state.repository)
	const overview = useVersionControlStore(state => state.overview)
	const { theme: siteTheme } = useTimeTheme()
	const [state, setState] = useState<FileState>({ status: 'idle' })
	const [reload, setReload] = useState(0)
	const [copied, setCopied] = useState(false)
	const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
	const generation = useRef(0)
	const imageUrl = entry?.kind === 'file' && isImagePath(entry.path) ? repository?.getRepositoryImageUrl?.(entry.path) || null : null

	useEffect(() => {
		const request = ++generation.current
		setCopied(false)
		setImagePreviewOpen(false)
		if (!entry || !repository) {
			setState({ status: 'idle' })
			return
		}
		if (entry.kind !== 'file') {
			setState({ status: 'unavailable', message: entry.kind === 'submodule' ? '子模块不提供源码预览' : '符号链接不提供源码预览' })
			return
		}
		if (imageUrl) {
			setState({ status: 'idle' })
			return
		}
		if (entry.isBinary) {
			setState({ status: 'unavailable', message: '二进制文件无法在线预览' })
			return
		}
		setState({ status: 'loading' })
		void repository
			.openRepositoryFile(entry.path)
			.then(file => {
				if (request === generation.current) setState({ status: 'ready', file, version: request })
			})
			.catch(error => {
				if (request === generation.current) setState({ status: 'error', message: previewError(error) })
			})
	}, [entry, imageUrl, overview, reload, repository])

	const lineCount = useMemo(() => (state.status === 'ready' ? Math.max(1, state.file.content.split('\n').length) : 0), [state])
	const diffTheme = diffThemes[siteTheme.name]
	const themeStyle = useMemo(() => createDiffThemeStyle(diffTheme), [diffTheme])
	const source = useMemo<FileContents | null>(() => {
		if (state.status !== 'ready' || state.file.path !== entry?.path) return null
		return {
			name: state.file.path,
			contents: state.file.content,
			cacheKey: `${repository?.key}:${state.file.path}:${state.version}:${contentKey(state.file.content)}`
		}
	}, [entry?.path, repository?.key, state])
	const fileOptions = useMemo(
		() => ({
			theme: diffTheme.shiki,
			themeType: diffTheme.type,
			overflow: 'scroll' as const,
			disableFileHeader: true,
			stickyHeader: false
		}),
		[diffTheme.shiki, diffTheme.type]
	)
	const sourceLabel = repository?.source === 'github-rest' ? overview?.currentBranch || 'HEAD' : overview?.isBare ? 'HEAD' : '工作区'

	if (!entry)
		return (
			<section className='bg-background flex h-full items-center justify-center'>
				<div className='text-secondary flex flex-col items-center text-center'>
					<div className='border-border bg-article/45 mb-3 flex size-12 items-center justify-center rounded-2xl border'>
						<FileCode2 size={20} className='text-brand' />
					</div>
					<p className='text-primary text-sm font-medium'>选择文件</p>
					<p className='mt-1 text-xs'>预览当前版本源码</p>
				</div>
			</section>
		)

	return (
		<section style={themeStyle} className='flex h-full min-w-0 flex-col overflow-hidden [background-color:var(--diff-background)] [color:var(--diff-foreground)]'>
			<header className='flex h-12 shrink-0 items-center gap-2 border-b px-4 [background-color:var(--diff-background)] [border-color:var(--diff-border)]'>
				<FileCode2 size={15} className='text-brand shrink-0' />
				<span title={entry.path} className='min-w-0 flex-1 truncate font-mono text-xs'>{entry.path}</span>
				<span className='shrink-0 rounded-md border px-2 py-0.5 font-mono text-[9px] [background-color:var(--diff-subtle)] [border-color:var(--diff-border)] [color:var(--diff-muted)]'>{sourceLabel}</span>
				{state.status === 'ready' && !imageUrl && (
					<>
						<span className='hidden shrink-0 text-[10px] [color:var(--diff-muted)] sm:inline'>{formatBytes(state.file.size)} · {lineCount} 行</span>
						<button
							onClick={() => {
								void navigator.clipboard.writeText(state.file.content).then(() => {
									setCopied(true)
									window.setTimeout(() => setCopied(false), 1200)
								})
							}}
							title='复制文件'
							className='flex size-7 shrink-0 items-center justify-center rounded-md transition [color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'>
							{copied ? <Check size={13} className='text-emerald-400' /> : <Clipboard size={13} />}
						</button>
					</>
				)}
			</header>

			{imageUrl ? (
				<button type='button' onClick={() => setImagePreviewOpen(true)} className='flex min-h-0 flex-1 cursor-zoom-in items-center justify-center overflow-auto [background-color:var(--diff-subtle)]'>
					<img src={imageUrl} alt={entry.name} className='block h-full w-full object-contain' />
				</button>
			) : state.status === 'loading' ? (
				<ViewerState><Loader2 size={17} className='text-brand animate-spin' />正在读取文件…</ViewerState>
			) : state.status === 'unavailable' ? (
				<ViewerState><FileWarning size={18} />{state.message}</ViewerState>
			) : state.status === 'error' ? (
				<ViewerState>
					<FileWarning size={18} className='text-orange-300' />
					<span>{state.message}</span>
					<button onClick={() => setReload(value => value + 1)} className='border-border bg-article/60 hover:text-primary mt-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px]'>
						<RotateCcw size={11} /> 重试
					</button>
				</ViewerState>
			) : state.status === 'ready' ? (
				source ? (
					<Virtualizer className='min-h-0 flex-1 overflow-auto [background-color:var(--diff-background)]' contentClassName='min-h-full'>
						<PierreFile file={source} options={fileOptions} />
					</Virtualizer>
				) : null
			) : null}
			{imagePreviewOpen && imageUrl && <ImagePreviewDialog src={imageUrl} alt={entry.name} onClose={() => setImagePreviewOpen(false)} />}
		</section>
	)
}

function ViewerState({ children }: { children: React.ReactNode }) {
	return <div className='text-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs'>{children}</div>
}

function previewError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	if (/binary/i.test(message)) return '二进制文件无法在线预览'
	if (/too large|2 MiB/i.test(message)) return '文件超过 2 MiB，无法在线预览'
	if (/UTF-8/i.test(message)) return '仅支持预览 UTF-8 文本文件'
	return message
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function contentKey(content: string) {
	let hash = 2166136261
	for (let index = 0; index < content.length; index += 1) hash = Math.imul(hash ^ content.charCodeAt(index), 16777619)
	return `${content.length}:${hash >>> 0}`
}

function isImagePath(path: string) {
	return /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)
}
