'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BarChart3, Copy, Download, Eraser, HardDrive, Network, Play, QrCode, RotateCcw, ShieldAlert, Wifi } from 'lucide-react'
import * as QRCode from 'qrcode'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import { LAN_LIMITS } from '@/lib/lan-transfer/types'
import { BenchmarkPeer } from '@/lib/lan-benchmark/peer'
import { BenchmarkRunner } from '@/lib/lan-benchmark/runner'
import { createBenchmarkSession, BenchmarkSignalingClient } from '@/lib/lan-benchmark/signaling'
import { cleanupBenchmarkStorage } from '@/lib/lan-benchmark/storage'
import { runLocalStorageBenchmark } from '@/lib/lan-benchmark/storage-benchmark'
import { bytesToMib, randomBenchmarkId, type BenchmarkCapabilities, type BenchmarkPeerStorage, type BenchmarkResult, type BenchmarkRunConfig, type BenchmarkSample, type BenchmarkSession, type BenchmarkStorageKind } from '@/lib/lan-benchmark/types'

const inviteStorageKey = 'winrisef-lan-benchmark-invite-v1'
const MiB = 1024 * 1024
const localStorages: Array<{ value: BenchmarkStorageKind; label: string }> = [
	{ value: 'memory', label: 'Memory' },
	{ value: 'opfs', label: 'OPFS' },
	{ value: 'indexeddb', label: 'IndexedDB' },
	{ value: 'file', label: 'Direct File' },
]
const peerStorages: Array<{ value: BenchmarkPeerStorage; label: string }> = [
	{ value: 'sink', label: 'WebRTC Sink（不写盘）' },
	{ value: 'memory', label: 'Memory' },
	{ value: 'opfs', label: 'OPFS' },
	{ value: 'indexeddb', label: 'IndexedDB' },
	{ value: 'file', label: 'Direct File' },
]

type Progress = { id: string; bytes: number; totalBytes: number; samples: BenchmarkSample[] } | null

function cn(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(' ')
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`
	if (bytes < MiB * 1024) return `${(bytes / MiB).toFixed(1)} MiB`
	return `${(bytes / MiB / 1024).toFixed(2)} GiB`
}

function formatSpeed(value?: number) {
	return value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(value >= 10 ? 1 : 2)} MiB/s`
}

function formatDuration(value?: number) {
	return value === undefined ? '—' : value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`
}

function storageAvailability(kind: BenchmarkStorageKind, capabilities: BenchmarkCapabilities | null) {
	if (!capabilities) return true
	if (kind === 'opfs') return capabilities.opfs
	if (kind === 'indexeddb') return capabilities.indexedDb
	if (kind === 'file') return capabilities.fileSystemAccess
	return true
}

function ThroughputChart({ samples }: { samples: BenchmarkSample[] }) {
	if (samples.length < 2) return <div className='text-secondary flex h-36 items-center justify-center text-xs'>开始测试后显示每 250ms 吞吐曲线</div>
	const width = 720
	const height = 150
	const padding = 20
	const maxX = samples.at(-1)?.elapsedMs || 1
	const maxY = Math.max(...samples.map(sample => sample.mibPerSecond), 1)
	const points = samples.map(sample => {
		const x = padding + sample.elapsedMs / maxX * (width - padding * 2)
		const y = height - padding - sample.mibPerSecond / maxY * (height - padding * 2)
		return `${x.toFixed(1)},${y.toFixed(1)}`
	}).join(' ')
	return (
		<div className='space-y-2'>
			<div className='flex justify-between text-xs text-secondary'><span>0</span><span>{formatSpeed(maxY)}</span></div>
			<svg viewBox={`0 0 ${width} ${height}`} className='h-36 w-full' role='img' aria-label='吞吐率随时间变化曲线'>
				<path d={`M ${padding} ${height - padding} H ${width - padding}`} stroke='currentColor' className='text-border' strokeWidth='1' fill='none' />
				<path d={`M ${padding} ${padding} V ${height - padding}`} stroke='currentColor' className='text-border' strokeWidth='1' fill='none' />
				<polyline points={points} fill='none' stroke='var(--color-brand)' strokeWidth='2.5' strokeLinejoin='round' strokeLinecap='round' />
			</svg>
		</div>
	)
}

function ResultRow({ result }: { result: BenchmarkResult }) {
	return (
		<div className='grid gap-2 border-t border-border py-3 text-xs sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]'>
			<div className='min-w-0'>
				<p className='truncate font-medium'>{result.label}</p>
				<p className='mt-1 text-secondary'>{result.scope} · {formatBytes(result.bytes)} · {result.status === 'complete' ? '完成' : result.error || '已取消'}</p>
			</div>
			<div><p className='text-secondary'>写入 / 发送</p><p className='mt-1 font-medium'>{formatSpeed(result.throughputMiBps)}</p></div>
			<div><p className='text-secondary'>端到端</p><p className='mt-1 font-medium'>{formatDuration(result.timings.endToEndMs)}</p></div>
			<div><p className='text-secondary'>Finalize</p><p className='mt-1 font-medium'>{formatDuration(result.timings.finalizeMs)}</p></div>
		</div>
	)
}

export function LanBenchmarkClient() {
	const [session, setSession] = useState<BenchmarkSession | null>(null)
	const [status, setStatus] = useState('创建诊断配对码，或扫描另一台设备的诊断二维码')
	const [connected, setConnected] = useState(false)
	const [inviteLink, setInviteLink] = useState('')
	const [qrDataUrl, setQrDataUrl] = useState('')
	const [capabilities, setCapabilities] = useState<BenchmarkCapabilities | null>(null)
	const [peerStats, setPeerStats] = useState<{ route: string; rtt?: number; bitrate?: number } | null>(null)
	const [localStorage, setLocalStorage] = useState<BenchmarkStorageKind>('opfs')
	const [peerStorage, setPeerStorage] = useState<BenchmarkPeerStorage>('sink')
	const [sizeMiB, setSizeMiB] = useState(256)
	const [chunkKiB, setChunkKiB] = useState(124)
	const [running, setRunning] = useState(false)
	const [progress, setProgress] = useState<Progress>(null)
	const [directFilePending, setDirectFilePending] = useState<BenchmarkRunConfig | null>(null)
	const [results, setResults] = useState<BenchmarkResult[]>([])

	const signalRef = useRef<BenchmarkSignalingClient | null>(null)
	const peerRef = useRef<BenchmarkPeer | null>(null)
	const runnerRef = useRef<BenchmarkRunner | null>(null)
	const mountedRef = useRef(true)

	const totalBytes = Math.max(16, Math.min(1_024, sizeMiB)) * MiB
	const chunkSize = chunkKiB * 1024

	const refreshCapabilities = useCallback(async () => {
		const estimate = await navigator.storage?.estimate?.().catch(() => null)
		if (!mountedRef.current) return
		setCapabilities({
			opfs: Boolean(navigator.storage && 'getDirectory' in navigator.storage),
			indexedDb: typeof indexedDB !== 'undefined',
			fileSystemAccess: 'showSaveFilePicker' in window,
			quota: estimate?.quota,
			usage: estimate?.usage,
			available: typeof estimate?.quota === 'number' && typeof estimate.usage === 'number' ? Math.max(0, estimate.quota - estimate.usage) : undefined,
		})
	}, [])

	const disconnect = useCallback(async () => {
		setConnected(false)
		setPeerStats(null)
		setDirectFilePending(null)
		runnerRef.current?.cancel()
		runnerRef.current = null
		peerRef.current?.close()
		peerRef.current = null
		const signal = signalRef.current
		signalRef.current = null
		await signal?.close()
	}, [])

	const appendResult = useCallback((result: BenchmarkResult) => {
		setResults(current => [...current, result])
		setRunning(false)
		setProgress(null)
	}, [])

	const connectSession = useCallback(async (next: BenchmarkSession) => {
		await disconnect()
		setSession(next)
		setStatus('正在连接独立诊断信令')
		let signal: BenchmarkSignalingClient | null = null
		const peer = new BenchmarkPeer(next.role, (type, details, to) => {
			if (!signal) return Promise.reject(new Error('诊断信令尚未就绪'))
			return signal.send(type, details, to)
		})
		const runner = new BenchmarkRunner(peer, {
			onStatus: message => mountedRef.current && setStatus(message),
			onRunStart: () => mountedRef.current && setRunning(true),
			onProgress: (id, bytes, total, samples) => mountedRef.current && setProgress({ id, bytes, totalBytes: total, samples: samples.slice() }),
			onResult: appendResult,
			onDirectFileRequired: run => {
				if (!mountedRef.current) return
				setDirectFilePending(run)
				if (run) setRunning(true)
			},
		})
		peer.setHandlers({
			onState: message => {
				if (!mountedRef.current) return
				setStatus(message)
				window.setTimeout(() => setConnected(peer.isOpen()), 0)
			},
			onControl: value => runner.handleControl(value),
			onData: value => runner.handleData(value),
		})
		peerRef.current = peer
		runnerRef.current = runner
		signal = new BenchmarkSignalingClient(next, event => void peer.handleSignal(event).catch(error => setStatus(error instanceof Error ? error.message : '协商失败')), message => mountedRef.current && setStatus(message))
		signalRef.current = signal
		try {
			await signal.ready
			if (!mountedRef.current) return
			setStatus(next.role === 'host' ? '二维码已创建，等待另一台设备加入' : '已加入诊断房间，等待主机建链')
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '诊断信令连接失败')
		}
	}, [appendResult, disconnect])

	const createRoom = useCallback(async () => {
		const next = await createBenchmarkSession('host')
		if (typeof window !== 'undefined') {
			const link = `${window.location.origin}/dev#mode=benchmark&room=${encodeURIComponent(next.roomId)}&token=${encodeURIComponent(next.token)}`
			setInviteLink(link)
		}
		await connectSession(next)
	}, [connectSession])

	useEffect(() => {
		void refreshCapabilities()
		const hash = window.location.hash.replace(/^#/, '')
		const params = new URLSearchParams(hash)
		if (params.get('mode') === 'benchmark' && params.get('room') && params.get('token')) {
			const invite = { roomId: params.get('room') || '', token: params.get('token') || '' }
			sessionStorage.setItem(inviteStorageKey, JSON.stringify(invite))
			window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
			void createBenchmarkSession('guest', invite.roomId, invite.token).then(connectSession)
			return
		}
		const saved = sessionStorage.getItem(inviteStorageKey)
		if (!saved) return
		try {
			const invite = JSON.parse(saved) as { roomId?: string; token?: string }
			if (invite.roomId && invite.token) void createBenchmarkSession('guest', invite.roomId, invite.token).then(connectSession)
		} catch {
			sessionStorage.removeItem(inviteStorageKey)
		}
	}, [connectSession, refreshCapabilities])

	useEffect(() => {
		if (!inviteLink) return void setQrDataUrl('')
		let cancelled = false
		void QRCode.toDataURL(inviteLink, { width: 220, margin: 2, errorCorrectionLevel: 'M' }).then(url => { if (!cancelled) setQrDataUrl(url) }).catch(() => { if (!cancelled) setStatus('二维码生成失败，请复制链接') })
		return () => { cancelled = true }
	}, [inviteLink])

	useEffect(() => {
		if (!connected) return
		const timer = window.setInterval(() => {
			void peerRef.current?.getStats().then(stats => {
				if (!mountedRef.current) return
				setPeerStats({ route: formatLanConnectionRoute(stats.route), rtt: stats.rttMs, bitrate: stats.availableOutgoingBps })
			}).catch(() => {})
		}, 1_000)
		return () => window.clearInterval(timer)
	}, [connected])

	useEffect(() => () => {
		mountedRef.current = false
		void disconnect()
	}, [disconnect])

	const chartSamples = progress?.samples || results.at(-1)?.samples || []
	const memorySizeAllowed = totalBytes <= LAN_LIMITS.memoryMaxBytes
	const canUseLocalStorage = storageAvailability(localStorage, capabilities) && (localStorage !== 'memory' || memorySizeAllowed)
	const canUsePeerStorage = (peerStorage === 'sink' || storageAvailability(peerStorage, capabilities)) && (peerStorage !== 'memory' || memorySizeAllowed)

	const runLocal = async () => {
		if (!canUseLocalStorage || running) return
		setRunning(true)
		setStatus(`正在运行本机 ${localStorage} 顺序写基准`)
		const result = await runLocalStorageBenchmark({ storage: localStorage, totalBytes, chunkSize, onProgress: (bytes, samples) => setProgress({ id: 'local', bytes, totalBytes, samples: samples.slice() }) })
		appendResult(result)
		setStatus(result.status === 'complete' ? '本机存储基准完成' : result.error || '本机存储基准失败')
	}

	const runPeer = () => {
		if (!connected || session?.role !== 'host' || !canUsePeerStorage || running) return
		const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent)
		const run: BenchmarkRunConfig = {
			id: randomBenchmarkId('peer'),
			label: peerStorage === 'sink' ? 'WebRTC Sink 极限' : `生产单附件 E2E · ${peerStorage}`,
			storage: peerStorage,
			totalBytes,
			chunkSize,
			highWatermark: mobile ? 4 * MiB : 8 * MiB,
			lowWatermark: mobile ? MiB : 2 * MiB,
		}
		try {
			setRunning(true)
			runnerRef.current?.start(run)
		} catch (error) {
			setRunning(false)
			setStatus(error instanceof Error ? error.message : '无法启动双端测试')
		}
	}

	const copyInvite = async () => {
		if (!inviteLink) return
		await navigator.clipboard.writeText(inviteLink)
		setStatus('诊断邀请链接已复制')
	}

	const exportResults = () => {
		const payload = { createdAt: new Date().toISOString(), browser: navigator.userAgent, capabilities, peer: peerStats, results }
		const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `lan-benchmark-${Date.now()}.json`
		link.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className='space-y-8'>
			<header className='flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6'>
				<div>
					<p className='text-brand text-xs font-semibold tracking-[0.18em] uppercase'>LAN diagnostics</p>
					<h1 className='mt-2 text-2xl font-semibold'>局域网快传诊断台</h1>
					<p className='text-secondary mt-2 max-w-2xl leading-6'>独立信令、独立 DataChannel、独立浏览器存储。先测网络 Sink 上限，再测各存储后端和生产单附件端到端路径。</p>
				</div>
				<div className='flex flex-wrap gap-2'>
					<button onClick={() => void cleanupBenchmarkStorage().then(() => { setStatus('已清理诊断 OPFS 与 IndexedDB 数据'); void refreshCapabilities() })} className='text-secondary inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'><Eraser size={14} />清理测试数据</button>
					<button onClick={exportResults} disabled={!results.length} className='text-secondary inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary disabled:opacity-40'><Download size={14} />导出 JSON</button>
				</div>
			</header>

			<div className='grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]'>
				<section className='space-y-5 rounded-2xl border border-border bg-background/30 p-5'>
					<div className='flex items-start gap-3'>
						<div className='bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-full'><Network size={19} /></div>
						<div><p className='text-secondary text-xs tracking-[0.18em] uppercase'>Pair</p><h2 className='mt-1 text-lg font-semibold'>双端真实直连基准</h2></div>
					</div>
					{session?.role === 'host' && inviteLink ? (
						<div className='grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]'>
							<div className='flex items-center justify-center rounded-2xl border border-dashed border-brand/30 bg-brand/5 p-3'>{qrDataUrl ? <img src={qrDataUrl} alt='局域网诊断配对二维码' className='size-[190px]' /> : <QrCode className='text-secondary' size={42} />}</div>
							<div className='space-y-3'><p className='text-sm font-medium'>扫描后会建立独立的 `lan-benchmark-v1` DataChannel。</p><p className='break-all text-xs leading-5 text-secondary'>{inviteLink}</p><button onClick={() => void copyInvite()} className='inline-flex items-center gap-2 rounded-full border border-border bg-article px-3 py-2 text-xs font-medium'><Copy size={14} />复制诊断链接</button></div>
						</div>
					) : session?.role === 'guest' ? (
						<div className='rounded-2xl border border-brand/25 bg-brand/5 p-4 text-sm'><p className='font-medium'>已加入诊断房间</p><p className='mt-1 text-secondary'>{status}</p></div>
					) : (
						<button onClick={() => void createRoom()} className='bg-brand text-background inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold'><QrCode size={16} />创建诊断二维码</button>
					)}
					<div className='flex flex-wrap items-center gap-3 text-xs'><span className={cn('rounded-full px-3 py-1.5 font-medium', connected ? 'bg-brand/15 text-brand' : 'bg-secondary/10 text-secondary')}>{connected ? 'DataChannel 已连接' : '等待连接'}</span><span className='text-secondary'>{status}</span></div>
					{session && <button onClick={() => void disconnect().then(() => { setSession(null); setInviteLink(''); sessionStorage.removeItem(inviteStorageKey); setStatus('已退出诊断房间') })} className='text-secondary text-xs underline underline-offset-4'>退出诊断连接</button>}
				</section>

				<section className='space-y-4 rounded-2xl border border-border bg-background/30 p-5'>
					<div className='flex items-start gap-3'><div className='bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-full'><HardDrive size={19} /></div><div><p className='text-secondary text-xs tracking-[0.18em] uppercase'>Environment</p><h2 className='mt-1 text-lg font-semibold'>本机能力与线路</h2></div></div>
					<div className='grid gap-3 text-xs sm:grid-cols-2'>
						<div><p className='text-secondary'>OPFS</p><p className='mt-1 font-medium'>{capabilities?.opfs ? '可用' : '不可用'}</p></div>
						<div><p className='text-secondary'>IndexedDB</p><p className='mt-1 font-medium'>{capabilities?.indexedDb ? '可用' : '不可用'}</p></div>
						<div><p className='text-secondary'>Direct File</p><p className='mt-1 font-medium'>{capabilities?.fileSystemAccess ? '可用' : '不可用'}</p></div>
						<div><p className='text-secondary'>可用配额</p><p className='mt-1 font-medium'>{capabilities?.available ? formatBytes(capabilities.available) : '未知'}</p></div>
					</div>
					{peerStats && <div className='border-t border-border pt-3 text-xs'><p className='font-medium'>{peerStats.route}</p><p className='text-secondary mt-1'>RTT {peerStats.rtt ? `${peerStats.rtt.toFixed(1)} ms` : '—'} · 浏览器预估上行 {peerStats.bitrate ? formatSpeed(peerStats.bitrate / 8 / MiB) : '—'}</p></div>}
				</section>
			</div>

			<section className='space-y-5 rounded-2xl border border-border bg-background/30 p-5'>
				<div className='flex items-start gap-3'><div className='bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-full'><Activity size={19} /></div><div><p className='text-secondary text-xs tracking-[0.18em] uppercase'>Profiles</p><h2 className='mt-1 text-lg font-semibold'>生产参数基准</h2><p className='text-secondary mt-1 text-xs'>顺序写、单并发、当前 60 / 124 KiB 分块与 4 MiB 聚合写路径；实验扫描应另开配置，不与此结果混合。</p></div></div>
				<div className='grid gap-3 sm:grid-cols-3'>
					<label className='text-xs text-secondary'>数据量（MiB）<select value={sizeMiB} onChange={event => setSizeMiB(Number(event.target.value))} disabled={running} className='mt-1 w-full rounded-xl border border-border bg-article px-3 py-2 text-primary'><option value={64}>64</option><option value={128}>128</option><option value={256}>256</option><option value={512}>512</option></select></label>
					<label className='text-xs text-secondary'>分块大小<select value={chunkKiB} onChange={event => setChunkKiB(Number(event.target.value))} disabled={running} className='mt-1 w-full rounded-xl border border-border bg-article px-3 py-2 text-primary'><option value={60}>60 KiB（兼容档）</option><option value={124}>124 KiB（探测成功档）</option></select></label>
					<div className='text-xs text-secondary'><p>测试工作量</p><p className='mt-3 font-medium text-primary'>{formatBytes(totalBytes)} · {Math.ceil(totalBytes / chunkSize).toLocaleString()} chunks</p></div>
				</div>
				<div className='grid gap-4 lg:grid-cols-2'>
					<div className='rounded-2xl border border-border bg-article p-4'><p className='font-medium'>本机 fio 式顺序写</p><p className='text-secondary mt-1 text-xs'>测 prepare、chunk write、checkpoint、finalize；Direct File 会打开文件保存选择器并保留测试文件供手动删除。Memory 沿用正式 200 MiB 上限。</p><div className='mt-3 flex flex-wrap gap-2'>{localStorages.map(item => { const available = storageAvailability(item.value, capabilities) && (item.value !== 'memory' || memorySizeAllowed); return <button key={item.value} onClick={() => setLocalStorage(item.value)} disabled={running || !available} className={cn('rounded-full border px-3 py-1.5 text-xs', localStorage === item.value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-secondary', !available && 'opacity-40')}>{item.label}</button> })}</div><button onClick={() => void runLocal()} disabled={running || !canUseLocalStorage} className='bg-brand text-background mt-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-40'><Play size={13} />运行本机基准</button></div>
					<div className='rounded-2xl border border-border bg-article p-4'><p className='font-medium'>真实 WebRTC 双端基准</p><p className='text-secondary mt-1 text-xs'>Sink 只计数不写盘，给出真实局域网连接下的 DataChannel 传输极限；其余项使用同一分块与真实存储引擎。</p><div className='mt-3 flex flex-wrap gap-2'>{peerStorages.map(item => { const available = (item.value === 'sink' || storageAvailability(item.value, capabilities)) && (item.value !== 'memory' || memorySizeAllowed); return <button key={item.value} onClick={() => setPeerStorage(item.value)} disabled={running || !available} className={cn('rounded-full border px-3 py-1.5 text-xs', peerStorage === item.value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-secondary', !available && 'opacity-40')}>{item.label}</button> })}</div><button onClick={runPeer} disabled={running || !connected || session?.role !== 'host' || !canUsePeerStorage} className='bg-brand text-background mt-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-40'><Wifi size={13} />运行双端基准</button>{session?.role === 'guest' && <p className='text-secondary mt-3 text-xs'>主机负责发起测试；此设备会自动成为接收端。</p>}</div>
				</div>
				{directFilePending && <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/5 p-4 text-sm'><div><p className='font-medium'>对方请求 Direct File 接收测试</p><p className='text-secondary mt-1 text-xs'>选择一个新测试文件位置后，才会开始写入。</p></div><button onClick={() => void runnerRef.current?.prepareDirectFile()} className='bg-brand text-background rounded-full px-3 py-2 text-xs font-semibold'>选择位置并继续</button></div>}
				{running && <button onClick={() => runnerRef.current?.cancel()} className='text-secondary inline-flex items-center gap-2 text-xs underline underline-offset-4'><RotateCcw size={13} />取消当前测试</button>}
			</section>

			<section className='rounded-2xl border border-border bg-background/30 p-5'>
				<div className='flex items-start gap-3'><div className='bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-full'><BarChart3 size={19} /></div><div><p className='text-secondary text-xs tracking-[0.18em] uppercase'>Results</p><h2 className='mt-1 text-lg font-semibold'>吞吐与阶段结果</h2></div></div>
				{progress && <div className='mt-5 space-y-3'><div className='flex flex-wrap items-center justify-between gap-2 text-xs'><span>{formatBytes(progress.bytes)} / {formatBytes(progress.totalBytes)}</span><span className='text-secondary'>{progress.totalBytes ? `${(progress.bytes / progress.totalBytes * 100).toFixed(1)}%` : '0%'}</span></div><ThroughputChart samples={chartSamples} /></div>}
				{!progress && results.length === 0 && <div className='text-secondary mt-6 flex items-center gap-2 text-sm'><ShieldAlert size={16} />尚无结果。先运行 Sink，确认网络上限后再比较各存储后端。</div>}
				{results.length > 0 && <div className='mt-5'><ThroughputChart samples={chartSamples} /><div className='mt-4'>{results.slice().reverse().map((result, index) => <ResultRow key={`${result.id}-${result.scope}-${index}`} result={result} />)}</div></div>}
			</section>
		</div>
	)
}
