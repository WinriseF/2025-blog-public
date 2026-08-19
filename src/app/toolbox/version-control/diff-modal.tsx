'use client'

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ReactNode
} from 'react'
import { Check, Columns2, Copy, FileWarning, Palette, Rows3, SunMoon, X } from 'lucide-react'
import { useTimeTheme } from '@/components/time-theme-provider'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { DiffViewerSource } from '@/lib/version-control/diff-renderer'
import type { ConflictPerspective, PreviewContent } from '@/lib/version-control/types'
import {
	diffThemes,
	getNextOfficialDiffTheme,
	getNextTimeDiffTheme,
	isOfficialDiffTheme,
	createDiffThemeStyle,
	type DiffThemeId
} from './diff-themes'
import { PierreDiffViewer } from './pierre-diff-viewer'

const perspectives: Array<{ value: ConflictPerspective; label: string }> = [
	{ value: 'base-to-ours', label: 'Base → Ours' },
	{ value: 'base-to-theirs', label: 'Base → Theirs' },
	{ value: 'ours-to-theirs', label: 'Ours → Theirs' },
	{ value: 'head-to-working', label: 'HEAD → 工作文件' }
]

export function DiffModal() {
	const activeFile = useVersionControlStore(state => state.activeFile)
	const repository = useVersionControlStore(state => state.repository)
	const diff = useVersionControlStore(state => state.diff)
	const repositoryKind = useVersionControlStore(state => state.overview?.repositoryKind)
	const perspective = useVersionControlStore(state => state.conflictPerspective)
	const setPerspective = useVersionControlStore(state => state.setPerspective)
	const close = useVersionControlStore(state => state.openFile)
	const { theme: siteTheme } = useTimeTheme()
	const [preview, setPreview] = useState<{ key: string; content: PreviewContent } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [sideBySide, setSideBySide] = useState(true)
	const [changesOnly, setChangesOnly] = useState(true)
	const [copied, setCopied] = useState(false)
	const [themeOverride, setThemeOverride] = useState<DiffThemeId | null>(null)
	const request = useRef(0)
	const patchSource = repositoryKind === 'svn' || repository?.source === 'github-rest'
	const defaultToPatch = patchSource && Boolean(activeFile && !activeFile.isBinary && activeFile.nodeKind !== 'dir' && (repository?.source === 'github-rest' || activeFile.previewTooLarge))
	const previewMode = patchSource && changesOnly ? 'patch' : 'full'
	const themeId = themeOverride ?? siteTheme.name
	const diffTheme = diffThemes[themeId]
	const themeStyle = useMemo(() => createDiffThemeStyle(diffTheme), [diffTheme])
	const officialTheme = isOfficialDiffTheme(themeId)
	const nextOfficialTheme = getNextOfficialDiffTheme(themeId)
	const nextTimeTheme = isOfficialDiffTheme(themeId) ? siteTheme.name : getNextTimeDiffTheme(themeId)
	const officialTitle = officialTheme
		? `当前：${diffTheme.label}（${diffTheme.shiki}）；点击切换到${diffThemes[nextOfficialTheme].label}`
		: `切换到${diffThemes[nextOfficialTheme].label}（${diffThemes[nextOfficialTheme].shiki}）`
	const timeTitle = officialTheme
		? `返回并跟随网站当前主题：${diffThemes[siteTheme.name].label}（${diffThemes[siteTheme.name].shiki}）`
		: `当前：${diffTheme.label}（${diffTheme.shiki}）${themeOverride === null ? '，跟随网站' : ''}；点击切换到${diffThemes[nextTimeTheme].label}`

	const cycleOfficialTheme = () => {
		setThemeOverride(current => {
			const activeTheme = current ?? siteTheme.name
			return getNextOfficialDiffTheme(activeTheme)
		})
	}
	const cycleTimeTheme = () => {
		setThemeOverride(current => {
			const activeTheme = current ?? siteTheme.name
			if (isOfficialDiffTheme(activeTheme)) return null
			const nextTheme = getNextTimeDiffTheme(activeTheme)
			return nextTheme === siteTheme.name ? null : nextTheme
		})
	}

	useEffect(() => {
		if (defaultToPatch) setChangesOnly(true)
	}, [activeFile?.fileId, defaultToPatch])

	useEffect(() => {
		const current = ++request.current
		setPreview(null)
		setError(null)
		if (!activeFile || !repository || !diff || activeFile.isBinary || activeFile.nodeKind === 'dir' || (previewMode === 'full' && activeFile.previewTooLarge)) return
		const key = previewKey(diff.diffId, activeFile.fileId, perspective, previewMode)
		const timer = window.setTimeout(() => {
			void repository
				.openPreview(diff.diffId, activeFile.fileId, perspective, previewMode)
				.then(value => {
					if (request.current === current) setPreview({ key, content: value })
				})
				.catch(cause => {
					if (request.current === current) setError(cause instanceof Error ? cause.message : String(cause))
				})
		}, 70)
		return () => window.clearTimeout(timer)
	}, [activeFile, diff, perspective, previewMode, repository])

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

	const modelKey = previewKey(diff?.diffId || 'none', activeFile?.fileId ?? -1, perspective, previewMode)
	const currentPreview = preview?.key === modelKey ? preview.content : null
	const currentMode = currentPreview?.mode || previewMode
	const source = useMemo<DiffViewerSource | null>(() => {
		if (!currentPreview) return null
		return currentMode === 'patch'
			? { kind: 'patch', patch: currentPreview.original }
			: { kind: 'files', original: currentPreview.original, modified: currentPreview.modified }
	}, [currentMode, currentPreview])

	if (!activeFile) return null
	const unavailable = activeFile.isBinary
		? '二进制文件仅展示元数据，不加载正文。'
		: activeFile.nodeKind === 'dir'
			? '目录变更不包含可显示的文件正文。'
			: activeFile.previewTooLarge && previewMode === 'full'
				? repositoryKind === 'svn'
					? '文件超过单侧 2MiB 完整预览上限，请切换到「仅变更」查看 Patch。'
					: '文件超过单侧 2MiB 预览上限，可在未超过导出上限时完整导出。'
				: null
	const copyTitle = currentMode === 'patch' ? '复制 Patch' : isDeleted(activeFile.status) ? '复制旧版本源码' : '复制新版本源码'
	const copy = async () => {
		if (!currentPreview) return
		const value = currentMode === 'patch' ? currentPreview.original : isDeleted(activeFile.status) ? currentPreview.original : currentPreview.modified
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1200)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : '复制失败')
		}
	}

	return (
		<div className='fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-5' onMouseDown={event => event.target === event.currentTarget && close(null)}>
			<section
				role='dialog'
				aria-modal='true'
				aria-label='文件差异'
				style={themeStyle}
				className='flex h-[min(900px,94dvh)] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-xl border shadow-2xl transition-colors [background-color:var(--diff-background)] [border-color:var(--diff-border)] [color:var(--diff-foreground)]'>
				<header className='flex min-h-12 items-center gap-2 border-b px-3 transition-colors [background-color:var(--diff-background)] [border-color:var(--diff-border)]'>
					<span className='mr-auto rounded-md border px-2 py-1 text-[10px] font-medium tracking-wide uppercase [background-color:var(--diff-subtle)] [border-color:var(--diff-border)] [color:var(--diff-muted)]'>
						Read only
					</span>
					{activeFile.hasConflictViews && (
						<select
							value={perspective}
							onChange={event => setPerspective(event.target.value as ConflictPerspective)}
							aria-label='冲突比较视角'
							className='h-8 rounded-md border px-2 text-[11px] [background-color:var(--diff-subtle)] [border-color:var(--diff-border)] [color:var(--diff-foreground)]'>
							{perspectives.map(item => (
								<option key={item.value} value={item.value}>
									{item.label}
								</option>
							))}
						</select>
					)}
					<Segment>
						<SegmentButton
							active={officialTheme}
							onClick={cycleOfficialTheme}
							title={officialTitle}
							aria-label={officialTitle}
							className='w-[68px] justify-center max-xl:w-7 max-xl:px-0'>
							<SunMoon size={14} />
							<span className='max-xl:hidden'>{officialTheme ? diffTheme.label : '官方'}</span>
						</SegmentButton>
						<SegmentButton
							active={!officialTheme}
							onClick={cycleTimeTheme}
							title={timeTitle}
							aria-label={timeTitle}
							className='w-[68px] justify-center max-xl:w-7 max-xl:px-0'>
							<Palette size={14} />
							<span className='max-xl:hidden'>{officialTheme ? '四时' : diffTheme.label}</span>
							{!officialTheme && themeOverride === null && (
								<span className='size-1 rounded-full max-xl:hidden' style={{ backgroundColor: siteTheme.colors.brand }} aria-hidden='true' />
							)}
						</SegmentButton>
					</Segment>
					<Segment>
						<SegmentButton active={changesOnly} onClick={() => setChangesOnly(true)}>
							仅变更
						</SegmentButton>
						<SegmentButton active={!changesOnly} onClick={() => setChangesOnly(false)}>
							完整文件
						</SegmentButton>
					</Segment>
					<Segment>
						<SegmentButton active={sideBySide} onClick={() => setSideBySide(true)} title='左右分栏'>
							<Columns2 size={14} />
							Split
						</SegmentButton>
						<SegmentButton active={!sideBySide} onClick={() => setSideBySide(false)} title='统一视图'>
							<Rows3 size={14} />
							Unified
						</SegmentButton>
					</Segment>
					<button
						type='button'
						onClick={() => void copy()}
						disabled={!currentPreview || Boolean(unavailable || error)}
						title={copyTitle}
						aria-label={copyTitle}
						className={iconButton()}>
						{copied ? <Check size={15} /> : <Copy size={15} />}
					</button>
					<button type='button' onClick={() => close(null)} title='关闭' aria-label='关闭' className={iconButton()}>
						<X size={17} />
					</button>
				</header>
				<div className='min-h-0 flex-1'>
					{unavailable || error ? (
						<ModalState message={unavailable || error || ''} file={activeFile} />
					) : (
						<PierreDiffViewer
							file={activeFile}
							source={source}
							modelKey={modelKey}
							theme={diffTheme}
							sideBySide={sideBySide}
							changesOnly={changesOnly}
						/>
					)}
				</div>
			</section>
		</div>
	)
}

function Segment({ children }: { children: ReactNode }) {
	return <div className='flex h-8 items-center rounded-md border p-0.5 [background-color:var(--diff-subtle)] [border-color:var(--diff-border)]'>{children}</div>
}

function SegmentButton({ active, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
	return (
		<button
			{...props}
			type='button'
			aria-pressed={active}
			className={`flex h-6 items-center gap-1.5 whitespace-nowrap rounded px-2 text-[11px] transition ${active ? 'shadow-sm [background-color:var(--diff-active)] [color:var(--diff-foreground)]' : '[color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'} ${className}`}>
			{children}
		</button>
	)
}

function ModalState({ message, file }: { message: string; file: { additions: number; deletions: number; status: string } }) {
	return (
		<div className='flex h-full flex-col items-center justify-center [background-color:var(--diff-background)] [color:var(--diff-muted)]'>
			<FileWarning className='mb-4 text-amber-500' size={28} />
			<p className='max-w-xl px-8 text-center text-sm'>{message}</p>
			<div className='mt-4 flex gap-5 font-mono text-xs'>
				<span className='text-emerald-500'>+{file.additions}</span>
				<span className='text-red-500'>−{file.deletions}</span>
				<span>{file.status}</span>
			</div>
		</div>
	)
}

function iconButton() {
	return 'flex size-8 items-center justify-center rounded-md border transition disabled:opacity-25 [border-color:var(--diff-border)] [color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'
}

function previewKey(diffId: string, fileId: number, perspective: ConflictPerspective, mode: 'full' | 'patch') {
	return `${diffId}:${fileId}:${perspective}:${mode}`
}

function isDeleted(status: string) {
	return status === 'Deleted' || status === 'Missing'
}
