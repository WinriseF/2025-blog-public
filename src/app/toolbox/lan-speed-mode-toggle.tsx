'use client'

import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, RotateCw, Zap } from 'lucide-react'
import type { LanNativeSpeedModeState } from '@/hooks/use-lan-native-speed-mode'
import type { LanNativeBenchmarkDirection } from '@/lib/lan-transfer/native-agent/types'

const BENCHMARK_SIZES = [
	{ label: '64MB 快速', bytes: 64 * 1024 * 1024 },
	{ label: '256MB', bytes: 256 * 1024 * 1024 },
	{ label: '1GB 精准', bytes: 1024 * 1024 * 1024 }
]

export function LanSpeedModeToggle({
	speedMode,
	onRunBenchmark
}: {
	speedMode: LanNativeSpeedModeState
	onRunBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number) => void
}) {
	const [benchmarkBytes, setBenchmarkBytes] = useState(BENCHMARK_SIZES[2].bytes)
	if (!speedMode.ready) return null

	const mobile = speedMode.device === 'mobile'
	const running = speedMode.benchmark.state === 'running'
	const progress = speedMode.benchmark.progress
	const transferredPercent = progress ? Math.min(100, (progress.bytes / progress.totalBytes) * 100) : 0
	const confirmingResult = running && transferredPercent >= 100
	const progressPercent = confirmingResult ? 99 : transferredPercent

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
							disabled={!speedMode.canHostAgent}
							onClick={() => speedMode.setEnabled(!speedMode.enabled)}
							className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${speedMode.enabled ? 'bg-brand' : 'bg-border'}`}>
							<span
								className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform ${speedMode.enabled ? 'translate-x-5' : 'translate-x-0'}`}
							/>
						</button>
					</div>
				)}
			</div>

			{speedMode.canBenchmark && (
				<div className='border-border mt-3 border-t pt-3'>
					<p className='text-secondary mb-2 text-[11px]'>
						默认使用 6 路本地网络 TCP 极速通道；浏览器不支持时回退 6 路 QUIC。64MiB 以上普通文件自动使用极速通道，图片、语音和小文件继续走 WebRTC。
					</p>
					<div className='flex items-center gap-2'>
						<select
							value={benchmarkBytes}
							onChange={event => setBenchmarkBytes(Number(event.target.value))}
							disabled={running}
							className='border-border bg-background/40 h-8 rounded-xl border px-2 text-xs outline-none disabled:opacity-50'>
							{BENCHMARK_SIZES.map(size => (
								<option key={size.bytes} value={size.bytes}>
									{size.label}
								</option>
							))}
						</select>
						<button
							type='button'
							onClick={() => onRunBenchmark('browser-to-agent', benchmarkBytes)}
							disabled={running}
							className='bg-brand/10 text-brand flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold disabled:opacity-50'>
							<ArrowUpFromLine size={13} /> 测上传
						</button>
						<button
							type='button'
							onClick={() => onRunBenchmark('agent-to-browser', benchmarkBytes)}
							disabled={running}
							className='bg-brand/10 text-brand flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold disabled:opacity-50'>
							<ArrowDownToLine size={13} /> 测下载
						</button>
					</div>
					{running && (
						<div className='mt-3'>
							<div className='bg-border h-1.5 overflow-hidden rounded-full'>
								<div className='bg-brand h-full transition-[width]' style={{ width: `${progressPercent}%` }} />
							</div>
							<p className='text-secondary mt-1.5 text-[11px]'>
								{confirmingResult ? (
									'数据传输完成，正在确认 Agent 测速结果…'
								) : (
									<>
										正在使用 {speedMode.benchmark.progress?.sessionCount ?? 6} 路{speedMode.benchmark.progress?.transport === 'webtransport' ? ' QUIC' : ' TCP'}{' '}
										测速 {progressPercent.toFixed(0)}%
									</>
								)}
							</p>
						</div>
					)}
					{speedMode.benchmark.state === 'complete' && speedMode.benchmark.result && (
						<p className='text-brand mt-2 text-xs font-semibold'>
							{speedMode.benchmark.result.sessionCount} 路{speedMode.benchmark.result.transport === 'webtransport' ? ' QUIC' : ' HTTP/TCP'} 有效载荷：
							{speedMode.benchmark.result.clientMbps.toFixed(0)} Mbps
							{speedMode.benchmark.result.transport === 'webtransport' && ` · Agent ${speedMode.benchmark.result.agentMbps.toFixed(0)} Mbps`}
						</p>
					)}
					{speedMode.benchmark.state === 'error' && <p className='mt-2 text-xs text-red-400'>{speedMode.benchmark.error}</p>}
				</div>
			)}
		</div>
	)
}
