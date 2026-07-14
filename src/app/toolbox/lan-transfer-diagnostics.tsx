'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Activity, ArrowDown, ArrowUp, ChevronDown, HardDrive } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import type { LanTransferDiagnostics } from '@/lib/lan-transfer/diagnostics'

function speed(value: number) {
	return value > 0 ? `${formatBytes(value)}/s` : '0 B/s'
}

function HeaderMetric({ icon, value }: { icon: ReactNode; value: number }) {
	return <span className='inline-flex items-center gap-1 whitespace-nowrap tabular-nums'>{icon}{speed(value)}</span>
}

export function LanTransferDiagnosticsMenu({ diagnostics }: { diagnostics?: LanTransferDiagnostics }) {
	const [open, setOpen] = useState(false)
	const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) {
			setPosition(null)
			return
		}
		const updatePosition = () => {
			const rect = rootRef.current?.getBoundingClientRect()
			if (rect) setPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) })
		}
		const close = (event: PointerEvent) => {
			const target = event.target as Node
			if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
		updatePosition()
		document.addEventListener('pointerdown', close)
		document.addEventListener('keydown', closeOnEscape)
		window.addEventListener('resize', updatePosition)
		window.addEventListener('scroll', updatePosition, true)
		return () => {
			document.removeEventListener('pointerdown', close)
			document.removeEventListener('keydown', closeOnEscape)
			window.removeEventListener('resize', updatePosition)
			window.removeEventListener('scroll', updatePosition, true)
		}
	}, [open])
	const hasConnectionData = Boolean(diagnostics && diagnostics.connectionState !== 'idle' && diagnostics.connectionState !== 'discovered')
	const panel = open && position && typeof document !== 'undefined' ? createPortal(
		<div ref={panelRef} style={{ top: position.top, right: position.right }} className='fixed z-[1200] max-h-[min(70vh,620px)] w-[min(380px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border bg-article p-4 text-xs text-primary shadow-2xl backdrop-blur-xl'>
			{!hasConnectionData ? <p className='py-5 text-center text-secondary'>暂无传输数据</p> : <DiagnosticsContent diagnostics={diagnostics!} />}
		</div>,
		document.body,
	) : null
	return (
		<div ref={rootRef} className='relative'>
			<button onClick={() => setOpen(value => !value)} title='点击查看详细传输指标' className='text-secondary flex size-9 items-center justify-center gap-2 rounded-full border border-border bg-background/40 px-0 transition hover:border-brand/45 hover:text-primary sm:h-9 sm:w-auto sm:px-2.5' aria-label='传输指标' aria-expanded={open}>
				<Activity size={16} />
				{hasConnectionData ? <span className='hidden items-center gap-2 text-[11px] font-medium sm:inline-flex'><HeaderMetric icon={<ArrowUp size={12} />} value={diagnostics!.networkSendBps} /><span className='text-border'>|</span><HeaderMetric icon={<ArrowDown size={12} />} value={diagnostics!.networkReceiveBps} /><span className='hidden items-center gap-2 xl:inline-flex'><span className='text-border'>|</span><HeaderMetric icon={<HardDrive size={12} />} value={diagnostics!.diskCommitBps} /><span className='rounded-md bg-brand/10 px-1.5 py-0.5 text-brand'>{diagnostics!.chunkSize / 1024}K</span></span></span> : <span className='hidden text-xs font-medium sm:inline'>指标</span>}
				<ChevronDown size={13} className={`hidden transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
			</button>
			{panel}
		</div>
	)
}

function DiagnosticsContent({ diagnostics }: { diagnostics: LanTransferDiagnostics }) {
	const recoveryHistory = diagnostics.recoveryHistory || []
	const rows = [
		['线路', formatLanConnectionRoute(diagnostics.route)],
		['连接状态', diagnostics.connectionState],
		['分块档位', `${diagnostics.chunkSize / 1024}KB`],
		['通道缓冲', formatBytes(diagnostics.dataChannelBufferedBytes)],
		['接收排队', formatBytes(diagnostics.queuedBytes)],
		['接收窗口', formatBytes(diagnostics.receiveWindowBytes)],
		['发送水位', `${formatBytes(diagnostics.bufferHighWatermark)} / ${formatBytes(diagnostics.bufferLowWatermark)}`],
		['最大未提交', formatBytes(diagnostics.maxUncommittedBytes)],
		['重连次数', String(diagnostics.reconnectCount)],
	]
	const rates = [
		['网络发送', speed(diagnostics.networkSendBps), <ArrowUp key='send' size={13} />],
		['网络接收', speed(diagnostics.networkReceiveBps), <ArrowDown key='receive' size={13} />],
		['磁盘提交', speed(diagnostics.diskCommitBps), <HardDrive key='disk' size={13} />],
	] as const
	return (
		<div className='space-y-4'>
			<div className='flex items-center justify-between gap-3'><div><p className='font-semibold text-primary'>实时传输指标</p><p className='mt-1 text-[11px] text-secondary'>{formatLanConnectionRoute(diagnostics.route)} · {diagnostics.chunkSize / 1024}KB 分块</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${diagnostics.active ? 'bg-brand/10 text-brand' : 'bg-background/60 text-secondary'}`}>{diagnostics.active ? '传输中' : '空闲'}</span></div>
			<div className='grid grid-cols-3 gap-2'>{rates.map(([label, value, icon]) => <div key={label} className='min-w-0 rounded-xl border border-border bg-background/35 px-2.5 py-2.5'><p className='flex items-center gap-1 text-[10px] text-secondary'>{icon}{label}</p><p title={value} className='mt-1 truncate text-xs font-semibold tabular-nums'>{value}</p></div>)}</div>
			<div className='grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2'>
				{rows.map(([label, value]) => <div key={label} className='contents'><span className='text-secondary'>{label}</span><span className='truncate text-right font-medium tabular-nums' title={value}>{value}</span></div>)}
			</div>
			{diagnostics.pausedReason && <p className='rounded-xl bg-amber-500/10 px-3 py-2 text-amber-600'>{diagnostics.pausedReason}</p>}
			{diagnostics.latestReconnectReason && <p className='border-t border-border pt-3 text-secondary'>最近恢复：{diagnostics.latestReconnectReason}</p>}
			{recoveryHistory.length > 0 && <div className='space-y-1 border-t border-border pt-3 text-secondary'>{recoveryHistory.slice(-3).reverse().map(event => <p key={`${event.at}-${event.kind}`} className='truncate'>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })} · {event.reason}</p>)}</div>}
		</div>
	)
}
