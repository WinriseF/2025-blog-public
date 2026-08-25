'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertOctagon, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ChevronUp, FileCode, FileDown, FileImage, Folder, FolderOpen, GitCompareArrows, Shuffle, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useVersionControlStore, type VersionSelection } from '@/lib/version-control/store'
import type { DiffFile, RepositoryKind, WorkingTreeGroup } from '@/lib/version-control/types'
import { GitRefBadges } from './git-ref-badges'
import { ExportDialog } from './export-dialog'

const groups: Array<{ value: WorkingTreeGroup; label: string }> = [
	{ value: 'all', label: '全部' },
	{ value: 'staged', label: '暂存' },
	{ value: 'unstaged', label: '未暂存' },
	{ value: 'untracked', label: '未跟踪' },
	{ value: 'conflicted', label: '冲突' }
]

type StatusFilter = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '!' | '~'
const defaultStatusFilters = new Set<StatusFilter>(['A', 'M', 'D', 'R', 'C', 'U', '!', '~'])

export function DiffDetail({ onMobileBack, onMobileCompare }: { onMobileBack: () => void; onMobileCompare: () => void }) {
	const overview = useVersionControlStore(state => state.overview)
	const selection = useVersionControlStore(state => state.selection)
	const comparison = useVersionControlStore(state => state.comparison)
	const clearComparison = useVersionControlStore(state => state.clearComparison)
	const group = useVersionControlStore(state => state.group)
	const setGroup = useVersionControlStore(state => state.setGroup)
	const diff = useVersionControlStore(state => state.diff)
	const files = useVersionControlStore(state => state.files)
	const selectedIds = useVersionControlStore(state => state.selectedFileIds)
	const activeFile = useVersionControlStore(state => state.activeFile)
	const loading = useVersionControlStore(state => state.loading)
	const error = useVersionControlStore(state => state.error)
	const toggleFile = useVersionControlStore(state => state.toggleFile)
	const toggleFiles = useVersionControlStore(state => state.toggleFiles)
	const invertFiles = useVersionControlStore(state => state.invertFiles)
	const openFile = useVersionControlStore(state => state.openFile)
	const [exportOpen, setExportOpen] = useState(false)
	const [statusFilters, setStatusFilters] = useState(defaultStatusFilters)
	const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
	const availableGroups = overview?.repositoryKind === 'svn' ? groups.filter(item => item.value === 'all' || item.value === 'untracked' || item.value === 'conflicted') : groups
	const visibleFiles = useMemo(() => files.filter(file => statusFilters.has(statusLetter(file.status))), [files, statusFilters])
	const invertibleFileIds = useMemo(
		() => visibleFiles.filter(isSelectableFile).map(file => file.fileId),
		[visibleFiles]
	)
	const selectedStats = useMemo(
		() =>
			files.reduce(
				(totals, file) => {
					if (selectedIds.has(file.fileId)) {
						totals.additions += file.additions
						totals.deletions += file.deletions
					}
					return totals
				},
				{ additions: 0, deletions: 0 }
			),
		[files, selectedIds]
	)
	const statusCounts = useMemo(
		() => files.reduce<Record<StatusFilter, number>>((counts, file) => {
			const status = statusLetter(file.status)
			counts[status] += 1
			return counts
		}, { A: 0, M: 0, D: 0, R: 0, C: 0, U: 0, '!': 0, '~': 0 }),
		[files]
	)
	const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles])
	const folderPaths = useMemo(() => getFolderPaths(tree), [tree])
	const allFoldersExpanded = folderPaths.every(path => !collapsedPaths.has(path))

	useEffect(() => setStatusFilters(new Set(defaultStatusFilters)), [diff?.diffId])

	const toggleStatusFilter = (status: StatusFilter) => {
		const active = statusFilters.has(status)
		if (active)
			toggleFiles(
				files.filter(file => statusLetter(file.status) === status).map(file => file.fileId),
				false
			)
		setStatusFilters(current => {
			const next = new Set(current)
			if (active) next.delete(status)
			else next.add(status)
			return next
		})
	}
	const toggleFolder = (path: string) => {
		setCollapsedPaths(current => {
			const next = new Set(current)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}
	const toggleAllFolders = () => setCollapsedPaths(allFoldersExpanded ? new Set(folderPaths) : new Set())

	return (
		<section className='bg-background flex h-full min-w-0 flex-col overflow-hidden'>
			<header className='border-border border-b px-4 py-3 max-lg:px-2'>
				<div className='flex min-w-0 items-start gap-2'>
					<button type='button' onClick={onMobileBack} className='border-border text-secondary flex h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs lg:hidden' aria-label='返回历史列表'>
						<ArrowLeft size={15} /> 历史
					</button>
					<div className='min-w-0 flex-1'>
						<Header selection={selection} comparison={comparison} repositoryName={overview?.displayName || ''} />
					</div>
					{comparison ? (
						<button type='button' onClick={() => void clearComparison()} className='border-border text-secondary hidden h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs max-lg:flex'>
							<X size={14} /> 结束
						</button>
					) : selection ? (
						<button type='button' onClick={onMobileCompare} className='border-border text-secondary hidden h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs max-lg:flex'>
							<GitCompareArrows size={14} /> 比较
						</button>
					) : null}
				</div>
			</header>
			<div className='border-border bg-article/45 flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5 max-lg:gap-2 max-lg:px-2 max-lg:py-2'>
				<span className='text-secondary mr-auto text-[10px]'>
					{loading
						? '读取中…'
						: visibleFiles.length === files.length
							? `${files.length} 个文件发生变化`
							: `显示 ${visibleFiles.length} / ${files.length} 个文件`}
				</span>
				{diff && !loading && (
					<>
						<StatusFilterPill status='A' count={diff.summary.filesAdded} active={statusFilters.has('A')} onToggle={toggleStatusFilter} />
						<StatusFilterPill status='M' count={diff.summary.filesModified} active={statusFilters.has('M')} onToggle={toggleStatusFilter} />
						<StatusFilterPill status='D' count={diff.summary.filesDeleted} active={statusFilters.has('D')} onToggle={toggleStatusFilter} />
						<StatusFilterPill status='R' count={diff.summary.filesRenamed} active={statusFilters.has('R')} onToggle={toggleStatusFilter} />
						{diff.summary.filesConflicted > 0 && (
							<StatusFilterPill status='C' count={diff.summary.filesConflicted} active={statusFilters.has('C')} onToggle={toggleStatusFilter} />
						)}
						{overview?.repositoryKind === 'svn' && statusCounts.U > 0 && <StatusFilterPill status='U' count={statusCounts.U} active={statusFilters.has('U')} onToggle={toggleStatusFilter} />}
						{overview?.repositoryKind === 'svn' && statusCounts['!'] > 0 && <StatusFilterPill status='!' count={statusCounts['!']} active={statusFilters.has('!')} onToggle={toggleStatusFilter} />}
						{overview?.repositoryKind === 'svn' && statusCounts['~'] > 0 && <StatusFilterPill status='~' count={statusCounts['~']} active={statusFilters.has('~')} onToggle={toggleStatusFilter} />}
						<AnimatedMetric prefix='+' value={selectedStats.additions} tone='border-green-500/30 bg-green-500/10 text-green-400' />
						<AnimatedMetric prefix='−' value={selectedStats.deletions} tone='border-red-500/30 bg-red-500/10 text-red-400' />
					</>
				)}
				<button
					onClick={toggleAllFolders}
					disabled={!folderPaths.length}
					title={allFoldersExpanded ? '收起全部文件夹' : '展开全部文件夹'}
					className='text-secondary hover:bg-article hover:text-primary flex items-center gap-1 rounded px-2 py-1 text-[10px] transition disabled:opacity-40 max-lg:min-h-8'>
					{allFoldersExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
					{allFoldersExpanded ? '收起' : '展开'}
				</button>
				<button
					onClick={() => invertFiles(invertibleFileIds)}
					disabled={!invertibleFileIds.length}
					title='反选当前筛选结果'
					className='text-secondary hover:bg-article hover:text-primary flex items-center gap-1 rounded px-2 py-1 text-[10px] transition disabled:opacity-40 max-lg:min-h-8'>
					<Shuffle size={12} />
					反选
				</button>
				{overview?.capabilities?.canExport !== false && (
					<button
						onClick={() => setExportOpen(true)}
						disabled={!selectedIds.size}
						className='text-secondary hover:bg-article hover:text-primary flex items-center gap-1 rounded px-2 py-1 text-[10px] transition disabled:opacity-40 max-lg:min-h-8'>
						<FileDown size={12} />
						导出 {selectedIds.size}
					</button>
				)}
			</div>
			{selection?.kind === 'working-tree' && !comparison && (
				<nav className='border-border flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-1.5'>
					{availableGroups.map(item => (
						<button
							key={item.value}
							onClick={() => void setGroup(item.value)}
							className={`shrink-0 rounded px-2.5 py-1 text-[11px] max-lg:min-h-8 ${group === item.value ? 'bg-brand/12 text-brand font-medium' : 'text-secondary hover:bg-article hover:text-primary'}`}>
							{item.label}
						</button>
					))}
				</nav>
			)}
			<div className='min-h-0 flex-1 overflow-y-auto'>
				{error && !loading ? (
					<Empty>读取差异失败：{error}</Empty>
				) : loading && !files.length ? (
					<Empty>正在读取差异…</Empty>
				) : !files.length ? (
					<Empty>这个视角没有文件变更</Empty>
				) : !visibleFiles.length ? (
					<Empty>当前状态筛选下没有文件</Empty>
				) : (
					tree.map(node => (
						<TreeNode
							key={node.path}
							node={node}
							depth={0}
							selectedIds={selectedIds}
							activeFileId={activeFile?.fileId}
							collapsedPaths={collapsedPaths}
							toggleFolder={toggleFolder}
							toggleFile={toggleFile}
							toggleFiles={toggleFiles}
							openFile={openFile}
							repositoryKind={overview?.repositoryKind}
						/>
					))
				)}
			</div>
			{exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
		</section>
	)
}

function Header({
	selection,
	comparison,
	repositoryName
}: {
	selection: VersionSelection | null
	comparison: { old: VersionSelection; current: VersionSelection } | null
	repositoryName: string
}) {
	if (comparison)
		return (
			<>
				<div className='flex items-center gap-2 text-sm font-semibold'>
					<span className='font-mono text-green-500'>{shortLabel(comparison.old)}</span>
					<ArrowRight size={14} className='text-secondary' />
					<span className={`font-mono ${comparison.current.kind === 'working-tree' ? 'text-orange-400' : 'text-green-500'}`}>
						{shortLabel(comparison.current)}
					</span>
				</div>
				<p className='text-secondary mt-1 truncate text-xs'>{longLabel(comparison.current)}</p>
			</>
		)
	if (selection?.kind === 'working-tree')
		return (
			<>
				<h2 className='flex items-center gap-2 text-sm leading-snug font-semibold text-orange-400'>
					<FolderOpen size={14} />
					工作区
				</h2>
				<span className='text-secondary mt-1 block text-[11px]'>{repositoryName} · 当前工作文件</span>
			</>
		)
	if (selection?.kind === 'commit')
		return (
			<>
				<h2 className='text-sm leading-snug font-semibold'>{selection.commit.message}</h2>
				<div className='text-secondary mt-1.5 flex items-center gap-3 text-[11px]'>
					<span>{selection.commit.author}</span>
					<span>·</span>
					<span className='font-mono text-green-500'>{selection.commit.shortHash}</span>
				</div>
				{selection.commit.refs.length > 0 && (
					<div className='mt-2'>
						<GitRefBadges refs={selection.commit.refs} />
					</div>
				)}
			</>
		)
	return <p className='text-secondary text-sm'>选择一个提交查看变化</p>
}

function AnimatedMetric({ prefix, value, tone }: { prefix: string; value: number; tone: string }) {
	const shouldReduceMotion = useReducedMotion()
	return (
		<span title='已选文件变更行数' className={`flex overflow-hidden rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}>
			{prefix}
			<motion.span
				key={value}
				initial={shouldReduceMotion ? false : { opacity: 0, y: prefix === '+' ? 5 : -5 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: 'easeOut' }}>
				{value}
			</motion.span>
		</span>
	)
}

const statusTones: Record<StatusFilter, string> = {
	A: 'border-green-500/35 bg-green-500/12 text-green-400',
	M: 'border-blue-500/35 bg-blue-500/12 text-blue-400',
	D: 'border-red-500/35 bg-red-500/12 text-red-400',
	R: 'border-purple-500/35 bg-purple-500/12 text-purple-400',
	C: 'border-orange-500/35 bg-orange-500/12 text-orange-400',
	U: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-400',
	'!': 'border-red-500/35 bg-red-500/12 text-red-400',
	'~': 'border-yellow-500/35 bg-yellow-500/12 text-yellow-400'
}

function StatusFilterPill({
	status,
	count,
	active,
	onToggle
}: {
	status: StatusFilter
	count: number
	active: boolean
	onToggle: (status: StatusFilter) => void
}) {
	return (
		<button
			type='button'
			aria-pressed={active}
			title={`${active ? '隐藏' : '显示'} ${status} 状态文件`}
			onClick={() => onToggle(status)}
			className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition max-lg:min-h-7 ${active ? statusTones[status] : 'border-border text-secondary/45 hover:text-secondary bg-transparent'}`}>
			{status} {count}
		</button>
	)
}

type TreeItem = { name: string; path: string; children: TreeItem[]; selectableFileIds: number[]; file?: DiffFile }
type MutableTreeItem = Omit<TreeItem, 'children'> & { children: Map<string, MutableTreeItem> }

function buildTree(files: DiffFile[]) {
	const root = new Map<string, MutableTreeItem>()
	for (const file of files) {
		let level = root
		let path = ''
		const selectable = isSelectableFile(file)
		file.path.split('/').forEach((name, index, parts) => {
			path = path ? `${path}/${name}` : name
			let node = level.get(name)
			if (!node) {
				node = { name, path, children: new Map(), selectableFileIds: [] }
				level.set(name, node)
			}
			if (selectable) node.selectableFileIds.push(file.fileId)
			if (index === parts.length - 1) node.file = file
			level = node.children
		})
	}
	const finish = (items: Map<string, MutableTreeItem>): TreeItem[] => {
		return [...items.values()]
			.sort((left, right) => Number(Boolean(left.file)) - Number(Boolean(right.file)) || left.name.localeCompare(right.name))
			.map(item => ({ ...item, children: finish(item.children) }))
	}
	return finish(root)
}

function getFolderPaths(items: TreeItem[]): string[] {
	return items.flatMap(item => (item.file ? [] : [item.path, ...getFolderPaths(item.children)]))
}

function TreeNode({
	node,
	depth,
	selectedIds,
	activeFileId,
	collapsedPaths,
	toggleFolder,
	toggleFile,
	toggleFiles,
	openFile,
	repositoryKind
}: {
	node: TreeItem
	depth: number
	selectedIds: Set<number>
	activeFileId?: number
	collapsedPaths: Set<string>
	toggleFolder: (path: string) => void
	toggleFile: (id: number) => void
	toggleFiles: (fileIds: number[], selected: boolean) => void
	openFile: (file: DiffFile) => void
	repositoryKind?: RepositoryKind
}) {
	const indent = depth * 16 + 12
	if (!node.file) {
		const expanded = !collapsedPaths.has(node.path)
		const selectedCount = node.selectableFileIds.reduce((count, fileId) => count + Number(selectedIds.has(fileId)), 0)
		const checked = node.selectableFileIds.length > 0 && selectedCount === node.selectableFileIds.length
		const indeterminate = selectedCount > 0 && !checked
		return (
			<>
				<div
					title={node.path}
					onClick={() => toggleFolder(node.path)}
					className='hover:bg-article/75 group flex min-h-7 w-full cursor-pointer items-center py-1 pr-2 text-sm opacity-70 transition hover:opacity-100 max-lg:min-h-11'
					style={{ paddingLeft: indent }}>
					<input
						ref={element => {
							if (element) element.indeterminate = indeterminate
						}}
						type='checkbox'
						checked={checked}
						onChange={() => toggleFiles(node.selectableFileIds, !checked)}
						onClick={event => event.stopPropagation()}
						disabled={!node.selectableFileIds.length}
						aria-label={`${node.path}：${indeterminate ? '部分选中' : checked ? '全部选中' : '未选中'}`}
						className='accent-brand mr-2 size-3.5 shrink-0'
					/>
					<span className='text-secondary flex size-5 shrink-0 items-center justify-center'>
						{node.children.length ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
					</span>
					<Folder size={14} className='mr-2 shrink-0 text-blue-400' />
					<span className='min-w-0 flex-1 truncate font-medium'>{node.name}</span>
					<span className='text-secondary/60 mr-1 text-[10px]'>{node.children.length}</span>
				</div>
				{expanded &&
					node.children.map(child => (
						<TreeNode
							key={child.path}
							node={child}
							depth={depth + 1}
							selectedIds={selectedIds}
							activeFileId={activeFileId}
							collapsedPaths={collapsedPaths}
							toggleFolder={toggleFolder}
							toggleFile={toggleFile}
							toggleFiles={toggleFiles}
							openFile={openFile}
							repositoryKind={repositoryKind}
						/>
					))}
			</>
		)
	}
	const file = node.file
	const disabled = file.isBinary || file.exportTooLarge || file.nodeKind === 'dir'
	const patchOnly = repositoryKind === 'svn' && file.previewTooLarge
	const canOpen = !file.isBinary && file.nodeKind !== 'dir' && (!file.previewTooLarge || patchOnly)
	return (
		<div
			title={file.path}
			onClick={() => canOpen && openFile(file)}
			className={`group flex min-h-7 w-full items-start py-1 pr-2 text-sm transition max-lg:min-h-11 max-lg:items-center ${canOpen ? 'cursor-pointer' : 'cursor-default'} ${activeFileId === file.fileId ? 'bg-brand/10' : 'hover:bg-article/75'} ${disabled ? 'opacity-35' : 'opacity-70 hover:opacity-100'}`}
			style={{ paddingLeft: indent }}>
			<span className='size-5 shrink-0' />
			<button
				onClick={event => {
					event.stopPropagation()
					if (!disabled) toggleFile(file.fileId)
				}}
				disabled={disabled}
				className='mr-2 flex h-5 w-4 shrink-0 items-center justify-center'>
				<input readOnly type='checkbox' checked={selectedIds.has(file.fileId)} disabled={disabled} className='accent-brand size-3.5' />
			</button>
			<span className='mr-2 flex h-5 w-4 shrink-0 items-center justify-center'>
				{file.isBinary ? (
					<FileImage size={14} className='text-orange-400' />
				) : file.previewTooLarge ? (
					<AlertOctagon size={14} className='text-red-400' />
				) : (
					<FileCode size={14} className='text-secondary' />
				)}
			</span>
			<div className='min-w-0 flex-1'>
				<div className='flex min-w-0 items-center gap-1.5'>
					<span className={`min-w-0 truncate ${activeFileId === file.fileId ? 'font-medium' : ''}`}>{node.name}</span>
					{(file.isBinary || file.previewTooLarge || file.nodeKind === 'dir') && (
						<span className='border-border bg-article text-secondary inline-flex h-4 shrink-0 items-center rounded border px-1.5 text-[10px]'>
							{file.isBinary ? 'Binary' : file.nodeKind === 'dir' ? '目录' : patchOnly ? '仅 Patch' : '过大'}
						</span>
					)}
				</div>
				{file.oldPath && <span className='text-secondary block truncate text-[10px]'>{file.oldPath}</span>}
			</div>
			<div className='mr-2 flex h-5 shrink-0 items-center gap-1 font-mono text-[10px]'>
				<span className='text-green-400'>+{file.additions}</span>
				<span className='text-red-400'>−{file.deletions}</span>
			</div>
			<Status status={file.status} />
			{file.propertiesChanged && <span className='border-border text-secondary mr-1 rounded border px-1 py-0.5 text-[9px]'>属性</span>}
		</div>
	)
}

function Status({ status }: { status: string }) {
	const letter = statusLetter(status)
	const tone =
		letter === 'A'
			? 'bg-green-500/20 text-green-500'
			: letter === 'D'
				? 'bg-red-500/20 text-red-500'
				: letter === 'R'
					? 'bg-purple-500/20 text-purple-500'
					: letter === 'C'
						? 'bg-orange-500/20 text-orange-500'
						: 'bg-blue-500/20 text-blue-500'
	return <span className={`mr-1 flex h-5 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${tone}`}>{letter}</span>
}
function statusLetter(status: string): StatusFilter {
	const letter = status.charAt(0).toUpperCase()
	if (letter === 'A' || letter === 'D' || letter === 'R' || letter === 'C' || letter === 'M') return letter
	if (status === 'Unversioned') return 'U'
	if (status === 'Missing') return '!'
	if (status === 'Obstructed') return '~'
	return 'M'
}
function isSelectableFile(file: DiffFile) {
	return !file.isBinary && !file.exportTooLarge && file.nodeKind !== 'dir'
}
function shortLabel(selection: VersionSelection) {
	return selection.kind === 'working-tree' ? '工作区' : selection.commit.shortHash
}
function longLabel(selection: VersionSelection) {
	return selection.kind === 'working-tree' ? '当前工作文件' : selection.commit.message
}
function Empty({ children }: { children: React.ReactNode }) {
	return <div className='text-secondary flex h-full items-center justify-center text-xs'>{children}</div>
}
