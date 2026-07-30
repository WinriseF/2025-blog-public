'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Columns2, Copy, FileWarning, Rows3, X } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { ConflictPerspective, PreviewContent } from '@/lib/version-control/types'
import { MonacoDiffViewer } from './monaco-diff-viewer'
import { PatchDiffViewer } from './patch-diff-viewer'

const perspectives: Array<{ value: ConflictPerspective; label: string }> = [
	{ value: 'base-to-ours', label: 'Base → Ours' },
	{ value: 'base-to-theirs', label: 'Base → Theirs' },
	{ value: 'ours-to-theirs', label: 'Ours → Theirs' },
	{ value: 'head-to-working', label: 'HEAD → 工作文件' }
]

export function DiffModal() {
	const activeFile = useVersionControlStore(state => state.activeFile)
	const bridge = useVersionControlStore(state => state.bridge)
	const repositoryId = useVersionControlStore(state => state.repositoryId)
	const diff = useVersionControlStore(state => state.diff)
	const repositoryKind = useVersionControlStore(state => state.overview?.repositoryKind)
	const perspective = useVersionControlStore(state => state.conflictPerspective)
	const setPerspective = useVersionControlStore(state => state.setPerspective)
	const close = useVersionControlStore(state => state.openFile)
	const [preview, setPreview] = useState<{ key: string; content: PreviewContent } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [sideBySide, setSideBySide] = useState(true)
	const [reviewOnly, setReviewOnly] = useState(true)
	const [copied, setCopied] = useState(false)
	const request = useRef(0)
	const [night, setNight] = useState(false)

	useEffect(() => {
		const root = document.documentElement
		const update = () => setNight(root.dataset.timeTheme === 'night')
		update()
		const observer = new MutationObserver(update)
		observer.observe(root, { attributes: true, attributeFilter: ['data-time-theme'] })
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		const current = ++request.current
		setPreview(null)
		setError(null)
		const patchMode = repositoryKind === 'svn' && reviewOnly
		if (!activeFile || !bridge || !repositoryId || !diff || activeFile.isBinary || (!patchMode && activeFile.previewTooLarge)) return
		const mode = patchMode ? 'patch' : 'full'
		const key = previewKey(diff.diffId, activeFile.fileId, perspective, mode)
		const timer = window.setTimeout(() => {
			void bridge
				.openPreview(repositoryId, diff.diffId, activeFile.fileId, perspective, mode)
				.then(value => {
					if (request.current === current) setPreview({ key, content: value })
				})
				.catch(cause => {
					if (request.current === current) setError(cause instanceof Error ? cause.message : String(cause))
				})
		}, 70)
		return () => window.clearTimeout(timer)
	}, [activeFile, bridge, diff, perspective, repositoryId, repositoryKind, reviewOnly])

	useEffect(() => {
		if (!activeFile) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation()
				close(null)
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [activeFile, close])

	if (!activeFile) return null
	const patchMode = repositoryKind === 'svn' && reviewOnly
	const mode = patchMode ? 'patch' : 'full'
	const modelKey = previewKey(diff?.diffId || 'none', activeFile.fileId, perspective, mode)
	const currentPreview = preview?.key === modelKey ? preview.content : null
	const unavailable = activeFile.isBinary
		? '二进制文件仅展示元数据，不加载正文。'
		: activeFile.previewTooLarge && !patchMode
			? '文件超过单侧 2MiB 预览上限，可在未超过导出上限时完整导出。'
			: null
	const copy = async () => {
		if (!currentPreview) return
		const value = patchMode
			? currentPreview.original
			: `--- a/${activeFile.oldPath || activeFile.path}\n+++ b/${activeFile.path}\n${currentPreview.modified}`
		await navigator.clipboard.writeText(value)
		setCopied(true)
		window.setTimeout(() => setCopied(false), 1200)
	}

	return (
		<div
			className='fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm'
			onMouseDown={event => event.target === event.currentTarget && close(null)}>
			<section className='border-border bg-background flex h-[min(900px,94dvh)] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-xl border shadow-2xl'>
				<header className='border-border bg-article flex min-h-14 items-center gap-3 border-b px-4'>
					<span className='min-w-0 flex-1 truncate font-mono text-xs'>
						{activeFile.oldPath && activeFile.oldPath !== activeFile.path ? `${activeFile.oldPath} → ` : ''}
						{activeFile.path}
					</span>
					{activeFile.hasConflictViews && (
						<select
							value={perspective}
							onChange={event => setPerspective(event.target.value as ConflictPerspective)}
							className='border-border bg-background rounded border px-2 py-1.5 text-[11px]'>
							{perspectives.map(item => (
								<option key={item.value} value={item.value}>
									{item.label}
								</option>
							))}
						</select>
					)}
					<button
						onClick={() => setReviewOnly(value => !value)}
						title={reviewOnly ? '显示完整文件' : '折叠未修改区域'}
						className={`border-border rounded border px-2.5 py-2 text-[11px] ${reviewOnly ? 'bg-brand/10 text-brand' : 'text-secondary hover:text-primary'}`}>
						{reviewOnly ? '仅变更' : '完整文件'}
					</button>
					<button
						onClick={() => setSideBySide(value => !value)}
						title='切换布局'
						className='border-border text-secondary hover:text-primary rounded border p-2'>
						{sideBySide ? <Columns2 size={15} /> : <Rows3 size={15} />}
					</button>
					<button
						onClick={() => void copy()}
						disabled={!currentPreview}
						className='border-border text-secondary hover:text-primary rounded border p-2 disabled:opacity-30'>
						{copied ? <Check size={15} /> : <Copy size={15} />}
					</button>
					<button onClick={() => close(null)} className='text-secondary hover:text-primary p-2'>
						<X size={18} />
					</button>
				</header>
				<div className='min-h-0 flex-1'>
					{unavailable || error ? (
						<div className='text-secondary flex h-full flex-col items-center justify-center'>
							<FileWarning className='mb-4 text-amber-300' size={32} />
							<p>{unavailable || error}</p>
							<div className='mt-4 flex gap-5 font-mono text-xs'>
								<span>+{activeFile.additions}</span>
								<span>−{activeFile.deletions}</span>
								<span>{activeFile.status}</span>
							</div>
						</div>
					) : patchMode ? (
						<PatchDiffViewer patch={currentPreview?.original ?? null} sideBySide={sideBySide} />
					) : (
						<MonacoDiffViewer
							original={currentPreview?.original ?? null}
							modified={currentPreview?.modified ?? null}
							language={language(activeFile.path)}
							modelKey={modelKey}
							night={night}
							sideBySide={sideBySide}
							reviewOnly={reviewOnly}
							onError={setError}
						/>
					)}
				</div>
				<footer className='border-border bg-article text-secondary flex h-8 items-center border-t px-4 font-mono text-[10px]'>
					<span>READ ONLY</span>
					<span className='ml-auto'>Esc 关闭 · {reviewOnly ? 'CHANGES ONLY' : 'FULL FILE'} · {sideBySide ? 'SIDE BY SIDE' : 'UNIFIED'}</span>
				</footer>
			</section>
		</div>
	)
}

function previewKey(diffId: string, fileId: number, perspective: ConflictPerspective, mode: 'full' | 'patch') {
	return `${diffId}:${fileId}:${perspective}:${mode}`
}
function language(path: string) {
	const ext = path.split('.').pop()?.toLowerCase()
	return (
		(
			{
				ts: 'typescript',
				tsx: 'typescript',
				js: 'javascript',
				jsx: 'javascript',
				rs: 'rust',
				py: 'python',
				json: 'json',
				md: 'markdown',
				css: 'css',
				html: 'html',
				xml: 'xml',
				yml: 'yaml',
				yaml: 'yaml',
				toml: 'ini',
				sh: 'shell'
			} as Record<string, string>
		)[ext || ''] || 'plaintext'
	)
}
