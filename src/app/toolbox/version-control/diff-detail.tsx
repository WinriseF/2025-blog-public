'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertOctagon, ArrowRight, ChevronDown, ChevronRight, FileCode, FileDown, FileImage, Folder, FolderOpen } from 'lucide-react'
import { useVersionControlStore, type VersionSelection } from '@/lib/version-control/store'
import type { DiffFile, WorkingTreeGroup } from '@/lib/version-control/types'
import { GitRefBadges } from './git-ref-badges'
import { ExportDialog } from './export-dialog'

const groups: Array<{ value: WorkingTreeGroup; label: string }> = [
	{ value: 'all', label: '全部' },
	{ value: 'staged', label: '暂存' },
	{ value: 'unstaged', label: '未暂存' },
	{ value: 'untracked', label: '未跟踪' },
	{ value: 'conflicted', label: '冲突' }
]

export function DiffDetail() {
	const overview = useVersionControlStore(state => state.overview)
	const selection = useVersionControlStore(state => state.selection)
	const comparison = useVersionControlStore(state => state.comparison)
	const group = useVersionControlStore(state => state.group)
	const setGroup = useVersionControlStore(state => state.setGroup)
	const diff = useVersionControlStore(state => state.diff)
	const files = useVersionControlStore(state => state.files)
	const selectedIds = useVersionControlStore(state => state.selectedFileIds)
	const activeFile = useVersionControlStore(state => state.activeFile)
	const loading = useVersionControlStore(state => state.loading)
	const toggleFile = useVersionControlStore(state => state.toggleFile)
	const toggleFiles = useVersionControlStore(state => state.toggleFiles)
	const openFile = useVersionControlStore(state => state.openFile)
	const [exportOpen, setExportOpen] = useState(false)
	const tree = useMemo(() => buildTree(files), [files])

	return (
		<section className='bg-background flex h-full min-w-0 flex-col overflow-hidden'>
			<header className='border-border border-b px-4 py-3'>
				<Header selection={selection} comparison={comparison} repositoryName={overview?.displayName || ''} />
			</header>
			<div className='border-border bg-article/45 flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5'>
				<span className='text-secondary mr-auto text-[10px]'>{loading ? '读取中…' : `${diff?.summary.filesChanged || files.length} 个文件发生变化`}</span>
				{diff && !loading && (
					<>
						<Pill>A {diff.summary.filesAdded}</Pill>
						<Pill>M {diff.summary.filesModified}</Pill>
						<Pill>D {diff.summary.filesDeleted}</Pill>
						<Pill>R {diff.summary.filesRenamed}</Pill>
						<Pill tone='border-green-500/30 bg-green-500/10 text-green-400'>+{diff.summary.insertions}</Pill>
						<Pill tone='border-red-500/30 bg-red-500/10 text-red-400'>−{diff.summary.deletions}</Pill>
					</>
				)}
				<button
					onClick={() => setExportOpen(true)}
					disabled={!selectedIds.size}
					className='text-secondary hover:bg-article hover:text-primary flex items-center gap-1 rounded px-2 py-1 text-[10px] transition disabled:opacity-40'>
					<FileDown size={12} />
					导出 {selectedIds.size}
				</button>
			</div>
			{selection?.kind === 'working-tree' && !comparison && (
				<nav className='border-border flex gap-1 border-b px-3 py-1.5'>
					{groups.map(item => (
						<button
							key={item.value}
							onClick={() => void setGroup(item.value)}
							className={`rounded px-2.5 py-1 text-[11px] ${group === item.value ? 'bg-brand/12 text-brand font-medium' : 'text-secondary hover:bg-article hover:text-primary'}`}>
							{item.label}
						</button>
					))}
				</nav>
			)}
			<div className='min-h-0 flex-1 overflow-y-auto'>
				{loading && !files.length ? (
					<Empty>正在读取差异…</Empty>
				) : !files.length ? (
					<Empty>这个视角没有文件变更</Empty>
				) : (
					tree.map(node => (
						<TreeNode
							key={node.path}
							node={node}
							depth={0}
							selectedIds={selectedIds}
							activeFileId={activeFile?.fileId}
							toggleFile={toggleFile}
							toggleFiles={toggleFiles}
							openFile={openFile}
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

function Pill({ children, tone = 'border-border text-secondary' }: { children: React.ReactNode; tone?: string }) {
	return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{children}</span>
}

type TreeItem = { name: string; path: string; children: TreeItem[]; selectableFileIds: number[]; file?: DiffFile }
type MutableTreeItem = Omit<TreeItem, 'children'> & { children: Map<string, MutableTreeItem> }

function buildTree(files: DiffFile[]) {
	const root = new Map<string, MutableTreeItem>()
	for (const file of files) {
		let level = root
		let path = ''
		const selectable = !file.isBinary && !file.exportTooLarge
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

function TreeNode({
	node,
	depth,
	selectedIds,
	activeFileId,
	toggleFile,
	toggleFiles,
	openFile
}: {
	node: TreeItem
	depth: number
	selectedIds: Set<number>
	activeFileId?: number
	toggleFile: (id: number) => void
	toggleFiles: (fileIds: number[], selected: boolean) => void
	openFile: (file: DiffFile) => void
}) {
	const [expanded, setExpanded] = useState(true)
	const indent = depth * 16 + 12
	if (!node.file) {
		const checked = node.selectableFileIds.length > 0 && node.selectableFileIds.every(fileId => selectedIds.has(fileId))
		return (
			<>
				<div
					title={node.path}
					onClick={() => setExpanded(value => !value)}
					className='hover:bg-article/75 group flex w-full cursor-pointer items-center py-1 pr-2 text-sm opacity-70 transition hover:opacity-100'
					style={{ paddingLeft: indent }}>
					<button
						onClick={event => {
							event.stopPropagation()
							toggleFiles(node.selectableFileIds, !checked)
						}}
						disabled={!node.selectableFileIds.length}
						className='mr-2 flex size-4 items-center justify-center'>
						<input readOnly type='checkbox' checked={checked} disabled={!node.selectableFileIds.length} className='accent-brand size-3.5' />
					</button>
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
							toggleFile={toggleFile}
							toggleFiles={toggleFiles}
							openFile={openFile}
						/>
					))}
			</>
		)
	}
	const file = node.file
	const disabled = file.isBinary || file.exportTooLarge
	return (
		<div
			title={file.path}
			onClick={() => !file.isBinary && !file.previewTooLarge && openFile(file)}
			className={`group flex w-full cursor-pointer items-start py-1 pr-2 text-sm transition ${activeFileId === file.fileId ? 'bg-brand/10' : 'hover:bg-article/75'} ${disabled ? 'opacity-35' : 'opacity-70 hover:opacity-100'}`}
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
					{(file.isBinary || file.previewTooLarge) && (
						<span className='border-border bg-article text-secondary inline-flex h-4 shrink-0 items-center rounded border px-1.5 text-[10px]'>
							{file.isBinary ? 'Binary' : '过大'}
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
		</div>
	)
}

function Status({ status }: { status: string }) {
	const letter = status.charAt(0).toUpperCase()
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
function shortLabel(selection: VersionSelection) {
	return selection.kind === 'working-tree' ? '工作区' : selection.commit.shortHash
}
function longLabel(selection: VersionSelection) {
	return selection.kind === 'working-tree' ? '当前工作文件' : selection.commit.message
}
function Empty({ children }: { children: React.ReactNode }) {
	return <div className='text-secondary flex h-full items-center justify-center text-xs'>{children}</div>
}
