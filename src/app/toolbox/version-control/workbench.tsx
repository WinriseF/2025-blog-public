'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, FolderSync, GitBranch, Github, LockKeyhole, LockKeyholeOpen, RefreshCw, Server, X } from 'lucide-react'
import { motion, useMotionValue, type MotionStyle } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryTreeEntry } from '@/lib/version-control/types'
import { CommitGraph } from './commit-graph'
import { DiffDetail } from './diff-detail'
import { DiffModal } from './diff-modal'
import { RepositoryCandidatePicker } from './repository-candidate-picker'
import { WorkspaceFilePanel } from './workspace-file-panel'
import { useWorkspaceFiles } from './use-workspace-files'
import { WorkspaceChoiceDialog } from './workspace-choice'
import { RepositoryTree } from './repository-tree'
import type { RepositoryViewMode } from './repository-sidebar-header'

export function Workbench() {
	const router = useRouter()
	const files = useWorkspaceFiles()
	const directory = useVersionControlStore(state => state.browserDirectory)
	const openLocalDirectory = useVersionControlStore(state => state.openLocalDirectory)
	const selectRepository = useVersionControlStore(state => state.selectRepository)
	const workspaceKey = useVersionControlStore(state => state.workspaceKey)
	const containerRef = useRef<HTMLDivElement>(null)
	const dragging = useRef(false)
	const dragBounds = useRef<DOMRect | null>(null)
	const dragFrame = useRef(0)
	const pendingClientX = useRef(0)
	const graphWidth = useMotionValue('300px')
	const [viewMode, setViewMode] = useState<RepositoryViewMode>(() => useVersionControlStore.getState().repository ? 'history' : 'files')
	const [mobilePanel, setMobilePanel] = useState<'browser' | 'detail'>('browser')
	const [mobileComparePicking, setMobileComparePicking] = useState(false)
	const repositoryEntry = files.active
	const repository = useVersionControlStore(state => state.repository)
	const overview = useVersionControlStore(state => state.overview)
	const loading = useVersionControlStore(state => state.loading)
	const error = useVersionControlStore(state => state.error)
	const comparison = useVersionControlStore(state => state.comparison)
	const clearComparison = useVersionControlStore(state => state.clearComparison)
	const refresh = useVersionControlStore(state => state.refresh)
	const closeRepository = useVersionControlStore(state => state.closeRepository)
	const clearError = useVersionControlStore(state => state.clearError)
	const openDiffFile = useVersionControlStore(state => state.openFile)
	const visibleError = error || (viewMode === 'history' ? files.error : null)

	useEffect(() => {
		setViewMode(repository ? 'history' : 'files')
		setMobilePanel('browser')
		setMobileComparePicking(false)
	}, [workspaceKey])

	useEffect(() => { if (!repository) setViewMode('files') }, [repository])

	const changeViewMode = (mode: RepositoryViewMode) => {
		void files.guard(() => {
			setViewMode(mode)
			setMobilePanel('browser')
			setMobileComparePicking(false)
			if (mode === 'files') openDiffFile(null)
		})
	}
	const openMobileDetail = () => {
		setMobileComparePicking(false)
		setMobilePanel('detail')
	}
	const selectRepositoryEntry = (entry: RepositoryTreeEntry, permanent = false) => {
		void files.open(entry, permanent).then(opened => { if (opened) openMobileDetail() })
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
				<button
					onClick={() => void files.guard(async () => { await closeRepository(); router.push('/toolbox') })}
					className='border-border bg-article/70 text-secondary hover:border-brand/40 hover:text-primary flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs transition max-lg:h-10'>
					<ArrowLeft size={14} />
					<span className='hidden sm:inline'>工具箱</span>
				</button>
				<div className='bg-border mx-3 h-5 w-px' />
				<div className='flex min-w-0 items-center gap-2'>
					{repository?.source === 'github-rest' ? <Github className='text-brand' size={16} /> : overview?.repositoryKind === 'svn' ? <Server className='text-orange-300' size={16} /> : <GitBranch className='text-brand' size={16} />}
					<span className='max-w-52 truncate text-sm font-semibold'>{directory?.name || overview?.displayName}</span>
					<span className='border-border text-secondary hidden rounded border px-2 py-0.5 font-mono text-[9px] md:inline'>
						{overview?.repositoryKind === 'svn' ? 'SVN' : overview?.isBare ? 'BARE' : overview?.isDetachedHead ? 'DETACHED' : overview?.currentBranch || (directory ? '本地文件夹' : 'NO HEAD')}
					</span>
					{overview?.ahead || overview?.behind ? (
						<span className='text-secondary hidden text-[10px] lg:inline'>
							↑{overview.ahead} ↓{overview.behind}
						</span>
					) : null}
				</div>
				<div className='ml-auto flex items-center gap-1'>
					<button onClick={files.toggleEditable} disabled={!files.canEdit || files.saving} aria-pressed={files.editable} title={files.canEdit ? directory ? '切换工作区编辑模式' : '选择当前仓库的同一个根文件夹，授权浏览器编辑' : '当前仓库只读'} className={`mr-2 flex items-center gap-1 rounded px-2 py-2 text-[11px] hover:bg-primary/5 disabled:cursor-default ${files.editable ? 'text-brand' : 'text-emerald-400'}`}>
						{files.editable ? <LockKeyholeOpen size={14} /> : <LockKeyhole size={14} />}{files.editable ? '可编辑' : '只读'}
					</button>
					<button
						onClick={() => void files.guard(refresh)}
						disabled={loading}
						title='刷新仓库'
						className='text-secondary hover:text-primary flex size-10 items-center justify-center rounded p-2 disabled:opacity-40 lg:size-auto'>
						<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
					</button>
					<button
						onClick={() => void files.guard(repository?.source === 'local-agent' ? selectRepository : directory ? openLocalDirectory : closeRepository)}
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
						<RepositoryTree mode={viewMode} onModeChange={changeViewMode} selectedPath={repositoryEntry?.path || null} onSelect={selectRepositoryEntry} onKeepOpen={entry => selectRepositoryEntry(entry, true)} />
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
					className="bg-primary/30 hover:bg-brand active:bg-brand relative z-10 hidden w-px shrink-0 cursor-col-resize transition-colors before:absolute before:inset-y-0 before:-inset-x-1 before:content-[''] lg:block"
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
						<WorkspaceFilePanel files={files} onMobileBack={() => setMobilePanel('browser')} />
					)}
				</div>
			</div>
			{visibleError && (
				<button
					onClick={() => { clearError(); files.clearError() }}
					className='fixed right-4 bottom-4 z-[150] max-w-md rounded-lg border border-red-400/35 bg-red-950/90 px-4 py-3 text-left text-xs text-red-200 shadow-xl'>
					{visibleError}
				</button>
			)}
			{viewMode === 'history' && <DiffModal />}
			<RepositoryCandidatePicker />
			<WorkspaceChoiceDialog choice={files.choice} onChoose={files.choose} />
		</main>
	)
}
