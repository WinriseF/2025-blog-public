'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, FileWarning, Palette, Rows3, X } from 'lucide-react'
import { useTimeTheme } from '@/components/time-theme-provider'
import { normalizeCodexPatch } from '@/lib/codex-session/patch-analysis'
import type { FileChange, FilePatch } from '@/lib/codex-session/types'
import type { DiffViewerSource } from '@/lib/version-control/diff-renderer'
import type { DiffFile } from '@/lib/version-control/types'
import { diffThemes, type DiffThemeDefinition, type DiffThemeId } from '../version-control/diff-themes'
import { PierreDiffViewer } from '../version-control/pierre-diff-viewer'
import { formatDate, formatNumber } from './format'

const statusByOperation: Record<FilePatch['operation'], string> = {
	create: 'Added',
	modify: 'Modified',
	move: 'Renamed',
	delete: 'Deleted'
}

const themeOrder: DiffThemeId[] = ['dawn', 'noon', 'sunset', 'night', 'pierre-light', 'pierre-dark']

type CodexPatchModalProps = {
	file: FileChange
	onClose: () => void
}

export function CodexPatchModal({ file, onClose }: CodexPatchModalProps) {
	const [mounted, setMounted] = useState(false)
	const [sideBySide, setSideBySide] = useState(false)
	const [themeOverride, setThemeOverride] = useState<DiffThemeId | null>(null)
	const { theme: siteTheme } = useTimeTheme()
	const themeId = themeOverride ?? siteTheme.name
	const diffTheme = diffThemes[themeId]
	const themeStyle = useMemo(() => createThemeStyle(diffTheme), [diffTheme])
	const fileName = file.path.split('/').at(-1) || file.path
	const cycleTheme = () => setThemeOverride(themeOrder[(themeOrder.indexOf(themeId) + 1) % themeOrder.length])

	useEffect(() => setMounted(true), [])
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.stopPropagation()
			onClose()
		}
		document.body.style.overflow = 'hidden'
		window.addEventListener('keydown', closeOnEscape, true)
		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', closeOnEscape, true)
		}
	}, [onClose])

	if (!mounted) return null

	return createPortal(
		<div className='fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-5' onMouseDown={event => event.target === event.currentTarget && onClose()}>
			<section
				role='dialog'
				aria-modal='true'
				aria-label={`${file.path} 的全部补丁`}
				style={themeStyle}
				className='flex h-[min(900px,94dvh)] w-[min(1400px,96vw)] flex-col overflow-hidden rounded-lg border shadow-2xl [background-color:var(--diff-background)] [border-color:var(--diff-border)] [color:var(--diff-foreground)]'>
				<header className='flex shrink-0 items-start gap-3 border-b px-4 py-3 [border-color:var(--diff-border)]'>
					<div className='min-w-0 flex-1'>
						<h2 className='truncate font-mono text-sm font-semibold' title={file.path}>{fileName}</h2>
						<p className='mt-1 text-[11px] [color:var(--diff-muted)]'>{formatNumber(file.patches.length)} 个补丁</p>
					</div>
					<div className='flex h-8 shrink-0 items-center rounded-md border p-0.5 [background-color:var(--diff-subtle)] [border-color:var(--diff-border)]'>
						<button type='button' aria-pressed={!sideBySide} onClick={() => setSideBySide(false)} title='统一视图' aria-label='统一视图' className={modeButton(!sideBySide)}><Rows3 size={14} /></button>
						<button type='button' aria-pressed={sideBySide} onClick={() => setSideBySide(true)} title='左右分栏' aria-label='左右分栏' className={modeButton(sideBySide)}><Columns2 size={14} /></button>
					</div>
					<button type='button' onClick={cycleTheme} title={`当前主题：${diffTheme.label}，点击切换`} aria-label={`切换 Diff 主题，当前为${diffTheme.label}`} className='flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition [border-color:var(--diff-border)] [color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'>
						<Palette size={14} /><span className='hidden sm:inline'>{diffTheme.label}</span>
					</button>
					<button type='button' onClick={onClose} title='关闭' aria-label='关闭全部补丁' className='flex size-8 shrink-0 items-center justify-center rounded-md border transition [border-color:var(--diff-border)] [color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'>
						<X size={17} />
					</button>
				</header>
				<div className='min-h-0 flex-1 overflow-y-auto p-3 sm:p-4'>
					{file.patches.map((patch, index) => <PatchSection key={patch.id} patch={patch} number={index + 1} theme={diffTheme} sideBySide={sideBySide} />)}
				</div>
			</section>
		</div>,
		document.body
	)
}

function PatchSection({ patch, number, theme, sideBySide }: { patch: FilePatch; number: number; theme: DiffThemeDefinition; sideBySide: boolean }) {
	return <section className='border-b py-4 first:pt-0 last:border-b-0 last:pb-0 [border-color:var(--diff-border)]'>
		<header className='mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] [color:var(--diff-muted)]'>
			<h3 className='font-semibold [color:var(--diff-foreground)]'>补丁 {number}</h3>
			<span className='ml-auto'>{formatDate(patch.timestamp)}</span>
		</header>
		{patch.oldPath && <p className='mb-2 truncate px-1 font-mono text-[11px] [color:var(--diff-muted)]' title={patch.oldPath}>原路径：{patch.oldPath}</p>}
		<PatchDiff patch={patch} theme={theme} sideBySide={sideBySide} />
	</section>
}

function PatchDiff({ patch, theme, sideBySide }: { patch: FilePatch; theme: DiffThemeDefinition; sideBySide: boolean }) {
	const normalizedPatch = useMemo(() => normalizeCodexPatch(patch), [patch])
	const file = useMemo<DiffFile>(() => ({
		fileId: patch.sequence,
		path: patch.path,
		oldPath: patch.oldPath ?? null,
		status: statusByOperation[patch.operation],
		groups: [],
		additions: patch.additions,
		deletions: patch.deletions,
		isBinary: false,
		isSubmodule: false,
		previewTooLarge: false,
		exportTooLarge: false,
		hasConflictViews: false
	}), [patch])
	const source = useMemo<DiffViewerSource | null>(() => normalizedPatch ? { kind: 'patch', patch: normalizedPatch } : null, [normalizedPatch])

	if (patch.diffMode === 'fragment') return <FragmentPatch patch={patch} />
	if (patch.diffMode === 'missing' || !source) return <EmptyPatch />

	return <div style={{ height: patchViewerHeight(patch) }} className='min-h-60 max-h-[min(560px,58dvh)] overflow-hidden'>
		<PierreDiffViewer file={file} source={source} modelKey={patch.id} theme={theme} sideBySide={sideBySide} changesOnly hideFileHeader />
	</div>
}

function patchViewerHeight(patch: FilePatch) {
	const lines = patch.diff?.split(/\r?\n/).length ?? 0
	return Math.min(560, Math.max(240, 104 + lines * 22))
}

function FragmentPatch({ patch }: { patch: FilePatch }) {
	return <div className='max-h-[min(560px,58dvh)] overflow-auto border-y [background-color:var(--diff-background)] [border-color:var(--diff-border)]'>
		<p className='sticky top-0 border-b px-4 py-2 text-[11px] text-amber-500 [background-color:var(--diff-background)] [border-color:var(--diff-border)]'>Session 仅记录了无行号补丁片段，下面按原始内容展示。</p>
		<pre className='whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 [color:var(--diff-foreground)]'>{patch.diff}</pre>
	</div>
}

function EmptyPatch() {
	return <div className='flex h-40 flex-col items-center justify-center gap-3 border-y [background-color:var(--diff-background)] [border-color:var(--diff-border)] [color:var(--diff-muted)]'>
		<FileWarning size={24} className='text-amber-500' />
		<p className='text-sm'>此补丁没有记录文本差异。</p>
	</div>
}

function modeButton(active: boolean) {
	return `flex size-7 items-center justify-center rounded transition ${active ? 'shadow-sm [background-color:var(--diff-active)] [color:var(--diff-foreground)]' : '[color:var(--diff-muted)] hover:[background-color:var(--diff-hover)] hover:[color:var(--diff-foreground)]'}`
}

function createThemeStyle(theme: DiffThemeDefinition) {
	return {
		colorScheme: theme.type,
		'--diff-background': theme.background,
		'--diff-foreground': theme.foreground,
		'--diff-border': 'color-mix(in srgb, var(--diff-foreground) 14%, transparent)',
		'--diff-muted': 'color-mix(in srgb, var(--diff-foreground) 58%, transparent)',
		'--diff-subtle': 'color-mix(in srgb, var(--diff-foreground) 4%, transparent)',
		'--diff-hover': 'color-mix(in srgb, var(--diff-foreground) 7%, transparent)',
		'--diff-active': 'color-mix(in srgb, var(--diff-foreground) 11%, var(--diff-background))'
	} as CSSProperties
}
