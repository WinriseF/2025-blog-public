'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, GitCommitHorizontal, Globe2, Loader2 } from 'lucide-react'
import {
	buildGitGraphDisplayCommits,
	computeGitGraphLayout,
	isCollapsedStashCommit,
	type CommitRowViewModel,
	type DisplayGraphCommit
} from '@/lib/version-control/graph-layout'
import { useVersionControlStore, type VersionSelection } from '@/lib/version-control/store'
import type { GraphCommit, RepositoryOverview } from '@/lib/version-control/types'
import { CommitHoverCard } from './commit-hover-card'
import { GitRefBadges } from './git-ref-badges'
import { RepositorySidebarHeader, type RepositoryViewMode } from './repository-sidebar-header'

const ROW_HEIGHT = 44
const SWIMLANE_WIDTH = 11
const CURVE_RADIUS = 5
const CIRCLE_RADIUS = 4

function laneX(index: number) {
	return SWIMLANE_WIDTH * (index + 1)
}
function rowSurfaceClass(selected: boolean, compare: boolean) {
	return selected ? 'bg-brand/10' : compare ? 'bg-yellow-500/10' : 'group-hover:bg-article/75'
}
function rowBorderClass(selected: boolean, compare: boolean) {
	return selected ? 'border-l-brand' : compare ? 'border-l-yellow-500' : 'border-l-transparent'
}
function rowSvgWidth(row?: CommitRowViewModel) {
	return row ? SWIMLANE_WIDTH * (Math.max(row.inputSwimlanes.length, row.outputSwimlanes.length, 1) + 1) : SWIMLANE_WIDTH * 2
}

function useDebounce<T>(value: T, delay: number) {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delay)
		return () => window.clearTimeout(timer)
	}, [delay, value])
	return debounced
}

const WorkingTreeRow = memo(function WorkingTreeRow({
	selected,
	compare,
	svgWidth,
	subtitle,
	onClick,
	onContextMenu
}: {
	selected: boolean
	compare: boolean
	svgWidth: number
	subtitle: string
	onClick: () => void
	onContextMenu: (event: React.MouseEvent) => void
}) {
	const surface = rowSurfaceClass(selected, compare)
	return (
		<div
			onClick={onClick}
			onContextMenu={onContextMenu}
			style={{ height: ROW_HEIGHT }}
			className={`group flex cursor-pointer items-stretch border-l-2 transition-colors ${rowBorderClass(selected, compare)}`}>
			<div style={{ width: svgWidth }} className={`relative flex shrink-0 items-center justify-center ${surface}`}>
				<FolderOpen size={14} className='text-orange-400' />
			</div>
			<div className={`flex min-w-0 flex-1 items-center pr-3 ${surface}`}>
				<div className='min-w-0'>
					<p className='truncate text-xs leading-tight font-medium text-orange-400'>工作区</p>
					<span className='text-secondary text-[10px]'>{subtitle}</span>
				</div>
			</div>
		</div>
	)
})

const CommitGraphRow = memo(function CommitGraphRow({
	row,
	selected,
	compare,
	onClick,
	onContextMenu,
	onOpenHover,
	onCloseHover
}: {
	row: CommitRowViewModel
	selected: boolean
	compare: boolean
	onClick: (commit: DisplayGraphCommit) => void
	onContextMenu: (event: React.MouseEvent, commit: DisplayGraphCommit) => void
	onOpenHover: (commit: DisplayGraphCommit, target: HTMLElement) => void
	onCloseHover: () => void
}) {
	const surface = rowSurfaceClass(selected, compare)
	return (
		<div
			onClick={() => onClick(row.commit)}
			onContextMenu={event => onContextMenu(event, row.commit)}
			onMouseEnter={event => onOpenHover(row.commit, event.currentTarget)}
			onMouseLeave={onCloseHover}
			style={{ height: ROW_HEIGHT }}
			className={`group flex cursor-pointer items-stretch border-l-2 transition-colors ${rowBorderClass(selected, compare)}`}>
			<div className={`shrink-0 ${surface}`}>
				<CommitRowGraph row={row} selected={selected} compare={compare} />
			</div>
			<div className={`flex min-w-0 flex-1 items-center pr-3 ${surface}`}>
				<div className='min-w-0'>
					<p title={row.commit.message} className='truncate text-xs leading-tight font-medium'>
						{row.commit.message || '(无提交信息)'}
					</p>
					<div className='mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden'>
						<span className='font-mono text-[10px] text-green-500'>{row.commit.shortHash}</span>
						{row.commit.refs.length > 0 && <GitRefBadges refs={row.commit.refs} maxVisible={2} size='compact' wrap={false} />}
					</div>
				</div>
			</div>
		</div>
	)
})

const CommitRowGraph = memo(function CommitRowGraph({ row, selected, compare }: { row: CommitRowViewModel; selected: boolean; compare: boolean }) {
	const { commit, inputSwimlanes, outputSwimlanes, circleIndex, circleColor } = row
	const middleY = ROW_HEIGHT / 2
	const elements: React.ReactNode[] = []
	let key = 0
	const collapsedStash = isCollapsedStashCommit(commit)
	const line = (color: string, dashed = false) => ({
		stroke: color,
		strokeWidth: 1,
		fill: 'none' as const,
		strokeLinecap: 'round' as const,
		strokeDasharray: dashed ? '4 3' : undefined
	})
	let outputIndex = 0

	for (let index = 0; index < inputSwimlanes.length; index += 1) {
		const color = inputSwimlanes[index].color
		const inputX = laneX(index)
		if (inputSwimlanes[index].id === commit.hash) {
			if (index !== circleIndex) {
				const circleX = laneX(circleIndex)
				const commands =
					inputX > circleX
						? [`M ${inputX} 0`, `A ${SWIMLANE_WIDTH} ${middleY} 0 0 1 ${inputX - SWIMLANE_WIDTH} ${middleY}`, `H ${circleX}`]
						: [`M ${inputX} 0`, `A ${SWIMLANE_WIDTH} ${middleY} 0 0 0 ${inputX + SWIMLANE_WIDTH} ${middleY}`, `H ${circleX}`]
				elements.push(<path key={key++} d={commands.join(' ')} {...line(color)} />)
			} else outputIndex += 1
		} else if (outputIndex < outputSwimlanes.length && inputSwimlanes[index].id === outputSwimlanes[outputIndex].id) {
			if (index === outputIndex) elements.push(<path key={key++} d={`M ${inputX} 0 V ${ROW_HEIGHT}`} {...line(color)} />)
			else {
				const outputX = laneX(outputIndex)
				const commands =
					inputX > outputX
						? [
								`M ${inputX} 0`,
								`V ${middleY - CURVE_RADIUS}`,
								`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${inputX - CURVE_RADIUS} ${middleY}`,
								`H ${outputX + CURVE_RADIUS}`,
								`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${outputX} ${middleY + CURVE_RADIUS}`,
								`V ${ROW_HEIGHT}`
							]
						: [
								`M ${inputX} 0`,
								`V ${middleY - CURVE_RADIUS}`,
								`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${inputX + CURVE_RADIUS} ${middleY}`,
								`H ${outputX - CURVE_RADIUS}`,
								`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${outputX} ${middleY + CURVE_RADIUS}`,
								`V ${ROW_HEIGHT}`
							]
				elements.push(<path key={key++} d={commands.join(' ')} {...line(color)} />)
			}
			outputIndex += 1
		}
	}

	for (let index = 1; index < commit.parentHashes.length; index += 1) {
		let parentOutputIndex = -1
		for (let target = outputSwimlanes.length - 1; target >= 0; target -= 1)
			if (outputSwimlanes[target].id === commit.parentHashes[index]) {
				parentOutputIndex = target
				break
			}
		if (parentOutputIndex === -1) continue
		const leftEdge = SWIMLANE_WIDTH * parentOutputIndex
		const center = laneX(parentOutputIndex)
		const circleX = laneX(circleIndex)
		elements.push(
			<path
				key={key++}
				d={`M ${leftEdge} ${middleY} A ${SWIMLANE_WIDTH} ${middleY} 0 0 1 ${center} ${ROW_HEIGHT} M ${leftEdge} ${middleY} H ${circleX}`}
				{...line(outputSwimlanes[parentOutputIndex].color, collapsedStash)}
			/>
		)
	}

	const inputIndex = inputSwimlanes.findIndex(node => node.id === commit.hash)
	if (inputIndex !== -1) elements.push(<path key={key++} d={`M ${laneX(circleIndex)} 0 V ${middleY}`} {...line(inputSwimlanes[inputIndex].color)} />)
	if (commit.parentHashes.length > 0)
		elements.push(<path key={key++} d={`M ${laneX(circleIndex)} ${middleY} V ${ROW_HEIGHT}`} {...line(circleColor, collapsedStash)} />)

	const fill = compare ? '#eab308' : circleColor
	if (collapsedStash) {
		const center = laneX(circleIndex)
		const size = selected || compare ? 8 : 7
		const stroke = selected ? 'var(--color-primary)' : compare ? '#eab308' : circleColor
		elements.push(
			<rect
				key={key++}
				x={center - size}
				y={middleY - size}
				width={size * 2}
				height={size * 2}
				rx={2}
				fill='var(--color-bg)'
				stroke={stroke}
				strokeWidth={selected ? 2 : 1.5}
				strokeDasharray='3 2'
			/>,
			<rect key={key++} x={center - 3} y={middleY - 3} width={6} height={6} rx={1} fill={fill} />
		)
	} else if (commit.isStash) {
		const size = selected || compare ? 7 : 6
		elements.push(
			<rect
				key={key++}
				x={laneX(circleIndex) - size}
				y={middleY - size}
				width={size * 2}
				height={size * 2}
				rx={1}
				fill={fill}
				stroke={selected ? 'var(--color-primary)' : compare ? '#ca8a04' : 'none'}
				strokeWidth={selected || compare ? 2 : 0}
			/>
		)
	} else if (commit.parentHashes.length > 1) {
		elements.push(
			<circle key={key++} cx={laneX(circleIndex)} cy={middleY} r={CIRCLE_RADIUS + 2} fill={fill} />,
			<circle key={key++} cx={laneX(circleIndex)} cy={middleY} r={CIRCLE_RADIUS - 1} fill='var(--color-bg)' />
		)
	} else {
		elements.push(
			<circle
				key={key++}
				cx={laneX(circleIndex)}
				cy={middleY}
				r={selected || compare ? CIRCLE_RADIUS + 3 : CIRCLE_RADIUS + 1}
				fill={fill}
				stroke='none'
				strokeWidth={0}
			/>
		)
	}

	const width = rowSvgWidth(row)
	return (
		<svg width={width} height={ROW_HEIGHT} viewBox={`0 0 ${width} ${ROW_HEIGHT}`}>
			{elements}
		</svg>
	)
})

export function CommitGraph({ mode, onModeChange }: { mode: RepositoryViewMode; onModeChange: (mode: RepositoryViewMode) => void }) {
	const commits = useVersionControlStore(state => state.commits)
	const overview = useVersionControlStore(state => state.overview)
	const search = useVersionControlStore(state => state.search)
	const branchFilter = useVersionControlStore(state => state.branchFilter)
	const selection = useVersionControlStore(state => state.selection)
	const comparison = useVersionControlStore(state => state.comparison)
	const hasMore = useVersionControlStore(state => state.historyHasMore)
	const loading = useVersionControlStore(state => state.loading)
	const selectVersion = useVersionControlStore(state => state.selectVersion)
	const compareWith = useVersionControlStore(state => state.compareWith)
	const loadMore = useVersionControlStore(state => state.loadMoreHistory)
	const setSearch = useVersionControlStore(state => state.setSearch)
	const connectHistory = useVersionControlStore(state => state.connectHistory)
	const scrollRef = useRef<HTMLDivElement>(null)
	const closeTimer = useRef<number | null>(null)
	const frame = useRef<number | null>(null)
	const latestScroll = useRef(0)
	const [scrollTop, setScrollTop] = useState(0)
	const [viewHeight, setViewHeight] = useState(800)
	const [searchInput, setSearchInput] = useState(search)
	const [hoveredCommit, setHoveredCommit] = useState<GraphCommit | null>(null)
	const [hoverAnchor, setHoverAnchor] = useState<DOMRect | null>(null)
	const debouncedSearch = useDebounce(searchInput, 250)
	const rawByHash = useMemo(() => new Map(commits.map(commit => [commit.hash, commit])), [commits])
	const displayCommits = useMemo(() => buildGitGraphDisplayCommits(commits), [commits])
	const layout = useMemo(() => computeGitGraphLayout(displayCommits), [displayCommits])
	const workingRows = overview && !overview.isBare && overview.capabilities?.hasWorkingTree !== false ? 1 : 0
	const totalRows = displayCommits.length + workingRows
	const totalHeight = totalRows * ROW_HEIGHT
	const workingTreeWidth = layout.rows[0] ? rowSvgWidth(layout.rows[0]) : SWIMLANE_WIDTH * 2
	const visibleStart = Math.floor(scrollTop / ROW_HEIGHT)
	const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 2
	const visibleEnd = Math.min(visibleStart + visibleCount, totalRows)
	const visibleCommitRows = useMemo(
		() => layout.rows.slice(Math.max(visibleStart - workingRows, 0), Math.max(visibleEnd - workingRows, 0)),
		[layout.rows, visibleEnd, visibleStart, workingRows]
	)

	useEffect(() => {
		if (debouncedSearch !== search) void setSearch(debouncedSearch)
	}, [debouncedSearch, search, setSearch])
	useEffect(() => {
		setSearchInput(search)
	}, [overview?.currentBranch, search])
	useEffect(() => {
		const element = scrollRef.current
		if (!element) return
		const syncHeight = () => setViewHeight(current => (current === element.clientHeight ? current : element.clientHeight))
		syncHeight()
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncHeight)
		observer?.observe(element)
		return () => observer?.disconnect()
	}, [])
	useEffect(
		() => () => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
			if (frame.current !== null) window.cancelAnimationFrame(frame.current)
		},
		[]
	)
	useEffect(() => {
		const element = scrollRef.current
		if (element) {
			element.scrollTop = 0
			latestScroll.current = 0
			setScrollTop(0)
		}
	}, [branchFilter, search])

	const handleScroll = useCallback(() => {
		const element = scrollRef.current
		if (!element) return
		latestScroll.current = element.scrollTop
		if (frame.current === null)
			frame.current = window.requestAnimationFrame(() => {
				frame.current = null
				setScrollTop(latestScroll.current)
			})
		if (element.scrollTop + element.clientHeight >= element.scrollHeight - ROW_HEIGHT * 8 && hasMore && !loading && commits.length > 0) void loadMore()
	}, [commits.length, hasMore, loadMore, loading])

	const select = useCallback((item: VersionSelection) => void selectVersion(item), [selectVersion])
	const compare = useCallback(
		(event: React.MouseEvent, item: VersionSelection) => {
			event.preventDefault()
			void compareWith(item)
		},
		[compareWith]
	)
	const openHover = useCallback(
		(commit: DisplayGraphCommit, target: HTMLElement) => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
			setHoveredCommit(rawByHash.get(commit.hash) || commit)
			setHoverAnchor(target.getBoundingClientRect())
		},
		[rawByHash]
	)
	const scheduleClose = useCallback(() => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
		closeTimer.current = window.setTimeout(() => {
			setHoveredCommit(null)
			setHoverAnchor(null)
			closeTimer.current = null
		}, 140)
	}, [])
	const keepOpen = useCallback(() => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current)
			closeTimer.current = null
		}
	}, [])

	return (
		<aside className='border-border bg-background flex h-full w-full flex-col border-r'>
			<RepositorySidebarHeader
				mode={mode}
				onModeChange={onModeChange}
				query={searchInput}
				onQueryChange={setSearchInput}
				placeholder={overview?.repositoryKind === 'svn' ? '消息、作者、revision' : '消息、作者、hash、ref'}
				overview={overview}
			/>

			<div ref={scrollRef} onScroll={handleScroll} className='relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
				{overview?.repositoryKind === 'svn' && !overview.svn?.historyConnected ? (
					<PanelState>
						<Globe2 size={18} className='text-orange-300' />
						<div>
							<p>SVN 历史默认不联网</p>
							<button onClick={() => void connectHistory()} className='bg-brand text-background mt-3 rounded-md px-3 py-1.5 text-[11px] font-medium'>连接并读取历史</button>
						</div>
					</PanelState>
				) : loading && commits.length === 0 ? (
					<PanelState>
						<Loader2 size={18} className='text-brand animate-spin' />
						正在读取提交…
					</PanelState>
				) : commits.length === 0 ? (
					<PanelState>{search ? '没有匹配的提交' : overview?.isBare ? '裸仓库还没有提交' : '仓库还没有提交'}</PanelState>
				) : (
					<div style={{ height: totalHeight, position: 'relative' }}>
						<div style={{ transform: `translateY(${visibleStart * ROW_HEIGHT}px)` }}>
							{visibleStart === 0 && workingRows === 1 && (
								<WorkingTreeRow
									selected={selection?.kind === 'working-tree'}
									compare={comparison?.current.kind === 'working-tree'}
									svgWidth={workingTreeWidth}
									subtitle={workspaceLabel(overview)}
									onClick={() => select({ kind: 'working-tree', label: '工作区' })}
									onContextMenu={event => compare(event, { kind: 'working-tree', label: '工作区' })}
								/>
							)}
							{visibleCommitRows.map(row => {
								const item: VersionSelection = { kind: 'commit', commit: rawByHash.get(row.commit.hash) || row.commit }
								return (
									<CommitGraphRow
										key={row.commit.hash}
										row={row}
										selected={selection?.kind === 'commit' && selection.commit.hash === row.commit.hash}
										compare={comparison?.current.kind === 'commit' && comparison.current.commit.hash === row.commit.hash}
										onClick={() => select(item)}
										onContextMenu={event => compare(event, item)}
										onOpenHover={openHover}
										onCloseHover={scheduleClose}
									/>
								)
							})}
							{loading && commits.length > 0 && (
								<div style={{ height: ROW_HEIGHT }} className='text-secondary flex items-center justify-center text-[10px]'>
									正在读取…
								</div>
							)}
						</div>
					</div>
				)}
			</div>
			<footer className='border-border text-secondary flex h-7 shrink-0 items-center border-t px-3 text-[10px]'>
				<GitCommitHorizontal size={11} className='mr-1.5' />
				{commits.length} 条已载入<span className='ml-auto'>右键比较</span>
			</footer>
			<CommitHoverCard anchorRect={hoverAnchor} commit={hoveredCommit} onMouseEnter={keepOpen} onMouseLeave={scheduleClose} />
		</aside>
	)
}

function PanelState({ children }: { children: React.ReactNode }) {
	return <div className='text-secondary flex h-full items-center justify-center gap-2 px-4 text-center text-xs'>{children}</div>
}
function workspaceLabel(overview: RepositoryOverview | null) {
	if (!overview) return '工作区'
	if (overview.repositoryKind === 'svn') {
		const revision = overview.svn?.workingRevision ? `r${overview.svn.workingRevision}` : 'BASE'
		return `${revision}${overview.svn?.mixedRevision ? ' · 混合版本' : ''}${overview.conflictedCount ? ` · ${overview.conflictedCount} 冲突` : ''}`
	}
	const parts = [
		overview.hasStagedChanges && '已暂存',
		overview.hasUnstagedChanges && '未暂存',
		overview.hasUntrackedFiles && '未跟踪',
		overview.conflictedCount > 0 && `${overview.conflictedCount} 冲突`
	].filter(Boolean)
	return parts.join(' · ') || '工作树干净'
}
