'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { Code2, Container, FileText, GitBranch, Hammer, Network, Package, Search, Settings2, Terminal, X } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '@/components/select-menu'
import { commandSignature, isAuditCommand } from '@/lib/codex-session/command-semantics'
import type { CommandCategory, ParsedCommand, ProcessRun } from '@/lib/codex-session/types'
import { batchStatusLabel, categoryLabels, commandContexts, executionLabel } from './command-format'
import type { DetailSelection } from './detail-types'
import { compactText, formatNumber } from './format'
import { VirtualList } from './virtual-list'

type CommandRow = { id: string; process: ProcessRun; command: ParsedCommand; signature: string }
type CommandFilter = 'all' | CommandCategory | 'failed' | 'unknown'

const COMMAND_FILTER_OPTIONS: readonly SelectMenuOption<CommandFilter>[] = [
	{ value: 'all', label: '全部关键命令' },
	{ value: 'git', label: 'Git' },
	{ value: 'docker', label: 'Docker' },
	{ value: 'package', label: '包管理' },
	{ value: 'build', label: '构建' },
	{ value: 'runtime', label: '运行时' },
	{ value: 'file', label: '文件变更命令' },
	{ value: 'network', label: '网络' },
	{ value: 'system', label: '系统' },
	{ value: 'other', label: '其他程序' },
	{ value: 'failed', label: '失败 / 中断批次内命令' },
	{ value: 'unknown', label: '结果未知批次内命令' }
]

function CategoryIcon({ category }: { category: CommandCategory }) {
	if (category === 'git') return <GitBranch size={16} />
	if (category === 'docker') return <Container size={16} />
	if (category === 'package') return <Package size={16} />
	if (category === 'build') return <Hammer size={16} />
	if (category === 'runtime') return <Code2 size={16} />
	if (category === 'file') return <FileText size={16} />
	if (category === 'network') return <Network size={16} />
	if (category === 'system') return <Settings2 size={16} />
	return <Terminal size={16} />
}

function statusClass(status: ProcessRun['status']) {
	if (status === 'failed' || status === 'interrupted') return 'text-rose-500'
	if (status === 'completed') return 'text-emerald-600'
	return 'text-amber-600'
}

function matchesFilter(row: CommandRow, filter: CommandFilter) {
	if (filter === 'all') return true
	if (filter === 'failed') return row.process.status === 'failed' || row.process.status === 'interrupted'
	if (filter === 'unknown') return !['completed', 'failed', 'interrupted'].includes(row.process.status)
	return row.command.category === filter
}

export function CommandsView({ processes, onSelect }: { processes: ProcessRun[]; onSelect: (selection: DetailSelection) => void }) {
	const [query, setQuery] = useState('')
	const [filter, setFilter] = useState<CommandFilter>('all')
	const [signatureFilter, setSignatureFilter] = useState('')
	const deferredQuery = useDeferredValue(query.trim().toLowerCase())
	const allRows = useMemo<CommandRow[]>(() => processes.flatMap(process => (process.analysis?.commands ?? [])
		.filter(isAuditCommand)
		.map(command => ({ id: command.id, process, command, signature: commandSignature(command) }))), [processes])
	const auditedProcesses = useMemo(() => [...new Map(allRows.map(row => [row.process.id, row.process])).values()], [allRows])
	const signatureCounts = useMemo(() => {
		const counts = new Map<string, number>()
		for (const row of allRows) counts.set(row.signature, (counts.get(row.signature) ?? 0) + 1)
		return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
	}, [allRows])
	const countBySignature = useMemo(() => new Map(signatureCounts), [signatureCounts])
	const items = useMemo(() => allRows.filter(row => {
		if (!matchesFilter(row, filter) || (signatureFilter && row.signature !== signatureFilter)) return false
		if (!deferredQuery) return true
		const command = row.command
		return [row.signature, command.summary, command.name, command.subcommand, categoryLabels[command.category], command.raw, row.process.command, row.process.cwd]
			.some(value => value?.toLowerCase().includes(deferredQuery))
	}), [allRows, deferredQuery, filter, signatureFilter])
	const visibleProcesses = useMemo(() => new Set(items.map(row => row.process.id)).size, [items])
	const visibleBatchLabel = filter === 'failed' ? '失败 / 中断批次' : filter === 'unknown' ? '结果未知批次' : '执行批次'
	const successful = auditedProcesses.filter(process => process.status === 'completed').length
	const failed = auditedProcesses.filter(process => process.status === 'failed' || process.status === 'interrupted').length
	const unknown = auditedProcesses.length - successful - failed
	const stats = [
		['关键命令', allRows.length],
		['执行批次', auditedProcesses.length],
		['成功批次', successful],
		['失败 / 中断批次', failed],
		['结果未知批次', unknown]
	] as const

	return (
		<div>
			<div className='mb-5 grid grid-cols-2 border-y border-border sm:grid-cols-5'>
				{stats.map(([label, value], index) => <div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'sm:border-l sm:border-border' : ''}`}>
					<p className='text-secondary truncate text-[10px]'>{label}</p>
					<p className={`mt-1 text-lg font-semibold ${label === '成功批次' ? 'text-emerald-600' : label === '失败 / 中断批次' && value ? 'text-rose-500' : label === '结果未知批次' && value ? 'text-amber-600' : ''}`}>{formatNumber(value)}</p>
				</div>)}
			</div>

			<section className='mb-5 border-b border-border pb-5'>
				<div className='mb-3 flex items-center justify-between gap-3'>
					<h3 className='text-xs font-semibold'>命令频次</h3>
					{signatureFilter && <button type='button' onClick={() => setSignatureFilter('')} className='text-brand text-xs'>清除筛选</button>}
				</div>
				{signatureCounts.length ? <div className='grid max-h-44 gap-x-5 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3'>
					{signatureCounts.map(([signature, count]) => <button key={signature} type='button' onClick={() => setSignatureFilter(current => current === signature ? '' : signature)} className={`flex min-w-0 items-center gap-3 border-b py-2 text-left text-xs transition ${signatureFilter === signature ? 'border-brand text-brand' : 'border-border hover:text-brand'}`}>
						<span className='min-w-0 flex-1 truncate font-mono' title={signature}>{signature}</span>
						<span className='text-secondary tabular-nums'>{formatNumber(count)}</span>
					</button>)}
				</div> : <p className='text-secondary text-xs'>没有识别到关键命令。</p>}
			</section>

			<div className='mb-4 flex flex-wrap items-center gap-2'>
				<label className='focus-within:border-brand/50 flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-border bg-background/25 px-3 py-2.5 transition'>
					<Search size={15} className='text-secondary shrink-0' />
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索 git、pnpm build、用途、命令或目录' className='min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-secondary/70' />
					{query && <button type='button' onClick={() => setQuery('')} aria-label='清除命令搜索' className='text-secondary hover:text-primary'><X size={14} /></button>}
				</label>
				<SelectMenu value={filter} options={COMMAND_FILTER_OPTIONS} onChange={setFilter} ariaLabel='筛选命令' className='min-w-40' />
			</div>
			<p className='text-secondary mb-3 text-[11px]'>当前显示 <span className='font-semibold text-primary'>{formatNumber(items.length)}</span> 条关键命令，来自 <span className='font-semibold text-primary'>{formatNumber(visibleProcesses)}</span> 个{visibleBatchLabel}</p>

			<VirtualList
				items={items}
				estimateSize={132}
				getKey={row => row.id}
				empty='没有匹配的关键命令'
				renderItem={row => {
					const { command, process } = row
					const contexts = commandContexts(command)
					return <button type='button' onClick={() => onSelect({ type: 'command', value: { process, command } })} className='hover:bg-background/25 block w-full border-b border-border px-3 py-4 text-left transition-colors'>
						<div className='flex items-start gap-3'>
							<span className={`flex size-8 shrink-0 items-center justify-center ${command.category === 'git' ? 'text-emerald-600' : command.category === 'docker' ? 'text-cyan-600' : 'text-secondary'}`}><CategoryIcon category={command.category} /></span>
							<div className='min-w-0 flex-1'>
								<div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
									<p className='font-medium'>{command.summary}</p>
									<span className='text-brand font-mono text-[11px]'>{row.signature}</span>
									<span className={`ml-auto shrink-0 text-[10px] ${statusClass(process.status)}`}>{batchStatusLabel(process.status)}</span>
								</div>
								<div className='text-secondary mt-1.5 flex flex-wrap items-center gap-2 text-[10px]'>
									<span>{categoryLabels[command.category]}</span>
									<span>{executionLabel(process)}</span>
									<span>本 Session {formatNumber(countBySignature.get(row.signature))} 次</span>
									{command.confidence === 'partial' && <span className='text-amber-600'>部分识别</span>}
									{contexts.map(context => <span key={context}>{context}</span>)}
								</div>
							</div>
						</div>
						<pre className='text-secondary mt-3 max-h-10 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-5' title={command.raw}>{compactText(command.raw, 320)}</pre>
						{process.cwd && <p className='text-secondary mt-2 truncate font-mono text-[10px]' title={process.cwd}>{process.cwd}</p>}
					</button>
				}}
			/>
		</div>
	)
}
