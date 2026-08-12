'use client'

import { useState, type DragEvent } from 'react'
import { FileJson2, FilePlus2, FolderSearch2, LockKeyhole, RotateCcw, Trash2, X } from 'lucide-react'
import { isAuditCommand } from '@/lib/codex-session/command-semantics'
import type { SessionParseResult } from '@/lib/codex-session/types'
import { formatBytes, formatDate, formatNumber } from './format'

type SessionImportProps = {
	onFile: (file: File) => void
	progress?: { file: File; bytesRead: number; records: number }
	error?: string
	onCancel?: () => void
}

export function SessionImport({ onFile, progress, error, onCancel }: SessionImportProps) {
	const [dragging, setDragging] = useState(false)
	const percent = progress ? Math.min((progress.bytesRead / progress.file.size) * 100, 100) : 0

	const takeFile = (files: FileList | null) => {
		const file = files?.[0]
		if (file) onFile(file)
	}

	const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		setDragging(false)
		takeFile(event.dataTransfer.files)
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
							<p className='truncate font-medium'>{progress.file.name}</p>
							<p className='text-secondary mt-1 text-xs'>{formatBytes(progress.bytesRead)} / {formatBytes(progress.file.size)} · {progress.records.toLocaleString('zh-CN')} 条记录</p>
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
				<label
					onDragEnter={() => setDragging(true)}
					onDragLeave={() => setDragging(false)}
					onDragOver={event => event.preventDefault()}
					onDrop={handleDrop}
					className={`group flex cursor-pointer flex-col items-center rounded-3xl border border-dashed px-6 py-14 text-center transition ${dragging ? 'border-brand bg-brand/10' : 'border-brand/35 bg-brand/5 hover:border-brand/65 hover:bg-brand/10'}`}>
					<input type='file' className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => takeFile(event.target.files)} />
					<span className='border-brand/25 bg-article text-brand flex size-16 items-center justify-center rounded-2xl border shadow-sm'>
						<FileJson2 size={29} />
					</span>
					<span className='mt-5 text-base font-semibold'>选择或拖入 Codex Session 文件</span>
					<span className='text-secondary mt-2 text-sm'>本地解析</span>
				</label>
			)}

			<div className='text-secondary mt-5 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-xs leading-5'>
				<LockKeyhole size={16} className='mt-0.5 shrink-0 text-emerald-500' />
				<p>文件仅在当前浏览器页面内解析。</p>
			</div>
			<div className='text-secondary mt-3 flex items-start gap-3 rounded-xl border border-border bg-background/35 px-4 py-3 text-xs leading-5'>
				<FolderSearch2 size={16} className='mt-0.5 shrink-0 text-brand' />
				<div>
					<p>请选择 <code className='text-primary font-mono'>rollout-*.jsonl</code> 文件。默认位置：</p>
					<p className='mt-1 break-all font-mono text-[11px]'>Windows：C:\\Users\\你的用户名\\.codex\\sessions\\年\\月\\日\\rollout-*.jsonl</p>
					<p className='mt-1 break-all font-mono text-[11px]'>macOS / Linux：~/.codex/sessions/年/月/日/rollout-*.jsonl</p>
				</div>
			</div>
			{error && <div className='mt-4 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-500'>{error}</div>}
		</section>
	)
}

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
