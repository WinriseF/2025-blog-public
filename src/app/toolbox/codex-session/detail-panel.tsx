'use client'

import { useEffect, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { CodexPatchModal } from './codex-patch-viewer'
import { categoryLabels, commandContexts, commandIdentity, executionLabel, fileOperationLabels, formatDate, formatDurationMs, formatLineChanges, formatNumber, statusLabels, toolCategoryLabels } from './format'
import type { FileChange, FileRead, ParsedCommand, ProcessRun, TokenUsageSample, ToolActivity } from '@/lib/codex-session/types'

export type DetailSelection =
	| { type: 'command'; value: { process: ProcessRun; command: ParsedCommand } }
	| { type: 'file-change'; value: FileChange }
	| { type: 'file-read'; value: FileRead }
	| { type: 'tool-activity'; value: ToolActivity }
	| { type: 'token'; value: TokenUsageSample }

function InfoGrid({ values }: { values: Array<[string, string | undefined]> }) {
	return <dl className='grid border-y border-border sm:grid-cols-2 sm:gap-x-6'>{values.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label} className='min-w-0 border-b border-border py-3 last:border-b-0'><dt className='text-secondary text-[10px]'>{label}</dt><dd className='mt-1 whitespace-pre-wrap break-all font-mono text-xs'>{value}</dd></div>)}</dl>
}

function Section({ title, value }: { title: string; value: string }) {
	return <section className='mt-5'><h3 className='mb-2 text-xs font-semibold'>{title}</h3><pre className='max-h-80 overflow-auto whitespace-pre-wrap break-words border-y border-border bg-background/20 px-3 py-3 font-mono text-xs leading-5'>{value}</pre></section>
}

function FileChangeDetail({ file }: { file: FileChange }) {
	const [patchesOpen, setPatchesOpen] = useState(false)
	return <>
		<InfoGrid values={[
			['变更类型', file.operations.map(operation => fileOperationLabels[operation]).join('、')],
			['成功补丁', String(file.patches.length)],
			['累计补丁行数', formatLineChanges(file.additions, file.deletions)]
		]} />
		<section className='mt-5'>
			<h3 className='mb-2 text-xs font-semibold'>补丁记录</h3>
			<div className='border-t border-border'>
				{file.patches.map((patch, index) => {
					return <button key={patch.id} type='button' onClick={() => setPatchesOpen(true)} className='group flex w-full flex-wrap items-center gap-2 border-b border-border px-2 py-3 text-left text-xs transition-colors hover:bg-background/20'>
						<span className='font-semibold'>补丁 {index + 1}</span>
						<span className='text-brand'>{fileOperationLabels[patch.operation]}</span>
						{patch.additions > 0 && <span className='text-emerald-600'>+{formatNumber(patch.additions)}</span>}
						{patch.deletions > 0 && <span className='text-rose-500'>-{formatNumber(patch.deletions)}</span>}
						{patch.diffMode === 'fragment' && <span className='text-amber-600'>无行号片段</span>}
						<span className='text-secondary ml-auto'>{formatDate(patch.timestamp)}</span>
						<Maximize2 size={14} className='text-secondary transition-colors group-hover:text-primary' aria-hidden='true' />
					</button>
				})}
			</div>
		</section>
		{patchesOpen && <CodexPatchModal file={file} onClose={() => setPatchesOpen(false)} />}
	</>
}

function PanelBody({ selection }: { selection: DetailSelection }) {
	if (selection.type === 'command') {
		const { process, command } = selection.value
		const contexts = commandContexts(command)
		return <>
			<InfoGrid values={[
				['命令', commandIdentity(command)],
				['用途', command.summary],
				['类别', categoryLabels[command.category]],
				['执行方式', executionLabel(process)],
				['识别结果', command.confidence === 'confirmed' ? '已确认' : '部分识别'],
				['所在结构', contexts.join('、') || '直接执行'],
				['批次状态', statusLabels[process.status]],
				['批次退出码', process.exitCode?.toString()],
				['工作目录', process.cwd]
			]} />
			<Section title='实际运行命令' value={command.raw} />
			{process.command.trim() !== command.raw.trim() && <Section title='所在 Shell 批次' value={process.command} />}
			{process.output && <>
				<p className='text-secondary mt-5 text-xs'>输出和退出码属于整个 Shell 批次，不代表批次内每条子命令各自成功。</p>
				<Section title='批次输出' value={process.output} />
			</>}
		</>
	}

	if (selection.type === 'file-change') {
		const file = selection.value
		return <FileChangeDetail key={file.key} file={file} />
	}

	if (selection.type === 'file-read') {
		const file = selection.value
		return <>
			<InfoGrid values={[["文件", file.path], ['读取次数', formatNumber(file.count)]]} />
			<section className='mt-5'>
				<h3 className='mb-2 text-xs font-semibold'>读取记录</h3>
				<div className='border-t border-border'>
				{file.occurrences.map((item, index) => <div key={item.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 text-xs'>
					<span className='font-medium'>#{index + 1}</span>
					<span className={item.status === 'completed' ? 'text-emerald-600' : item.status === 'failed' || item.status === 'interrupted' ? 'text-rose-500' : 'text-amber-600'}>{statusLabels[item.status]}</span>
					<span className='text-secondary'>{formatDate(item.timestamp)}</span>
					{item.sourceRef && <span className='text-secondary ml-auto'>L{item.sourceRef.line}</span>}
				</div>)}
				</div>
			</section>
		</>
	}

	if (selection.type === 'tool-activity') {
		const tool = selection.value
		return <InfoGrid values={[
			['工具', tool.name],
			['类别', toolCategoryLabels[tool.category]],
			['状态', statusLabels[tool.status]],
			['调用来源', tool.origin === 'exec-nested' ? 'exec 内嵌逻辑调用' : tool.origin === 'event' ? '运行时事件' : '直接调用'],
			['开始时间', formatDate(tool.startedAt)],
			['结束时间', formatDate(tool.endedAt)],
			['耗时', formatDurationMs(tool.durationMs)],
			['耗时证据', tool.durationSource === 'recorded' ? '日志直接记录' : tool.durationSource === 'correlated' ? '调用与结果关联' : tool.durationSource === 'estimated' ? '时间戳估算' : '不可用'],
			['Turn ID', tool.turnId],
			['Call ID', tool.callId],
			['来源行', tool.sourceRefs.map(ref => `L${ref.line}`).join('、')]
		]} />
	}

	const sample = selection.value
	return <InfoGrid values={[
		['Fresh input', formatNumber(sample.freshInput)],
		['Cached input', formatNumber(sample.cachedInput)],
		['Input（含缓存）', formatNumber(sample.input)],
		['Cache write', formatNumber(sample.cacheWriteInput)],
		['Output', formatNumber(sample.output)],
		['Reasoning（Output 子集）', formatNumber(sample.reasoningOutput)],
		['Total', formatNumber(sample.total)],
		['Context window', formatNumber(sample.contextWindow)]
	]} />
}

type DetailPanelProps = {
	selection: DetailSelection
	onClose: () => void
}

export function DetailPanel({ selection, onClose }: DetailPanelProps) {
	const title = selection.type === 'command' ? selection.value.command.summary : selection.type === 'file-change' ? selection.value.path : selection.type === 'file-read' ? `读取 ${selection.value.path}` : selection.type === 'tool-activity' ? selection.value.name : 'Token 模型步骤样本'

	useEffect(() => {
		const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
		window.addEventListener('keydown', close)
		return () => window.removeEventListener('keydown', close)
	}, [onClose])

	return (
		<div className='fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] lg:contents' onMouseDown={event => event.target === event.currentTarget && onClose()}>
			<aside role='dialog' aria-label={title} className='bg-article absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-3xl border-t border-border shadow-2xl lg:sticky lg:right-auto lg:bottom-auto lg:left-auto lg:top-6 lg:mt-5 lg:h-auto lg:max-h-[calc(100dvh-9rem)] lg:min-h-0 lg:overflow-y-auto lg:rounded-xl lg:border lg:shadow-sm lg:z-20'>
				<div className='bg-article/95 sticky top-0 z-10 flex items-start gap-3 border-b border-border px-4 py-4 backdrop-blur lg:px-5'>
					<h2 className='min-w-0 flex-1 break-words text-lg font-semibold'>{title}</h2>
					<button type='button' onClick={onClose} className='text-secondary hover:text-primary flex size-9 shrink-0 items-center justify-center rounded-full border border-border transition' aria-label='关闭详情'><X size={17} /></button>
				</div>
				<div className='p-4 lg:p-5'><PanelBody selection={selection} /></div>
			</aside>
		</div>
	)
}
