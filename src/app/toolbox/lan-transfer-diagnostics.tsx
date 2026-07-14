'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronDown } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import type { LanTransferDiagnostics } from '@/lib/lan-transfer/diagnostics'

function speed(value: number) {
	return value > 0 ? `${formatBytes(value)}/s` : '0 B/s'
}

export function LanTransferDiagnosticsMenu({ diagnostics }: { diagnostics?: LanTransferDiagnostics }) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const close = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', close)
		return () => document.removeEventListener('pointerdown', close)
	}, [open])
	const currentSpeed = diagnostics ? Math.max(diagnostics.networkSendBps, diagnostics.networkReceiveBps) : 0
	const hasConnectionData = Boolean(diagnostics && diagnostics.connectionState !== 'idle' && diagnostics.connectionState !== 'discovered')
	return (
		<div ref={rootRef} className='relative'>
			<button onClick={() => setOpen(value => !value)} className='text-secondary flex size-9 items-center justify-center gap-1.5 rounded-full border border-border bg-background/40 px-0 transition hover:border-brand/45 hover:text-primary sm:h-9 sm:w-auto sm:px-2.5' aria-label='传输指标' aria-expanded={open}>
				<Activity size={16} />
				<span className='hidden text-xs font-medium tabular-nums sm:inline'>{currentSpeed ? speed(currentSpeed) : '指标'}</span>
				<ChevronDown size={13} className={open ? 'hidden rotate-180 transition-transform sm:block' : 'hidden transition-transform sm:block'} />
			</button>
			{open && (
				<div className='absolute top-11 right-0 z-30 w-[min(340px,calc(100vw-1.5rem))] rounded-2xl border border-border bg-article p-4 text-xs shadow-xl'>
					{!hasConnectionData ? <p className='py-5 text-center text-secondary'>暂无传输数据</p> : <DiagnosticsContent diagnostics={diagnostics!} />}
				</div>
			)}
		</div>
	)
}

function DiagnosticsContent({ diagnostics }: { diagnostics: LanTransferDiagnostics }) {
	const rows = [
		['线路', formatLanConnectionRoute(diagnostics.route)],
		['连接状态', diagnostics.connectionState],
		['分块档位', `${diagnostics.chunkSize / 1024}KB`],
		['网络发送', speed(diagnostics.networkSendBps)],
		['网络接收', speed(diagnostics.networkReceiveBps)],
		['磁盘提交', speed(diagnostics.diskCommitBps)],
		['通道缓冲', formatBytes(diagnostics.dataChannelBufferedBytes)],
		['接收排队', formatBytes(diagnostics.queuedBytes)],
		['接收窗口', formatBytes(diagnostics.receiveWindowBytes)],
		['发送水位', `${formatBytes(diagnostics.bufferHighWatermark)} / ${formatBytes(diagnostics.bufferLowWatermark)}`],
		['最大未提交', formatBytes(diagnostics.maxUncommittedBytes)],
		['重连次数', String(diagnostics.reconnectCount)],
	]
	return (
		<div className='space-y-3'>
			<div className='grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2'>
				{rows.map(([label, value]) => <div key={label} className='contents'><span className='text-secondary'>{label}</span><span className='truncate text-right font-medium tabular-nums' title={value}>{value}</span></div>)}
			</div>
			{diagnostics.pausedReason && <p className='rounded-xl bg-amber-500/10 px-3 py-2 text-amber-600'>{diagnostics.pausedReason}</p>}
			{diagnostics.latestReconnectReason && <p className='border-t border-border pt-3 text-secondary'>最近恢复：{diagnostics.latestReconnectReason}</p>}
			{diagnostics.recoveryHistory.length > 0 && <div className='space-y-1 border-t border-border pt-3 text-secondary'>{diagnostics.recoveryHistory.slice(-3).reverse().map(event => <p key={`${event.at}-${event.kind}`} className='truncate'>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })} · {event.reason}</p>)}</div>}
		</div>
	)
}
