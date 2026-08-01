'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, Gauge, Layers3, Network, Radio, ShieldCheck, Trash2, X } from 'lucide-react'
import { benchmarkTransportAvailability, type LanBenchmarkConnection, type LanBenchmarkEntry, type LanBenchmarkTransport, type LanConnectionBenchmarkController } from '@/hooks/use-lan-connection-benchmark'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import type { LanWebRtcBenchmarkDirection } from '@/lib/lan-transfer/types'
import { DeviceAvatar } from './lan-chat-ui'

const BENCHMARK_SIZES = [
	{ label: '64MiB', detail: '快速连通性', bytes: 64 * 1024 * 1024 },
	{ label: '256MiB', detail: '标准测试', bytes: 256 * 1024 * 1024 },
	{ label: '1GiB', detail: '精准测试', bytes: 1024 * 1024 * 1024 },
]

const TRANSPORTS: Array<{
	id: LanBenchmarkTransport | 'all'
	label: string
	detail: string
	security: string
	icon: ComponentType<{ size?: number; className?: string }>
}> = [
	{ id: 'auto', label: '自动选路', detail: '按实际文件策略选择', security: '视最终通道', icon: Gauge },
	{ id: 'webrtc', label: 'WebRTC', detail: '浏览器直连 DataChannel', security: 'DTLS 加密', icon: ShieldCheck },
	{ id: 'lna-http', label: 'HTTP/TCP', detail: '6 路本地网络连接', security: '明文合成数据', icon: Network },
	{ id: 'webtransport', label: 'QUIC', detail: '6 路 WebTransport', security: 'TLS 1.3', icon: Radio },
	{ id: 'all', label: '全部方式', detail: '逐项测试可用通道', security: '顺序执行', icon: Layers3 },
]

type TestDirection = LanWebRtcBenchmarkDirection | 'both'

export function LanSpeedTestPage({
	connections,
	activePeerId,
	webTransportSupported,
	benchmark,
	onBack,
}: {
	connections: LanBenchmarkConnection[]
	activePeerId: string | null
	webTransportSupported: boolean
	benchmark: LanConnectionBenchmarkController
	onBack: () => void
}) {
	const connected = useMemo(() => connections.filter(item => item.connected), [connections])
	const [peerId, setPeerId] = useState(activePeerId || connected[0]?.peerId || '')
	const [transport, setTransport] = useState<LanBenchmarkTransport | 'all'>('all')
	const [direction, setDirection] = useState<TestDirection>('both')
	const [totalBytes, setTotalBytes] = useState(BENCHMARK_SIZES[1].bytes)
	const selected = connected.find(item => item.peerId === peerId) || null
	const current = benchmark.entries.find(item => item.state === 'running') || null

	useEffect(() => {
		if (selected) return
		setPeerId(connected.find(item => item.peerId === activePeerId)?.peerId || connected[0]?.peerId || '')
	}, [activePeerId, connected, selected])

	const selectedAvailability = transport === 'all'
		? { available: Boolean(selected), status: '按顺序测试当前可用通道' }
		: benchmarkTransportAvailability(selected, transport, webTransportSupported)
	const hasRunnableDevice = connected.some(connection => transport === 'all' || benchmarkTransportAvailability(connection, transport, webTransportSupported).available)

	const run = (allDevices: boolean) => {
		if (!selected || benchmark.running) return
		const peerIds = allDevices ? connected.map(item => item.peerId) : [selected.peerId]
		const transports: LanBenchmarkTransport[] = transport === 'all' ? ['webrtc', 'lna-http', 'webtransport'] : [transport]
		const directions: LanWebRtcBenchmarkDirection[] = direction === 'both' ? ['upload', 'download'] : [direction]
		void benchmark.run({ peerIds, transports, directions, totalBytes })
	}

	const progress = current ? Math.min(100, (current.bytes / current.totalBytes) * 100) : 0

	return (
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-transparent'>
			<header className='border-border bg-article flex h-16 shrink-0 items-center justify-between border-b px-3 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)] sm:px-5'>
				<div className='flex min-w-0 items-center gap-3'>
					<button type='button' onClick={onBack} className='border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary flex size-10 shrink-0 items-center justify-center rounded-full border transition' aria-label='返回'><ArrowLeft size={21} /></button>
					<div className='min-w-0'>
						<h2 className='truncate text-base font-semibold'>连接测速</h2>
						<p className='text-secondary truncate text-xs'>仅测试局域网直连，不使用 TURN 或服务器中继</p>
					</div>
				</div>
				{benchmark.running ? (
					<button type='button' onClick={benchmark.cancel} className='border-border bg-background/40 text-secondary hover:border-red-400/50 hover:text-red-400 flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium'><X size={14} />取消</button>
				) : benchmark.entries.length ? (
					<button type='button' onClick={benchmark.clear} className='border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium'><Trash2 size={14} />清空</button>
				) : null}
			</header>

			<div className='min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>
				<div className='mx-auto max-w-5xl space-y-5 pb-[env(safe-area-inset-bottom)]'>
					<section>
						<div className='mb-2 flex items-center justify-between'><h3 className='text-sm font-semibold'>测试设备</h3><span className='text-secondary text-xs'>{connected.length} 台在线</span></div>
					{connected.length ? (
						<div className='flex gap-2 overflow-x-auto pb-1'>
							{connected.map(connection => (
								<button key={connection.peerId} type='button' onClick={() => setPeerId(connection.peerId)} disabled={benchmark.running} className={`flex min-w-[210px] items-center gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-60 ${peerId === connection.peerId ? 'border-brand/45 bg-brand/10' : 'border-border bg-article hover:border-brand/30'}`}>
									<DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active />
									<span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold'>{connection.peer.name}</span><span className='text-secondary mt-0.5 block truncate text-xs'>{formatLanConnectionRoute(connection.connectionRoute)}</span></span>
									{peerId === connection.peerId && <Check size={16} className='text-brand shrink-0' />}
								</button>
							))}
						</div>
					) : <EmptyState text='连接设备后即可测试 WebRTC；对方运行 Agent 后还能测试 TCP 与 QUIC。' />}
					</section>

					<section>
						<h3 className='mb-2 text-sm font-semibold'>传输方式</h3>
						<div className='grid grid-cols-2 gap-2 xl:grid-cols-5'>
							{TRANSPORTS.map(item => {
								const availability = item.id === 'all' ? { available: Boolean(selected), status: '仅测试可用方式' } : benchmarkTransportAvailability(selected, item.id, webTransportSupported)
								const Icon = item.icon
								return (
									<button key={item.id} type='button' onClick={() => setTransport(item.id)} disabled={benchmark.running || !availability.available} className={`min-w-0 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${transport === item.id ? 'border-brand/50 bg-brand/10' : 'border-border bg-article hover:border-brand/30'}`}>
										<span className='flex items-center gap-2'><Icon size={17} className={transport === item.id ? 'text-brand' : 'text-secondary'} /><span className='text-sm font-semibold'>{item.label}</span></span>
										<span className='text-secondary mt-2 block truncate text-[11px]'>{availability.available ? item.detail : availability.status}</span>
										<span className='text-secondary mt-1 block text-[10px]'>{item.security}</span>
									</button>
								)
							})}
						</div>
					</section>

					<section className='border-border bg-article rounded-3xl border p-4 shadow-sm'>
						<div className='grid gap-4 md:grid-cols-2'>
							<div><p className='text-secondary mb-2 text-xs font-medium'>单项测试大小</p><div className='grid grid-cols-3 gap-2'>{BENCHMARK_SIZES.map(size => <button key={size.bytes} type='button' onClick={() => setTotalBytes(size.bytes)} disabled={benchmark.running} className={`rounded-xl border px-2 py-2 text-center transition ${totalBytes === size.bytes ? 'border-brand/45 bg-brand/10 text-brand' : 'border-border bg-background/40 text-secondary'}`}><span className='block text-xs font-semibold'>{size.label}</span><span className='mt-0.5 block text-[9px]'>{size.detail}</span></button>)}</div></div>
							<div><p className='text-secondary mb-2 text-xs font-medium'>测试方向（以本机为准）</p><div className='grid grid-cols-3 gap-2'>{(['upload', 'download', 'both'] as const).map(value => <button key={value} type='button' onClick={() => setDirection(value)} disabled={benchmark.running} className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-3 text-xs font-semibold transition ${direction === value ? 'border-brand/45 bg-brand/10 text-brand' : 'border-border bg-background/40 text-secondary'}`}>{value === 'upload' ? <><ArrowUpFromLine size={13} />上传</> : value === 'download' ? <><ArrowDownToLine size={13} />下载</> : '双向'}</button>)}</div></div>
						</div>
						<p className='text-secondary mt-3 text-[10px]'>所选大小按每台设备、每个通道和每个方向分别计算。使用即时生成的零值合成数据，不读取或写入文件；测速期间该连接会拒绝新的文件任务。</p>
						<div className='mt-4 flex flex-col gap-2 sm:flex-row'>
							<button type='button' onClick={() => run(false)} disabled={benchmark.running || !selectedAvailability.available} className='bg-brand text-primary flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-45'><Gauge size={17} />开始测试</button>
							<button type='button' onClick={() => run(true)} disabled={benchmark.running || !hasRunnableDevice} className='border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45'><Layers3 size={17} />测试全部在线设备</button>
						</div>
					</section>

					{current && <CurrentProgress entry={current} progress={progress} />}
					<ResultList entries={benchmark.entries} />
				</div>
			</div>
		</section>
	)
}

function CurrentProgress({ entry, progress }: { entry: LanBenchmarkEntry; progress: number }) {
	return <section className='border-brand/30 bg-brand/5 rounded-3xl border p-4'><div className='flex items-center justify-between gap-3'><div className='min-w-0'><p className='truncate text-sm font-semibold'>{entry.peerName} · {transportLabel(entry.requestedTransport)} · {directionLabel(entry.direction)}</p><p className='text-secondary mt-1 text-xs'>{progress >= 100 ? '数据发送完成，正在确认结果…' : `${formatBytes(entry.bytes)} / ${formatBytes(entry.totalBytes)}`}</p></div><span className='text-brand text-sm font-bold'>{Math.min(99, progress).toFixed(0)}%</span></div><div className='bg-border mt-3 h-2 overflow-hidden rounded-full'><div className='bg-brand h-full transition-[width]' style={{ width: `${Math.min(99, progress)}%` }} /></div></section>
}

function ResultList({ entries }: { entries: LanBenchmarkEntry[] }) {
	if (!entries.length) return <EmptyState text='测速结果会按设备、通道和方向分别显示在这里。' />
	return <section><h3 className='mb-2 text-sm font-semibold'>测试结果</h3><div className='space-y-2'>{entries.map(entry => <div key={entry.key} className='border-border bg-article rounded-2xl border p-3'><div className='flex items-start justify-between gap-3'><div className='min-w-0'><p className='truncate text-sm font-semibold'>{entry.peerName}</p><p className='text-secondary mt-1 text-xs'>{entry.requestedTransport === 'auto' && entry.actualTransport ? `自动 → ${transportLabel(entry.actualTransport)}` : transportLabel(entry.actualTransport || entry.requestedTransport)} · {directionLabel(entry.direction)} · {resultRouteLabel(entry)}</p></div>{entry.state === 'complete' && entry.clientMbps != null ? <div className='shrink-0 text-right'><p className='text-brand text-lg font-bold'>{entry.clientMbps.toFixed(0)} <span className='text-xs'>Mbps</span></p><p className='text-secondary text-[10px]'>{(entry.clientMbps / 8).toFixed(1)} MB/s · {entry.sessionCount} 路</p></div> : <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${entry.state === 'error' ? 'bg-red-400/10 text-red-400' : entry.state === 'cancelled' ? 'bg-border text-secondary' : 'bg-brand/10 text-brand'}`}>{entry.state === 'running' ? '测试中' : entry.state === 'cancelled' ? '已取消' : '失败'}</span>}</div>{entry.error && <p className='mt-2 text-xs text-red-400'>{entry.error}</p>}{entry.state === 'complete' && entry.peerMbps != null && Math.abs(entry.peerMbps - (entry.clientMbps || 0)) > 1 && <p className='text-secondary mt-2 text-[10px]'>{secondaryTimingLabel(entry)}：{entry.peerMbps.toFixed(0)} Mbps</p>}</div>)}</div></section>
}

function EmptyState({ text }: { text: string }) {
	return <div className='border-border bg-article text-secondary rounded-3xl border border-dashed px-5 py-8 text-center text-xs'>{text}</div>
}

function transportLabel(transport: LanBenchmarkTransport | LanBenchmarkEntry['actualTransport']) {
	if (transport === 'auto') return '自动选路'
	if (transport === 'webrtc') return 'WebRTC'
	if (transport === 'lna-http') return 'HTTP/TCP'
	return 'QUIC'
}

function directionLabel(direction: LanWebRtcBenchmarkDirection) {
	return direction === 'upload' ? '上传' : '下载'
}

function secondaryTimingLabel(entry: LanBenchmarkEntry) {
	if (entry.actualTransport === 'webrtc') return entry.direction === 'upload' ? '对端接收计时' : '本机接收计时'
	return 'Agent 计时'
}

function resultRouteLabel(entry: LanBenchmarkEntry) {
	if (entry.actualTransport === 'lna-http') return 'Agent 局域网 TCP'
	if (entry.actualTransport === 'webtransport') return 'Agent QUIC/UDP'
	return formatLanConnectionRoute(entry.connectionRoute)
}

function formatBytes(bytes: number) {
	if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
	return `${(bytes / 1024 / 1024).toFixed(0)} MiB`
}
