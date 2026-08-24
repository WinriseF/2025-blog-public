'use client'

import { useState, type DragEvent } from 'react'
import { ArrowLeft, FileJson2, FilePlus2, FolderOpen, FolderSearch2, RotateCcw, Trash2, X } from 'lucide-react'
import { isAuditCommand } from '@/lib/codex-session/command-semantics'
import type { SessionParseResult } from '@/lib/codex-session/types'
import { formatBytes, formatCompactNumber, formatDate, formatNumber, formatPercent } from './format'
import { MetricLabel } from './metric-help'

type SessionImportProps = {
	onFiles: (files: File[]) => void
	progress?: {
		currentName: string
		bytesRead: number
		totalBytes: number
		records: number
		completedFiles?: number
		totalFiles?: number
	}
	error?: string
	onCancel?: () => void
}

export function SessionImport({ onFiles, progress, error, onCancel }: SessionImportProps) {
	const [dragging, setDragging] = useState(false)
	const percent = progress?.totalBytes ? Math.min((progress.bytesRead / progress.totalBytes) * 100, 100) : 0

	const takeFiles = (files: FileList | null) => {
		const selected = Array.from(files ?? [])
		if (selected.length) onFiles(selected)
	}

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		setDragging(false)
		takeFiles(event.dataTransfer.files)
	}

	return (
		<section className='mx-auto flex min-h-[520px] max-w-3xl flex-col justify-center px-4 py-10 max-sm:min-h-[calc(100dvh-8rem)]'>
			<div className='mb-7 text-center'>
				<h1 className='text-3xl font-semibold tracking-tight max-sm:text-2xl'>Codex Session 审计</h1>
				<p className='text-secondary mx-auto mt-3 max-w-xl leading-6'>统计本次 Session 真正运行的关键命令、明确读取和修改的文件，以及记录的 Token 用量。</p>
			</div>

			{progress ? (
				<div className='rounded-2xl border border-border bg-background/35 p-6 shadow-sm'>
					<div className='flex items-start justify-between gap-4'>
						<div className='min-w-0'>
							<p className='truncate font-medium'>{progress.currentName}</p>
							<p className='text-secondary mt-1 text-xs'>
								{progress.totalFiles ? `${progress.completedFiles ?? 0} / ${progress.totalFiles} 个文件 · ` : ''}
								{formatBytes(progress.bytesRead)} / {formatBytes(progress.totalBytes)} · {progress.records.toLocaleString('zh-CN')} 条记录
							</p>
						</div>
						<button type='button' onClick={onCancel} className='text-secondary hover:text-primary flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs transition'>
							<X size={14} /> 取消
						</button>
					</div>
					<div className='mt-5 h-2 overflow-hidden rounded-full bg-border/50'>
						<div className='bg-brand h-full rounded-full transition-[width] duration-150' style={{ width: `${percent}%` }} />
					</div>
					<p className='text-secondary mt-3 text-xs'>正在 Worker 中流式解析，页面仍可交互。</p>
				</div>
			) : (
				<div
					onDragEnter={() => setDragging(true)}
					onDragLeave={() => setDragging(false)}
					onDragOver={event => event.preventDefault()}
					onDrop={handleDrop}
					className={`group flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center transition ${dragging ? 'border-brand bg-brand/10' : 'border-brand/35 bg-brand/5 hover:border-brand/65 hover:bg-brand/10'}`}>
					<span className='border-brand/25 bg-article text-brand flex size-16 items-center justify-center rounded-2xl border shadow-sm'>
						<FileJson2 size={29} />
					</span>
					<span className='mt-5 text-base font-semibold'>选择或拖入 Codex Session 文件</span>
					<div className='mt-5 flex flex-wrap justify-center gap-2'>
						<label className='bg-brand flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white'>
							<input type='file' accept='.jsonl,application/x-ndjson' multiple className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => takeFiles(event.target.files)} />
							<FilePlus2 size={14} /> 选择文件
						</label>
						<label className='hover:border-brand/50 flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background/35 px-4 py-2 text-xs font-medium transition'>
							<input type='file' multiple className='hidden' {...{ webkitdirectory: '' }} onClick={event => (event.currentTarget.value = '')} onChange={event => takeFiles(event.target.files)} />
							<FolderOpen size={14} /> 选择目录
						</label>
					</div>
				</div>
			)}

			<div className='text-secondary mt-3 flex items-start gap-3 rounded-xl border border-border bg-background/35 px-4 py-3 text-xs leading-5'>
				<FolderSearch2 size={16} className='mt-0.5 shrink-0 text-brand' />
				<div>
					<p>请选择 <code className='text-primary font-mono'>rollout-*.jsonl</code> 文件。默认位置：</p>
					<p className='mt-1 break-all font-mono text-[11px]'>Windows：C:\\Users\\你的用户名\\.codex\\sessions\\年\\月\\日\\rollout-*.jsonl</p>
					<p className='mt-1 break-all font-mono text-[11px]'>macOS / Linux：~/.codex/sessions/年/月/日/rollout-*.jsonl</p>
				</div>
			</div>
			{error && <div className='mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-500'><span>{error}</span>{onCancel && <button type='button' onClick={onCancel} className='shrink-0 rounded-full border border-rose-400/30 px-3 py-1.5 text-xs'>返回</button>}</div>}
		</section>
	)
}

type SessionOverviewProps = {
	result: SessionParseResult
	onClear: () => void
	onFile: (file: File) => void
	backToTimeline?: boolean
}

export function SessionOverview({ result, onClear, onFile, backToTimeline }: SessionOverviewProps) {
	const tokenTotal = result.tokenUsage.status === 'available' ? formatCompactNumber(result.tokenUsage.total?.total) : '不可用'
	const commands = result.processes.flatMap(process => (process.analysis?.commands ?? []).filter(isAuditCommand).map(command => ({ process, command })))
	const auditedProcesses = [...new Map(commands.map(item => [item.process.id, item.process])).values()]
	const successful = auditedProcesses.filter(process => process.status === 'completed').length
	const failed = auditedProcesses.filter(process => process.status === 'failed' || process.status === 'interrupted').length
	const stats: Array<{ label: string; value: string; help?: string }> = [
		{ label: '关键命令', value: formatNumber(commands.length) },
		{ label: '成功批次', value: formatNumber(successful) },
		{ label: '失败 / 中断批次', value: formatNumber(failed) },
		{ label: '读取文件', value: formatNumber(result.fileAudit.reads.length) },
		{ label: '修改文件', value: formatNumber(result.fileAudit.changes.length) },
		{ label: 'Token', value: tokenTotal, help: 'Session 记录的 Input 与 Output Token 总量；缓存 Input 已包含在 Input 中。' },
		{ label: '推理 Token / Output', value: formatPercent(result.activity.metrics.reasoningShareOfOutput), help: 'Reasoning Output Token 占全部 Output Token 的比例；工具调用参数属于非推理 Output。' },
		{ label: '工具耗时 / 回合耗时', value: formatPercent(result.activity.metrics.toolTimeShare), help: '可确认的工具执行时间区间并集，占 Session 累计回合耗时的比例。' }
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
						<input type='file' accept='.jsonl,application/x-ndjson' className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => event.target.files?.[0] && onFile(event.target.files[0])} />
						<FilePlus2 size={14} /> 重新导入
					</label>
					<button type='button' onClick={onClear} className={`flex items-center gap-1.5 rounded-full border border-border px-3 py-2 transition ${backToTimeline ? 'hover:border-brand/50 hover:text-brand' : 'hover:border-rose-400/50 hover:text-rose-500'}`}>
						{backToTimeline ? <ArrowLeft size={14} /> : <Trash2 size={14} />} {backToTimeline ? '返回时间线' : '清空'}
					</button>
				</div>
			</div>

			<div className='mt-5 grid grid-cols-2 border-y border-border sm:grid-cols-4 lg:grid-cols-8'>
				{stats.map((item, index) => (
					<div key={item.label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}>
						<p className='text-secondary text-[11px]'><MetricLabel label={item.label} help={item.help} /></p>
						<p className='mt-1 truncate text-base font-semibold' title={item.label === 'Token' ? formatNumber(result.tokenUsage.total?.total) : undefined}>{item.value}</p>
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
