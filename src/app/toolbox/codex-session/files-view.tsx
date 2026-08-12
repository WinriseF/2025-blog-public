'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { BookOpenText, FileDiff, Search, X } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '@/components/select-menu'
import type { FileAudit, FileChangeOperation } from '@/lib/codex-session/types'
import type { DetailSelection } from './detail-panel'
import { fileOperationLabels, formatLineChanges, formatNumber } from './format'
import { VirtualList } from './virtual-list'

type OperationFilter = 'all' | FileChangeOperation

const OPERATION_FILTER_OPTIONS: readonly SelectMenuOption<OperationFilter>[] = [
	{ value: 'all', label: '全部' },
	{ value: 'create', label: '新增' },
	{ value: 'modify', label: '修改' },
	{ value: 'move', label: '移动' },
	{ value: 'delete', label: '删除' }
]

export function FilesView({ audit, onSelect }: { audit: FileAudit; onSelect: (selection: DetailSelection) => void }) {
	const [mode, setMode] = useState<'changes' | 'reads'>('changes')
	const [query, setQuery] = useState('')
	const [operation, setOperation] = useState<OperationFilter>('all')
	const deferredQuery = useDeferredValue(query.trim().toLowerCase())
	const additions = audit.changes.reduce((total, file) => total + file.additions, 0)
	const deletions = audit.changes.reduce((total, file) => total + file.deletions, 0)
	const successfulPatches = audit.patchAttempts - audit.failedPatchAttempts
	const changes = useMemo(() => audit.changes.filter(file => {
		if (operation !== 'all' && !file.operations.includes(operation)) return false
		return !deferredQuery || [file.path, ...file.originalPaths].some(path => path.toLowerCase().includes(deferredQuery))
	}), [audit.changes, deferredQuery, operation])
	const reads = useMemo(() => audit.reads.filter(file => !deferredQuery || file.path.toLowerCase().includes(deferredQuery)), [audit.reads, deferredQuery])
	const stats = [
		['修改文件', audit.changes.length],
		['成功补丁', successfulPatches],
		['失败补丁', audit.failedPatchAttempts],
		['补丁新增 / 删除行', formatLineChanges(additions, deletions)],
		['读取文件', audit.reads.length],
		['读取 / 搜索操作', `${formatNumber(audit.readOperations)} / ${formatNumber(audit.searchOperations)}`]
	] as const

	return (
		<div>
			<div className='mb-5 grid grid-cols-2 border-y border-border sm:grid-cols-3 xl:grid-cols-6'>
				{stats.map(([label, value], index) => <div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'xl:border-l xl:border-border' : ''}`}>
					<p className='text-secondary truncate text-[10px]'>{label}</p>
					<p className={`mt-1 truncate text-base font-semibold ${label === '失败补丁' && value ? 'text-rose-500' : label === '补丁新增 / 删除行' ? 'text-sm' : ''}`}>{typeof value === 'number' ? formatNumber(value) : value}</p>
				</div>)}
			</div>

			<div className='mb-4 flex flex-wrap items-center gap-2'>
				<div className='flex rounded-lg border border-border bg-background/25 p-1' role='tablist' aria-label='文件审计类型'>
					<button type='button' role='tab' aria-selected={mode === 'changes'} onClick={() => setMode('changes')} className={`rounded-md px-3 py-1.5 text-xs transition ${mode === 'changes' ? 'bg-brand text-white' : 'text-secondary hover:text-primary'}`}>修改 {formatNumber(audit.changes.length)}</button>
					<button type='button' role='tab' aria-selected={mode === 'reads'} onClick={() => setMode('reads')} className={`rounded-md px-3 py-1.5 text-xs transition ${mode === 'reads' ? 'bg-brand text-white' : 'text-secondary hover:text-primary'}`}>读取 {formatNumber(audit.reads.length)}</button>
				</div>
				<label className='focus-within:border-brand/50 flex min-w-52 flex-1 items-center gap-2 rounded-lg border border-border bg-background/25 px-3 py-2.5 transition'>
					<Search size={15} className='text-secondary shrink-0' />
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'changes' ? '搜索真正修改过的文件' : '搜索明确读取过的文件'} className='min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-secondary/70' />
					{query && <button type='button' onClick={() => setQuery('')} aria-label='清除文件搜索' className='text-secondary hover:text-primary'><X size={14} /></button>}
				</label>
				{mode === 'changes' && <SelectMenu value={operation} options={OPERATION_FILTER_OPTIONS} onChange={setOperation} ariaLabel='筛选文件变更' className='min-w-28' />}
			</div>

			{mode === 'changes' ? <VirtualList
				items={changes}
				estimateSize={80}
				getKey={file => file.key}
				empty='没有匹配的成功文件变更'
				renderItem={file => <button type='button' onClick={() => onSelect({ type: 'file-change', value: file })} className='hover:bg-background/25 block w-full border-b border-border px-3 py-4 text-left transition-colors'>
						<div className='flex items-start gap-3'>
							<span className='text-brand flex size-8 shrink-0 items-center justify-center'><FileDiff size={16} /></span>
							<div className='min-w-0 flex-1'>
								<p className='truncate font-mono text-xs font-medium' title={file.path}>{file.path}</p>
								<div className='mt-2 flex flex-wrap items-center gap-2 text-[10px]'>
									<span className='text-brand'>{file.operations.map(item => fileOperationLabels[item]).join(' / ')}</span>
									<span className='text-secondary'>{formatNumber(file.patches.length)} 次成功补丁</span>
									{(file.additions > 0 || file.deletions > 0) && <span className='ml-auto flex gap-2'>
										{file.additions > 0 && <span className='text-emerald-600'>+{formatNumber(file.additions)}</span>}
										{file.deletions > 0 && <span className='text-rose-500'>-{formatNumber(file.deletions)}</span>}
									</span>}
								</div>
							</div>
						</div>
					</button>}
			/> : <VirtualList
				items={reads}
				estimateSize={88}
				getKey={file => file.key}
				empty='没有匹配的明确文件读取记录'
				renderItem={file => {
					const completed = file.occurrences.filter(item => item.status === 'completed').length
					const failed = file.occurrences.filter(item => item.status === 'failed' || item.status === 'interrupted').length
					const unknown = file.count - completed - failed
					return <button type='button' onClick={() => onSelect({ type: 'file-read', value: file })} className='hover:bg-background/25 flex w-full items-center gap-3 border-b border-border px-3 py-4 text-left transition-colors'>
						<span className='text-secondary flex size-8 shrink-0 items-center justify-center'><BookOpenText size={16} /></span>
						<div className='min-w-0 flex-1'>
							<p className='truncate font-mono text-xs font-medium' title={file.path}>{file.path}</p>
							<p className='text-secondary mt-2 text-[10px]'>读取 {formatNumber(file.count)} 次 · 成功 {formatNumber(completed)} · 失败 {formatNumber(failed)} · 未知 {formatNumber(unknown)}</p>
						</div>
					</button>
				}}
			/>}
		</div>
	)
}
