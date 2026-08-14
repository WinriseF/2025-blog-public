'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File, FileCode2, FileImage, Folder, FolderOpen, GitFork, Link2, Loader2, RotateCcw } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { RepositoryTreeEntry } from '@/lib/version-control/types'
import { RepositorySidebarHeader, type RepositoryViewMode } from './repository-sidebar-header'

type DirectoryState = {
	items: RepositoryTreeEntry[]
	nextCursor: string | null
	loaded: boolean
	loading: boolean
	error: string | null
}

type TreeRow =
	| { type: 'entry'; entry: RepositoryTreeEntry; depth: number }
	| { type: 'status'; path: string; depth: number; state: DirectoryState }

export function RepositoryTree({
	mode,
	onModeChange,
	selectedPath,
	onSelect
}: {
	mode: RepositoryViewMode
	onModeChange: (mode: RepositoryViewMode) => void
	selectedPath: string | null
	onSelect: (entry: RepositoryTreeEntry) => void
}) {
	const repository = useVersionControlStore(state => state.repository)
	const overview = useVersionControlStore(state => state.overview)
	const [query, setQuery] = useState('')
	const [directories, setDirectories] = useState<Map<string, DirectoryState>>(() => new Map())
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
	const generation = useRef(0)

	const loadDirectory = useCallback(
		async (path: string, cursor: string | null, requestGeneration = generation.current) => {
			if (!repository) return
			setDirectories(current => {
				const next = new Map(current)
				const previous = next.get(path)
				next.set(path, {
					items: previous?.items || [],
					nextCursor: previous?.nextCursor || null,
					loaded: previous?.loaded || false,
					loading: true,
					error: null
				})
				return next
			})
			try {
				const page = await repository.getDirectory(path, cursor)
				if (requestGeneration !== generation.current) return
				setDirectories(current => {
					const next = new Map(current)
					const previous = next.get(path)
					next.set(path, {
						items: cursor ? [...(previous?.items || []), ...page.items] : page.items,
						nextCursor: page.nextCursor,
						loaded: true,
						loading: false,
						error: null
					})
					return next
				})
			} catch (error) {
				if (requestGeneration !== generation.current) return
				setDirectories(current => {
					const next = new Map(current)
					const previous = next.get(path)
					next.set(path, {
						items: previous?.items || [],
						nextCursor: previous?.nextCursor || null,
						loaded: previous?.loaded || false,
						loading: false,
						error: error instanceof Error ? error.message : String(error)
					})
					return next
				})
			}
		},
		[repository]
	)

	useEffect(() => {
		const nextGeneration = ++generation.current
		setDirectories(new Map())
		setExpanded(new Set())
		setQuery('')
		void loadDirectory('', null, nextGeneration)
	}, [loadDirectory, overview])

	const rows = useMemo(() => flattenTree(directories, expanded), [directories, expanded])
	const loadedEntries = useMemo(() => {
		const unique = new Map<string, RepositoryTreeEntry>()
		for (const directory of directories.values()) for (const entry of directory.items) unique.set(entry.path, entry)
		return [...unique.values()]
	}, [directories])
	const normalizedQuery = query.trim().toLocaleLowerCase()
	const searchResults = useMemo(
		() =>
			normalizedQuery
				? loadedEntries
						.filter(entry => entry.path.toLocaleLowerCase().includes(normalizedQuery))
						.sort((left, right) => left.path.localeCompare(right.path))
				: [],
		[loadedEntries, normalizedQuery]
	)

	const toggleDirectory = (path: string) => {
		const isExpanded = expanded.has(path)
		setExpanded(current => {
			const next = new Set(current)
			if (isExpanded) next.delete(path)
			else next.add(path)
			return next
		})
		const state = directories.get(path)
		if (!isExpanded && !state?.loaded && !state?.loading) void loadDirectory(path, null)
	}

	const openSearchResult = (entry: RepositoryTreeEntry) => {
		if (entry.kind !== 'directory') {
			onSelect(entry)
			return
		}
		setQuery('')
		setExpanded(current => {
			const next = new Set(current)
			let path = ''
			for (const part of entry.path.split('/')) {
				path = path ? `${path}/${part}` : part
				next.add(path)
			}
			return next
		})
		if (!directories.get(entry.path)?.loaded) void loadDirectory(entry.path, null)
	}

	const root = directories.get('')
	const fileCount = loadedEntries.filter(entry => entry.kind === 'file').length
	const folderCount = loadedEntries.filter(entry => entry.kind === 'directory').length

	return (
		<aside className='border-border bg-background flex h-full w-full flex-col border-r'>
			<RepositorySidebarHeader mode={mode} onModeChange={onModeChange} query={query} onQueryChange={setQuery} placeholder='筛选已加载路径' overview={overview} />
			<div className='min-h-0 flex-1 overflow-y-auto py-1'>
				{normalizedQuery ? (
					searchResults.length ? (
						searchResults.map(entry => <EntryRow key={entry.path} entry={entry} depth={0} active={selectedPath === entry.path} searchResult onOpen={() => openSearchResult(entry)} />)
					) : (
						<PanelState>没有匹配的已加载路径</PanelState>
					)
				) : root?.loading && !root.loaded ? (
					<PanelState>
						<Loader2 size={16} className='text-brand animate-spin' />
						正在读取文件…
					</PanelState>
				) : root?.error && !root.loaded ? (
					<PanelState>
						<button onClick={() => void loadDirectory('', null)} className='text-secondary hover:text-primary flex items-center gap-1.5'>
							<RotateCcw size={13} /> 重试
						</button>
					</PanelState>
				) : root?.loaded && !root.items.length ? (
					<PanelState>当前目录是空的</PanelState>
				) : (
					rows.map(row =>
						row.type === 'entry' ? (
							<EntryRow
								key={row.entry.path}
								entry={row.entry}
								depth={row.depth}
								active={selectedPath === row.entry.path}
								expanded={expanded.has(row.entry.path)}
								loading={directories.get(row.entry.path)?.loading}
								onOpen={() => (row.entry.kind === 'directory' ? toggleDirectory(row.entry.path) : onSelect(row.entry))}
							/>
						) : (
							<DirectoryStatus key={`status:${row.path}`} row={row} onLoad={() => void loadDirectory(row.path, row.state.loaded ? row.state.nextCursor : null)} />
						)
					))}
			</div>
			<footer className='border-border text-secondary flex h-7 shrink-0 items-center border-t px-3 text-[10px]'>
				{fileCount} 个文件<span className='mx-1.5 opacity-40'>·</span>{folderCount} 个文件夹
				<span className='ml-auto'>当前版本</span>
			</footer>
		</aside>
	)
}

function flattenTree(directories: Map<string, DirectoryState>, expanded: Set<string>) {
	const rows: TreeRow[] = []
	const visit = (path: string, depth: number) => {
		const state = directories.get(path)
		for (const entry of state?.items || []) {
			rows.push({ type: 'entry', entry, depth })
			if (entry.kind === 'directory' && expanded.has(entry.path)) visit(entry.path, depth + 1)
		}
		if (state && (state.loading || state.error || state.nextCursor)) rows.push({ type: 'status', path, depth, state })
	}
	visit('', 0)
	return rows
}

function EntryRow({ entry, depth, active, expanded, loading, searchResult, onOpen }: { entry: RepositoryTreeEntry; depth: number; active: boolean; expanded?: boolean; loading?: boolean; searchResult?: boolean; onOpen: () => void }) {
	const directory = entry.kind === 'directory'
	return (
		<button
			type='button'
			title={entry.path}
			onClick={onOpen}
			className={`group flex h-8 w-full items-center border-l-2 pr-2 text-left text-xs transition ${active ? 'border-l-brand bg-brand/10 text-primary' : 'hover:bg-article/70 border-l-transparent'} ${entry.isBinary || entry.kind === 'symlink' ? 'text-secondary/65' : 'text-secondary hover:text-primary'}`}
			style={{ paddingLeft: searchResult ? 10 : depth * 14 + 8 }}>
			<span className='flex size-4 shrink-0 items-center justify-center'>
				{directory ? loading ? <Loader2 size={11} className='animate-spin' /> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
			</span>
			<EntryIcon entry={entry} expanded={expanded} />
			<span className={`ml-2 min-w-0 flex-1 truncate ${directory ? 'font-medium' : ''}`}>{searchResult ? entry.path : entry.name}</span>
			{entry.size !== null && <span className='ml-2 shrink-0 font-mono text-[9px] opacity-45'>{formatBytes(entry.size)}</span>}
		</button>
	)
}

function EntryIcon({ entry, expanded }: { entry: RepositoryTreeEntry; expanded?: boolean }) {
	if (entry.kind === 'directory') return expanded ? <FolderOpen size={14} className='shrink-0 text-blue-400' /> : <Folder size={14} className='shrink-0 text-blue-400' />
	if (entry.kind === 'submodule') return <GitFork size={14} className='shrink-0 text-violet-400' />
	if (entry.kind === 'symlink') return <Link2 size={14} className='shrink-0 text-cyan-400' />
	if (entry.isBinary) return <FileImage size={14} className='shrink-0 text-pink-300' />
	return /\.(?:[cm]?[jt]sx?|css|go|html?|java|kt|md|php|py|rb|rs|sh|sql|svelte|swift|vue|ya?ml)$/i.test(entry.name) ? <FileCode2 size={14} className='text-brand shrink-0' /> : <File size={14} className='shrink-0 opacity-70' />
}

function DirectoryStatus({ row, onLoad }: { row: Extract<TreeRow, { type: 'status' }>; onLoad: () => void }) {
	return (
		<div className='text-secondary flex h-7 items-center text-[10px]' style={{ paddingLeft: row.depth * 14 + 28 }}>
			{row.state.loading ? (
				<><Loader2 size={11} className='mr-1.5 animate-spin' />读取中…</>
			) : (
				<button onClick={onLoad} className='hover:text-primary flex items-center gap-1.5'>
					{row.state.error ? <><RotateCcw size={11} />重试</> : '加载更多'}
				</button>
			)}
		</div>
	)
}

function PanelState({ children }: { children: React.ReactNode }) {
	return <div className='text-secondary flex h-40 items-center justify-center gap-2 px-5 text-center text-xs'>{children}</div>
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
