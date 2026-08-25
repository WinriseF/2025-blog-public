'use client'

import Link from 'next/link'
import { ArrowLeft, FolderSync, GitBranch, Github, LockKeyhole, RefreshCw, Server, X } from 'lucide-react'
import { motion, useMotionValue, type MotionStyle } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryTreeEntry } from '@/lib/version-control/types'
import { CommitGraph } from './commit-graph'
import { DiffDetail } from './diff-detail'
import { DiffModal } from './diff-modal'
import { RepositoryCandidatePicker } from './repository-candidate-picker'
import { RepositoryFileViewer } from './repository-file-viewer'
import { RepositoryTree } from './repository-tree'
import type { RepositoryViewMode } from './repository-sidebar-header'

export function Workbench() {
	const containerRef = useRef<HTMLDivElement>(null)
	const dragging = useRef(false)
	const dragBounds = useRef<DOMRect | null>(null)
	const dragFrame = useRef(0)
	const pendingClientX = useRef(0)
	const graphWidth = useMotionValue('300px')
	const [viewMode, setViewMode] = useState<RepositoryViewMode>('history')
	const [mobilePanel, setMobilePanel] = useState<'browser' | 'detail'>('browser')
	const [mobileComparePicking, setMobileComparePicking] = useState(false)
	const [repositoryEntry, setRepositoryEntry] = useState<RepositoryTreeEntry | null>(null)
	const repository = useVersionControlStore(state => state.repository)
	const overview = useVersionControlStore(state => state.overview)
	const loading = useVersionControlStore(state => state.loading)
	const error = useVersionControlStore(state => state.error)
	const comparison = useVersionControlStore(state => state.comparison)
	const clearComparison = useVersionControlStore(state => state.clearComparison)
	const refresh = useVersionControlStore(state => state.refresh)
	const selectRepository = useVersionControlStore(state => state.selectRepository)
	const closeRepository = useVersionControlStore(state => state.closeRepository)
	const clearError = useVersionControlStore(state => state.clearError)
	const openDiffFile = useVersionControlStore(state => state.openFile)

	useEffect(() => {
		setViewMode('history')
		setMobilePanel('browser')
		setMobileComparePicking(false)
		setRepositoryEntry(null)
	}, [repository?.key])

	const changeViewMode = (mode: RepositoryViewMode) => {
		setViewMode(mode)
		setMobilePanel('browser')
		setMobileComparePicking(false)
		if (mode === 'files') openDiffFile(null)
	}
	const openMobileDetail = () => {
		setMobileComparePicking(false)
		setMobilePanel('detail')
	}
	const selectRepositoryEntry = (entry: RepositoryTreeEntry) => {
		setRepositoryEntry(entry)
		openMobileDetail()
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && comparison) void clearComparison()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [clearComparison, comparison])

	useEffect(() => {
		const applyDrag = () => {
			dragFrame.current = 0
			const rect = dragBounds.current
			if (!dragging.current || !rect) return
			graphWidth.set(`${Math.max(200, Math.min(pendingClientX.current - rect.left, 460))}px`)
		}
		const move = (event: MouseEvent) => {
			if (!dragging.current) return
			pendingClientX.current = event.clientX
			if (!dragFrame.current) dragFrame.current = window.requestAnimationFrame(applyDrag)
		}
		const end = () => {
			if (!dragging.current) return
			if (dragFrame.current) {
				window.cancelAnimationFrame(dragFrame.current)
				applyDrag()
			}
			dragging.current = false
			dragBounds.current = null
			document.body.style.userSelect = ''
			document.body.style.cursor = ''
		}
		window.addEventListener('mousemove', move)
		window.addEventListener('mouseup', end)
		return () => {
			if (dragFrame.current) window.cancelAnimationFrame(dragFrame.current)
			window.removeEventListener('mousemove', move)
			window.removeEventListener('mouseup', end)
			end()
		}
	}, [graphWidth])

	return (
		<main className='bg-background text-primary fixed inset-0 z-[110] grid grid-rows-[48px_minmax(0,1fr)]'>
			<header className='border-border bg-background/95 flex items-center border-b px-3 backdrop-blur-xl'>
				<Link
					href='/toolbox'
					onClick={() => void closeRepository()}
					className='border-border bg-article/70 text-secondary hover:border-brand/40 hover:text-primary flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs transition max-lg:h-10'>
					<ArrowLeft size={14} />
					<span className='hidden sm:inline'>工具箱</span>
				</Link>
				<div className='bg-border mx-3 h-5 w-px' />
				<div className='flex min-w-0 items-center gap-2'>
					{repository?.source === 'github-rest' ? <Github className='text-brand' size={16} /> : overview?.repositoryKind === 'svn' ? <Server className='text-orange-300' size={16} /> : <GitBranch className='text-brand' size={16} />}
					<span className='max-w-52 truncate text-sm font-semibold'>{overview?.displayName}</span>
					<span className='border-border text-secondary hidden rounded border px-2 py-0.5 font-mono text-[9px] md:inline'>
						{overview?.repositoryKind === 'svn' ? 'SVN' : overview?.isBare ? 'BARE' : overview?.isDetachedHead ? 'DETACHED' : overview?.currentBranch || 'NO HEAD'}
					</span>
					{overview?.ahead || overview?.behind ? (
						<span className='text-secondary hidden text-[10px] lg:inline'>
							↑{overview.ahead} ↓{overview.behind}
						</span>
					) : null}
				</div>
				<div className='ml-auto flex items-center gap-1'>
					<span className='mr-2 hidden items-center gap-1 text-[10px] text-emerald-400 sm:flex'>
						<LockKeyhole size={12} /> 只读
					</span>
					<button
						onClick={() => void refresh()}
						disabled={loading}
						title='刷新仓库'
						className='text-secondary hover:text-primary flex size-10 items-center justify-center rounded p-2 disabled:opacity-40 lg:size-auto'>
						<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
					</button>
					<button
						onClick={() => void (repository?.source === 'github-rest' ? closeRepository() : selectRepository())}
						title={repository?.source === 'github-rest' ? '切换仓库' : '切换项目'}
						className='text-secondary hover:text-primary flex size-10 items-center justify-center rounded p-2 lg:size-auto'>
						<FolderSync size={16} />
					</button>
					{viewMode === 'history' && comparison && (
						<button
							onClick={() => void clearComparison()}
							title='退出比较'
							className='bg-brand/10 text-brand ml-1 hidden items-center gap-1 rounded px-2 py-1.5 text-[10px] lg:flex'>
							<X size={12} />
							退出比较
						</button>
					)}
				</div>
			</header>
			<div ref={containerRef} className='relative flex min-h-0 overflow-hidden'>
				<motion.div
					className={`w-full shrink-0 overflow-hidden lg:w-[var(--graph-width)] max-lg:absolute max-lg:inset-0 max-lg:z-10 max-lg:transition-transform max-lg:duration-200 max-lg:ease-out motion-reduce:transition-none ${mobilePanel === 'detail' ? 'max-lg:pointer-events-none max-lg:-translate-x-full' : 'max-lg:translate-x-0'}`}
					style={{ '--graph-width': graphWidth } as MotionStyle}>
					{viewMode === 'history' ? (
						<CommitGraph
							mode={viewMode}
							onModeChange={changeViewMode}
							onOpenSelection={openMobileDetail}
							comparisonPicking={mobileComparePicking}
							onCancelComparison={() => setMobileComparePicking(false)}
						/>
					) : (
						<RepositoryTree mode={viewMode} onModeChange={changeViewMode} selectedPath={repositoryEntry?.path || null} onSelect={selectRepositoryEntry} />
					)}
				</motion.div>
				<div
					onMouseDown={event => {
						event.preventDefault()
						dragging.current = true
						dragBounds.current = containerRef.current?.getBoundingClientRect() ?? null
						pendingClientX.current = event.clientX
						document.body.style.userSelect = 'none'
						document.body.style.cursor = 'col-resize'
					}}
					className='bg-border hover:bg-brand/50 active:bg-brand z-10 hidden w-1 shrink-0 cursor-col-resize transition-colors lg:block'
				/>
				<div
					className={`min-w-0 flex-1 overflow-hidden max-lg:absolute max-lg:inset-0 max-lg:z-20 max-lg:transition-transform max-lg:duration-200 max-lg:ease-out motion-reduce:transition-none ${mobilePanel === 'browser' ? 'max-lg:pointer-events-none max-lg:translate-x-full' : 'max-lg:translate-x-0'}`}>
					{viewMode === 'history' ? (
						<DiffDetail
							onMobileBack={() => setMobilePanel('browser')}
							onMobileCompare={() => {
								setMobileComparePicking(true)
								setMobilePanel('browser')
							}}
						/>
					) : (
						<RepositoryFileViewer entry={repositoryEntry} onMobileBack={() => setMobilePanel('browser')} />
					)}
				</div>
			</div>
			{error && (
				<button
					onClick={clearError}
					className='fixed right-4 bottom-4 z-[150] max-w-md rounded-lg border border-red-400/35 bg-red-950/90 px-4 py-3 text-left text-xs text-red-200 shadow-xl'>
					{error}
				</button>
			)}
			{viewMode === 'history' && <DiffModal />}
			<RepositoryCandidatePicker />
		</main>
	)
}
