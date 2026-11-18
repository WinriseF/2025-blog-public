'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Download, ListTree, File, Folder, FolderOpen, Search } from 'lucide-react'
import type { ZipNode, ZipScanResult, ZipSelectionState } from '@/lib/zip-packer'

type TreeRow = { node: ZipNode; depth: number; searchResult: boolean }

export function ZipFileTree({
	scan,
	title,
	states,
	loadingDirectoryIds,
	onToggle,
	onSelectAll,
	onRestoreSuggestions,
	onLoadDirectory,
	onSave
}: {
	scan: Pick<ZipScanResult, 'nodes' | 'rootId'>
	title: string
	states: Map<string, ZipSelectionState>
	loadingDirectoryIds?: Set<string>
	onToggle?: (id: string, checked: boolean) => void
	onSelectAll?: () => void
	onRestoreSuggestions?: () => void
	onLoadDirectory?: (id: string) => void
	onSave?: (node: ZipNode) => void
}) {
	const [query, setQuery] = useState('')
	const [expanded, setExpanded] = useState(() => new Set(scan.rootId ? [scan.rootId] : []))
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const nodesById = useMemo(() => new Map(scan.nodes.map(node => [node.id, node])), [scan.nodes])
	const normalizedQuery = query.trim().toLocaleLowerCase()

	const rows = useMemo(() => {
		if (normalizedQuery) {
			return scan.nodes
				.filter(node => node.path.toLocaleLowerCase().includes(normalizedQuery))
				.map(node => ({ node, depth: 0, searchResult: true }))
		}
		const result: TreeRow[] = []
		const visit = (node: ZipNode, depth: number) => {
			result.push({ node, depth, searchResult: false })
			if (node.kind !== 'directory' || !expanded.has(node.id)) return
			for (const id of node.children) {
				const child = nodesById.get(id)
				if (child) visit(child, depth + 1)
			}
		}
		if (scan.rootId) {
			const root = nodesById.get(scan.rootId)
			if (root) visit(root, 0)
		} else {
			for (const node of scan.nodes) if (node.parentId === null) visit(node, 0)
		}
		return result
	}, [expanded, nodesById, normalizedQuery, scan.nodes, scan.rootId])

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 40,
		overscan: 10,
		getItemKey: index => rows[index].node.id,
		useFlushSync: false
	})

	const toggleExpanded = (node: ZipNode) => {
		const shouldLoad = node.kind === 'directory' && !node.loaded && !expanded.has(node.id)
		setExpanded(current => {
			const next = new Set(current)
			if (next.has(node.id)) next.delete(node.id)
			else next.add(node.id)
			return next
		})
		if (shouldLoad) onLoadDirectory?.(node.id)
	}

	return (
		<section className='flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-background/20'>
			<header className='border-border border-b p-4'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h2 className='flex items-center gap-2 font-semibold text-primary'><ListTree size={18} className='text-brand' />{title}</h2>
					</div>
					<div className='flex items-center gap-2 text-xs'>
						{onSelectAll && <button type='button' onClick={onSelectAll} className='rounded-lg border border-border px-3 py-2 text-secondary transition hover:text-primary'>全选</button>}
						{onRestoreSuggestions && <button type='button' onClick={onRestoreSuggestions} className='rounded-lg border border-border px-3 py-2 text-secondary transition hover:text-primary'>恢复建议</button>}
					</div>
				</div>
				<label className='mt-4 flex h-10 items-center gap-2 rounded-xl border border-border bg-background/35 px-3'>
					<Search size={15} className='text-secondary' />
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索文件名或路径' className='min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-secondary/65' />
				</label>
			</header>

			<div ref={scrollRef} className='max-h-[62dvh] min-h-36 sm:min-h-60 overflow-auto overscroll-contain'>
				<div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
					{!rows.length && <p className='px-4 py-3 text-secondary'>{query ? '没有匹配的文件' : '压缩包为空'}</p>}
					{virtualizer.getVirtualItems().map(virtualRow => {
						const row = rows[virtualRow.index]
						const node = row.node
						const state = states.get(node.id) || 'unchecked'
						const isExpanded = expanded.has(node.id)
						const isLoading = loadingDirectoryIds?.has(node.id)
						return (
							<div
								key={node.id}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className='absolute top-0 left-0 w-full'
								style={{ transform: `translateY(${virtualRow.start}px)` }}>
								<div className='group flex h-10 items-center border-b border-border/45 pr-3 text-sm hover:bg-article/60' style={{ paddingLeft: row.searchResult ? 12 : row.depth * 18 + 10 }}>
									{node.kind === 'directory' ? (
										<button type='button' onClick={() => toggleExpanded(node)} className='flex size-7 shrink-0 items-center justify-center text-secondary' aria-label={isExpanded ? '收起目录' : '展开目录'}>
											{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
										</button>
									) : <span className='w-7 shrink-0' />}
									{onToggle && <TreeCheckbox label={node.path} state={state} onChange={checked => onToggle(node.id, checked)} />}
									{node.kind === 'directory' ? (
										<button type='button' onClick={() => toggleExpanded(node)} className='flex h-full min-w-0 flex-1 items-center text-left'>
											{isExpanded ? <FolderOpen size={16} className='ml-2 shrink-0 text-blue-400' /> : <Folder size={16} className='ml-2 shrink-0 text-blue-400' />}
											<span className='ml-2 min-w-0 flex-1 truncate text-primary' title={node.path}>{row.searchResult ? node.path : node.name}</span>
											{node.suggestedExcluded && <span className='mr-2 shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300'>建议排除</span>}
											{!node.loaded && <span className='mr-2 shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-700 dark:text-blue-300'>{isLoading ? '正在读取' : '按需读取'}</span>}
										</button>
									) : (
										<>
											<File size={15} className='ml-2 shrink-0 text-secondary' />
											<span className='ml-2 min-w-0 flex-1 truncate text-primary' title={node.path}>{row.searchResult ? node.path : node.name}</span>
											<span className='shrink-0 font-mono text-[10px] text-secondary'>{formatBytes(node.size)}</span>
											{onSave && <button type='button' aria-label={`保存 ${node.path}`} title='保存文件' onClick={() => onSave(node)} className='ml-3 flex size-8 items-center justify-center rounded-lg border border-brand/20 bg-brand/5 text-brand transition hover:border-brand/50 hover:bg-brand/15'><Download size={16} /></button>}
										</>
									)}
								</div>
							</div>
						)
					})}
				</div>
			</div>

		</section>
	)
}

function TreeCheckbox({ label, state, onChange }: { label: string; state: ZipSelectionState; onChange: (checked: boolean) => void }) {
	const ref = useRef<HTMLInputElement | null>(null)
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = state === 'mixed'
	}, [state])
	return <input ref={ref} aria-label={label} type='checkbox' checked={state === 'checked'} onChange={event => onChange(event.currentTarget.checked)} className='size-4 shrink-0 accent-[var(--color-brand)]' />
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
