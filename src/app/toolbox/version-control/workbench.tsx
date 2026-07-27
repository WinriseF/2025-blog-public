'use client'

import Link from 'next/link'
import { ArrowLeft, FolderSync, GitBranch, LockKeyhole, RefreshCw, X } from 'lucide-react'
import { motion, useMotionValue } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useVersionControlStore } from '@/lib/version-control/store'
import { CommitGraph } from './commit-graph'
import { DiffDetail } from './diff-detail'
import { DiffModal } from './diff-modal'

export function Workbench() {
	const containerRef = useRef<HTMLDivElement>(null)
	const dragging = useRef(false)
	const graphWidth = useMotionValue(300)
	const overview = useVersionControlStore(state => state.overview)
	const loading = useVersionControlStore(state => state.loading)
	const error = useVersionControlStore(state => state.error)
	const comparison = useVersionControlStore(state => state.comparison)
	const clearComparison = useVersionControlStore(state => state.clearComparison)
	const refresh = useVersionControlStore(state => state.refresh)
	const selectRepository = useVersionControlStore(state => state.selectRepository)
	const closeRepository = useVersionControlStore(state => state.closeRepository)
	const clearError = useVersionControlStore(state => state.clearError)

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && comparison) void clearComparison()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [clearComparison, comparison])

	useEffect(() => {
		const move = (event: MouseEvent) => {
			if (!dragging.current || !containerRef.current) return
			const rect = containerRef.current.getBoundingClientRect()
			graphWidth.set(Math.max(200, Math.min(event.clientX - rect.left, 460)))
		}
		const end = () => {
			if (!dragging.current) return
			dragging.current = false
			document.body.style.userSelect = ''
			document.body.style.cursor = ''
		}
		window.addEventListener('mousemove', move)
		window.addEventListener('mouseup', end)
		return () => {
			window.removeEventListener('mousemove', move)
			window.removeEventListener('mouseup', end)
			end()
		}
	}, [graphWidth])

	return (
		<main className='bg-background text-primary fixed inset-0 z-[110] grid grid-rows-[48px_minmax(0,1fr)]'>
			<header className='border-border bg-background/95 flex items-center border-b px-3 backdrop-blur-xl'>
				<Link href='/toolbox' onClick={() => void closeRepository()} className='text-secondary hover:text-primary flex items-center gap-2 px-2 text-xs'>
					<ArrowLeft size={15} />
					<span className='hidden sm:inline'>工具箱</span>
				</Link>
				<div className='bg-border mx-3 h-5 w-px' />
				<div className='flex min-w-0 items-center gap-2'>
					<GitBranch className='text-brand' size={16} />
					<span className='max-w-52 truncate text-sm font-semibold'>{overview?.displayName}</span>
					<span className='border-border text-secondary hidden rounded border px-2 py-0.5 font-mono text-[9px] md:inline'>
						{overview?.isBare ? 'BARE' : overview?.isDetachedHead ? 'DETACHED' : overview?.currentBranch || 'NO HEAD'}
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
						className='text-secondary hover:text-primary rounded p-2 disabled:opacity-40'>
						<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
					</button>
					<button onClick={() => void selectRepository()} title='切换项目' className='text-secondary hover:text-primary rounded p-2'>
						<FolderSync size={16} />
					</button>
					{comparison && (
						<button
							onClick={() => void clearComparison()}
							title='退出比较'
							className='bg-brand/10 text-brand ml-1 flex items-center gap-1 rounded px-2 py-1.5 text-[10px]'>
							<X size={12} />
							退出比较
						</button>
					)}
				</div>
			</header>
			<div ref={containerRef} className='flex min-h-0 overflow-hidden'>
				<motion.div className='shrink-0 overflow-hidden' style={{ width: graphWidth }}>
					<CommitGraph />
				</motion.div>
				<div
					onMouseDown={event => {
						event.preventDefault()
						dragging.current = true
						document.body.style.userSelect = 'none'
						document.body.style.cursor = 'col-resize'
					}}
					className='bg-border hover:bg-brand/50 active:bg-brand z-10 w-1 shrink-0 cursor-col-resize transition-colors'
				/>
				<div className='min-w-0 flex-1 overflow-hidden'>
					<DiffDetail />
				</div>
			</div>
			{error && (
				<button
					onClick={clearError}
					className='fixed right-4 bottom-4 z-[150] max-w-md rounded-lg border border-red-400/35 bg-red-950/90 px-4 py-3 text-left text-xs text-red-200 shadow-xl'>
					{error}
				</button>
			)}
			<DiffModal />
		</main>
	)
}
