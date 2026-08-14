'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, FileCode2, FileWarning, Loader2, RotateCcw } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryFileContent, RepositoryTreeEntry } from '@/lib/version-control/types'

type FileState =
	| { status: 'idle' | 'loading' }
	| { status: 'ready'; file: RepositoryFileContent }
	| { status: 'unavailable'; message: string }
	| { status: 'error'; message: string }

export function RepositoryFileViewer({ entry }: { entry: RepositoryTreeEntry | null }) {
	const repository = useVersionControlStore(state => state.repository)
	const overview = useVersionControlStore(state => state.overview)
	const [state, setState] = useState<FileState>({ status: 'idle' })
	const [reload, setReload] = useState(0)
	const [copied, setCopied] = useState(false)
	const generation = useRef(0)

	useEffect(() => {
		const request = ++generation.current
		setCopied(false)
		if (!entry || !repository) {
			setState({ status: 'idle' })
			return
		}
		if (entry.kind !== 'file') {
			setState({ status: 'unavailable', message: entry.kind === 'submodule' ? '子模块不提供源码预览' : '符号链接不提供源码预览' })
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
				if (request === generation.current) setState({ status: 'ready', file })
			})
			.catch(error => {
				if (request === generation.current) setState({ status: 'error', message: previewError(error) })
			})
	}, [entry, overview, reload, repository])

	const lineCount = useMemo(() => (state.status === 'ready' ? Math.max(1, state.file.content.split('\n').length) : 0), [state])
	const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'), [lineCount])
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
		<section className='bg-background flex h-full min-w-0 flex-col overflow-hidden'>
			<header className='border-border bg-background/90 flex h-12 shrink-0 items-center gap-2 border-b px-4'>
				<FileCode2 size={15} className='text-brand shrink-0' />
				<span title={entry.path} className='min-w-0 flex-1 truncate font-mono text-xs'>{entry.path}</span>
				<span className='border-border bg-article/55 text-secondary shrink-0 rounded-md border px-2 py-0.5 font-mono text-[9px]'>{sourceLabel}</span>
				{state.status === 'ready' && (
					<>
						<span className='text-secondary hidden shrink-0 text-[10px] sm:inline'>{formatBytes(state.file.size)} · {lineCount} 行</span>
						<button
							onClick={() => {
								void navigator.clipboard.writeText(state.file.content).then(() => {
									setCopied(true)
									window.setTimeout(() => setCopied(false), 1200)
								})
							}}
							title='复制文件'
							className='text-secondary hover:bg-article hover:text-primary flex size-7 shrink-0 items-center justify-center rounded-md transition'>
							{copied ? <Check size={13} className='text-emerald-400' /> : <Clipboard size={13} />}
						</button>
					</>
				)}
			</header>

			{state.status === 'loading' ? (
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
				<div className='bg-article/20 min-h-0 flex-1 overflow-auto'>
					<div className='flex min-h-full min-w-max items-stretch font-mono text-[12px] leading-5'>
						<pre aria-hidden className='border-border bg-article/45 text-secondary/45 sticky left-0 z-[1] border-r px-3 py-4 text-right select-none'>{lineNumbers}</pre>
						<pre className='text-primary/90 [tab-size:4] px-4 py-4 whitespace-pre'>{state.file.content || ' '}</pre>
					</div>
				</div>
			) : null}
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
