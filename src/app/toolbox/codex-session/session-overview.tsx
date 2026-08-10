'use client'

import { FilePlus2, RotateCcw, Trash2 } from 'lucide-react'
import { isAuditCommand } from '@/lib/codex-session/command-semantics'
import type { SessionParseResult } from '@/lib/codex-session/types'
import { formatDate, formatNumber } from './format'

type SessionOverviewProps = {
	result: SessionParseResult
	onClear: () => void
	onFile: (file: File) => void
}

export function SessionOverview({ result, onClear, onFile }: SessionOverviewProps) {
	const tokenTotal = result.tokenUsage.status === 'available' ? formatNumber(result.tokenUsage.total?.total) : '不可用'
	const commands = result.processes.flatMap(process => (process.analysis?.commands ?? []).filter(isAuditCommand).map(command => ({ process, command })))
	const auditedProcesses = [...new Map(commands.map(item => [item.process.id, item.process])).values()]
	const successful = auditedProcesses.filter(process => process.status === 'completed').length
	const failed = auditedProcesses.filter(process => process.status === 'failed' || process.status === 'interrupted').length
	const stats = [
		['关键命令', formatNumber(commands.length)],
		['成功批次', formatNumber(successful)],
		['失败 / 中断批次', formatNumber(failed)],
		['读取文件', formatNumber(result.fileAudit.reads.length)],
		['修改文件', formatNumber(result.fileAudit.changes.length)],
		['Token', tokenTotal]
	]

	return (
		<header className='border-b border-border pb-6'>
		<div className='flex flex-wrap items-start justify-between gap-5'>
			<div className='min-w-0 max-w-3xl'>
				<p className='text-brand text-xs tracking-[0.2em] uppercase'>Codex Session</p>
				<div className='text-secondary mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
					<span>{formatDate(result.meta.startedAt)} 至 {formatDate(result.meta.endedAt)}</span>
					<span>{result.meta.model ?? '未知模型'}</span>
				</div>
				{result.meta.cwd && <p className='text-secondary mt-2 truncate font-mono text-xs' title={result.meta.cwd}>{result.meta.cwd}</p>}
			</div>
			<div className='flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 text-xs'>
				<span className='text-secondary min-w-0 max-w-[min(48vw,36rem)] truncate' title={result.source.name}>{result.source.name}</span>
				<label className='hover:border-brand/45 flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-2 transition'>
					<input type='file' className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => event.target.files?.[0] && onFile(event.target.files[0])} />
					<FilePlus2 size={14} /> 重新导入
				</label>
				<button type='button' onClick={onClear} className='hover:border-rose-400/50 hover:text-rose-500 flex items-center gap-1.5 rounded-full border border-border px-3 py-2 transition'>
					<Trash2 size={14} /> 清空
				</button>
			</div>
		</div>

		<div className='mt-5 grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-6'>
			{stats.map(([label, value], index) => (
				<div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}>
					<p className='text-secondary text-[11px]'>{label}</p>
					<p className='mt-1 truncate text-base font-semibold'>{value}</p>
				</div>
			))}
		</div>

		{result.tokenUsage.scope === 'possibly-inherited' && (
			<div className='mt-4 flex items-center gap-2 border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2 text-xs text-amber-600'>
				<RotateCcw size={14} /> 此 Session 来自 fork / subagent，累计 Token 可能包含继承前缀。
			</div>
		)}
	</header>
	)
}
