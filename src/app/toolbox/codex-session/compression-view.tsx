'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Download, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import type { SessionCompressionAction, SessionCompressionRecord, SessionCompressionTurn } from '@/lib/codex-session/types'
import { formatBytes, formatDate, formatNumber } from './format'
import { COMPRESSION_KIND, SessionCompressionGraph } from './session-compression-graph'
import { useSessionCompression } from './use-session-compression'

function records(turns: SessionCompressionTurn[]) {
	return turns.flatMap(turn => turn.records)
}

export function CompressionView({ file }: { file: File }) {
	const { state, scan: rescan, compress, cancel } = useSessionCompression(file)
	const scan = state.status === 'ready' || state.status === 'compressing' || state.status === 'complete' || state.status === 'error' ? state.scan : undefined
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [query, setQuery] = useState('')
	const allRecords = useMemo(() => records(scan?.turns ?? []), [scan])
	const allActions = useMemo(() => allRecords.flatMap(record => record.actions), [allRecords])

	useEffect(() => {
		if (!scan) return
		setSelected(new Set(records(scan.turns).flatMap(record => record.actions.filter(action => action.defaultSelected).map(action => action.id))))
	}, [scan])

	const selectedActions = allActions.filter(action => selected.has(action.id))
	const selectedRecordIds = new Set(allRecords.filter(record => record.actions.some(action => selected.has(action.id))).map(record => record.id))
	const candidateBytes = selectedActions.reduce((total, action) => total + action.candidateBytes, 0)
	const normalizedQuery = query.trim().toLocaleLowerCase()
	const visibleTurns = useMemo(() => {
		if (!scan || !normalizedQuery) return scan?.turns ?? []
		return scan.turns.flatMap(turn => {
			const matching = turn.records.filter(record => [record.label, record.detail, record.recordType, record.payloadType, String(record.line)].some(value => value?.toLocaleLowerCase().includes(normalizedQuery)))
			return matching.length ? [{ ...turn, records: matching, recordCount: matching.length }] : []
		})
	}, [normalizedQuery, scan])

	const toggleAction = (record: SessionCompressionRecord, action: SessionCompressionAction) => setSelected(current => {
		const next = new Set(current)
		if (next.has(action.id)) next.delete(action.id)
		else {
			for (const sibling of record.actions) if (action.dropsRecord || sibling.dropsRecord) next.delete(sibling.id)
			next.add(action.id)
		}
		return next
	})
	const toggleExpanded = (id: string) => setExpanded(current => {
		const next = new Set(current)
		next.has(id) ? next.delete(id) : next.add(id)
		return next
	})
	const restoreDefaults = () => setSelected(new Set(allActions.filter(action => action.defaultSelected).map(action => action.id)))

	if (state.status === 'scanning') return <div className='flex min-h-64 flex-col items-center justify-center border-y border-border px-5 text-center'>
		<LoaderCircle size={22} className='text-brand animate-spin' />
		<p className='mt-3 text-sm font-medium'>正在解析完整 Session</p>
		<p className='text-secondary mt-1 text-xs'>{formatBytes(state.bytesRead)} / {formatBytes(file.size)} · {formatNumber(state.records)} 条记录</p>
		<div className='mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-border/60'><span className='bg-brand block h-full transition-[width]' style={{ width: `${file.size ? Math.min(state.bytesRead / file.size, 1) * 100 : 0}%` }} /></div>
	</div>

	if (state.status === 'error' && !scan) return <div className='flex min-h-56 flex-col items-center justify-center border-y border-border px-5 text-center'>
		<AlertTriangle size={20} className='text-rose-500' />
		<p className='mt-3 text-sm'>{state.message}</p>
		<button type='button' onClick={rescan} className='hover:border-brand/50 hover:text-brand mt-4 rounded-full border border-border px-4 py-2 text-xs transition'><RotateCcw size={13} className='mr-1.5 inline' />重新扫描</button>
	</div>

	if (!scan) return null
	const report = state.status === 'complete' ? state.report : undefined
	const savedBytes = report ? Math.max(report.sourceBytes - report.outputBytes, 0) : 0
	const savedRate = report?.sourceBytes ? savedBytes / report.sourceBytes : 0

	return <div className='space-y-5'>
		<div className='grid grid-cols-2 border-y border-border sm:grid-cols-4'>
			<div className='px-3 py-3'><p className='text-secondary text-[10px]'>原始大小</p><p className='mt-1 font-semibold'>{formatBytes(scan.sourceBytes)}</p></div>
			<div className='border-l border-border px-3 py-3'><p className='text-secondary text-[10px]'>Session 记录</p><p className='mt-1 font-semibold'>{formatNumber(scan.recordCount)}</p></div>
			<div className='border-l border-border px-3 py-3'><p className='text-secondary text-[10px]'>已选记录 / 动作</p><p className='mt-1 font-semibold'>{formatNumber(selectedRecordIds.size)} / {formatNumber(selectedActions.length)}</p></div>
			<div className='border-l border-border px-3 py-3'><p className='text-secondary text-[10px]'>预计减少</p><p className='mt-1 font-semibold'>{formatBytes(candidateBytes)}</p></div>
		</div>

		<SessionCompressionGraph turns={scan.turns} selected={selectedRecordIds} />

		<div className='flex items-start gap-2 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-700'>
			<AlertTriangle size={15} className='mt-0.5 shrink-0' />
			<span>下方每行对应一条真实记录，可分别选择删除、清理字段或截断输出；删除整条记录与该记录的其他动作互斥。AI 思考和确认安全的低信息动作默认选中。输出用于审计归档，不保证可以 Codex Resume。{scan.invalidRecords > 0 && ` ${formatNumber(scan.invalidRecords)} 条无法解析的原始行会原样保留。`}</span>
		</div>

		<section className={`border-y border-border transition-opacity ${state.status === 'compressing' ? 'pointer-events-none opacity-60' : ''}`}>
			<header className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3'>
				<div><h2 className='text-sm font-semibold'>Session 详细</h2><p className='text-secondary mt-1 text-[10px]'>按原始时间顺序逐条展示全部对话、工具和运行记录</p></div>
				<div className='flex flex-wrap items-center gap-3'>
					<label className='flex items-center gap-2 rounded-full border border-border px-3 py-1.5'><Search size={12} className='text-secondary' /><input value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索内容或类型' className='w-32 bg-transparent text-[11px] outline-none placeholder:text-secondary' /></label>
					<div className='flex gap-2 text-[11px]'><button type='button' onClick={restoreDefaults} className='hover:text-brand transition'>恢复默认</button><span className='text-border'>|</span><button type='button' onClick={() => setSelected(new Set())} className='hover:text-brand transition'>全部保留</button></div>
				</div>
			</header>

			<div className='max-h-[52rem] overflow-auto'>
				{visibleTurns.map(turn => <div key={turn.id}>
					<div className='sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-3 py-2 text-[10px] backdrop-blur'>
						<div><span className='font-semibold'>{turn.label}</span><span className='text-secondary ml-2'>{turn.detail}</span></div><span className='text-secondary'>{formatNumber(turn.records.length)} 条 · {formatDate(turn.timestamp)}</span>
					</div>
					{turn.records.map(record => {
						const meta = COMPRESSION_KIND[record.kind]
						const selectedForRecord = record.actions.filter(action => selected.has(action.id))
						const selectedRecord = selectedForRecord.length > 0
						const open = expanded.has(record.id)
						const long = (record.detail?.length ?? 0) > 220
						return <article id={`compression-${record.id}`} key={record.id} className={`grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-border px-3 py-3 last:border-b-0 transition ${selectedRecord ? 'bg-rose-500/[0.04]' : ''}`}>
							<div className='pt-0.5'><span className='inline-block min-w-16 rounded-sm px-1.5 py-0.5 text-center text-[8px] font-semibold text-white' style={{ backgroundColor: meta.color }}>{meta.label}</span></div>
							<div className='min-w-0'>
								<div className='flex flex-wrap items-center gap-x-2 gap-y-1'><span className='text-[11px] font-medium'>{record.label}</span><span className='text-secondary text-[9px]'>{record.recordType}{record.payloadType ? ` / ${record.payloadType}` : ''}</span>{record.actions.some(action => action.defaultSelected) && <span className='text-[8px] text-rose-500'>含默认裁剪</span>}</div>
								<p className={`text-secondary mt-1 whitespace-pre-wrap break-words text-[10px] leading-5 ${!open && long ? 'line-clamp-2' : ''}`}>{record.detail}</p>
								{long && <button type='button' onClick={() => toggleExpanded(record.id)} className='text-brand mt-1 text-[9px]'>{open ? '收起内容' : '展开内容'}</button>}
								<p className='text-secondary mt-1 text-[9px]'>行 {record.line ?? '—'} · {formatDate(record.timestamp)} · {formatBytes(record.byteSize)}{selectedForRecord.length > 0 && ` · ${selectedForRecord.map(action => action.description).join('；')}`}</p>
							</div>
							<div className='flex max-w-56 flex-wrap justify-end gap-1.5'>
								{record.actions.length ? record.actions.map(action => {
									const checked = selected.has(action.id)
									return <button key={action.id} type='button' title={`${action.description} · 预计 ${formatBytes(action.candidateBytes)}`} onClick={() => toggleAction(record, action)} className={`rounded-full border px-2.5 py-1 text-[9px] font-medium transition ${checked ? 'border-rose-500 bg-rose-500 text-white' : 'border-border hover:border-rose-400/60 hover:text-rose-500'}`}>{action.label}</button>
								}) : <span className='text-secondary px-2 py-1 text-[9px]'>不可裁剪</span>}
							</div>
						</article>
					})}
				</div>)}
				{!visibleTurns.length && <p className='text-secondary px-4 py-10 text-center text-xs'>没有匹配的 Session 记录</p>}
			</div>
		</section>

		{state.status === 'error' && <div className='border-l-2 border-rose-400 bg-rose-400/5 px-4 py-3 text-xs text-rose-500'>{state.message}</div>}
		{state.status === 'compressing' && <div className='border-y border-border px-4 py-4'><div className='flex justify-between text-xs'><span>正在生成压缩文件</span><span className='text-secondary'>{formatBytes(state.bytesRead)} / {formatBytes(file.size)}</span></div><div className='mt-3 h-1.5 overflow-hidden rounded-full bg-border/60'><span className='bg-brand block h-full transition-[width]' style={{ width: `${file.size ? Math.min(state.bytesRead / file.size, 1) * 100 : 0}%` }} /></div></div>}
		{report && <div className='border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-xs leading-5 text-emerald-700'><p className='font-medium'><Check size={14} className='mr-1.5 inline' />压缩文件已下载</p><p className='mt-1'>从 {formatBytes(report.sourceBytes)} 减少到 {formatBytes(report.outputBytes)}，节省 {formatBytes(savedBytes)}（{(savedRate * 100).toFixed(1)}%）；删除 {formatNumber(report.droppedRecords)} 条、改写 {formatNumber(report.rewrittenRecords)} 条记录。</p></div>}

		<div className='sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur'>
			<div><p className='text-xs font-medium'>已选择 {formatNumber(selectedRecordIds.size)} 条记录 / {formatNumber(selectedActions.length)} 个动作</p><p className='text-secondary mt-1 text-[10px]'>预计减少 {formatBytes(candidateBytes)}，最终体积以生成结果为准</p></div>
			{state.status === 'compressing' ? <button type='button' onClick={cancel} className='rounded-full border border-border px-5 py-2.5 text-xs transition hover:border-rose-400/50 hover:text-rose-500'>取消</button> : <button type='button' disabled={!selectedActions.length} onClick={() => compress(selectedActions.map(action => action.selection))} className='bg-brand flex min-w-40 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold !text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-border disabled:!text-secondary disabled:shadow-none'><Download size={14} />生成并下载</button>}
		</div>
	</div>
}
