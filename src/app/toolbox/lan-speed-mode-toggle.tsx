'use client'

import { ArrowRight, Download, Gauge, RotateCw, Zap } from 'lucide-react'
import type { LanNativeSpeedModeState } from '@/hooks/use-lan-native-speed-mode'
import { downloadLanDiagnostics } from '@/lib/lan-transfer/connection-diagnostics'

export function LanSpeedModeToggle({
	speedMode,
	onOpenBenchmark
}: {
	speedMode: LanNativeSpeedModeState
	onOpenBenchmark: () => void
}) {
	if (!speedMode.ready) return null

	const mobile = speedMode.device === 'mobile'
	const agentBusy = speedMode.agentState === 'launching' || speedMode.agentState === 'connecting'

	return (
		<div className='border-border bg-article rounded-3xl border p-4 shadow-sm'>
			<div className='flex items-center gap-3'>
				<div className='from-brand/20 text-brand flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br to-cyan-400/15'>
					<Zap size={19} />
				</div>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<p className='text-sm font-semibold'>极速模式</p>
						<span className='bg-brand/10 text-brand rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide'>BETA</span>
					</div>
					<p className='text-secondary mt-1 truncate text-xs'>{speedMode.status}</p>
				</div>
				{speedMode.remoteAdvertisement ? (
					<span className='bg-brand/10 text-brand shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold'>远端</span>
				) : mobile ? (
					<span className='bg-brand/10 text-brand shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold'>自动</span>
				) : (
					<div className='flex shrink-0 items-center gap-2'>
						{speedMode.enabled && speedMode.agentState === 'error' && (
							<button
								type='button'
								onClick={speedMode.reconnect}
								className='text-secondary hover:text-brand flex size-7 items-center justify-center rounded-full'
								aria-label='重新连接加速组件'>
								<RotateCw size={14} />
							</button>
						)}
						<button
							type='button'
							role='switch'
							aria-checked={speedMode.enabled}
							aria-label='极速模式'
							disabled={!speedMode.canHostAgent || agentBusy}
							onClick={() => speedMode.setEnabled(!speedMode.enabled)}
							className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${speedMode.enabled ? 'bg-brand' : 'bg-border'}`}>
							<span
								className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform ${speedMode.enabled ? 'translate-x-5' : 'translate-x-0'}`}
							/>
						</button>
					</div>
				)}
			</div>

			<div className='border-border mt-3 border-t pt-3'>
				<p className='text-secondary text-[11px]'>极速模式控制大文件的实际传输策略；连接测速独立运行，不会改变当前传输方式。</p>
				<button type='button' onClick={onOpenBenchmark} className='border-border bg-background/40 hover:border-brand/40 mt-3 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition'>
					<span className='bg-brand/10 text-brand flex size-9 shrink-0 items-center justify-center rounded-xl'><Gauge size={17} /></span>
					<span className='min-w-0 flex-1'>
						<span className='block text-xs font-semibold'>打开连接测速</span>
						<span className='text-secondary mt-0.5 block truncate text-[10px]'>比较 WebRTC、HTTP/TCP 与 QUIC</span>
					</span>
					<ArrowRight size={15} className='text-secondary shrink-0' />
				</button>
			</div>

			<div className='border-border mt-3 flex items-center justify-between gap-3 border-t pt-3'>
				<p className='text-secondary text-[10px]'>连接日志仅保存在当前浏览器，并自动脱敏。</p>
				<button
					type='button'
					onClick={downloadLanDiagnostics}
					className='text-secondary hover:text-brand flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background/40 px-2.5 py-1.5 text-[11px] font-medium transition hover:border-brand/40'
					aria-label='导出网页诊断日志'>
					<Download size={13} /> 导出日志
				</button>
			</div>
		</div>
	)
}
