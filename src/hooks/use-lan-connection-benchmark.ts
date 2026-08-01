'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { endpointAddressKind, validLanWebTransportEndpoint } from '@/lib/lan-transfer/native-agent/endpoint-validation'
import { nativeAgentLnaTicketCount, queryLocalNetworkAccessPermission, runLanNativeHttpBenchmark, selectLocalNetworkAccessEndpoint } from '@/lib/lan-transfer/native-agent/peer-lna-http'
import { runLanNativeBenchmark } from '@/lib/lan-transfer/native-agent/peer-webtransport'
import { NATIVE_AGENT_SESSION_COUNT, type LanNativeAgentAdvertisement, type LanNativeAgentTicket, type LanNativeBenchmarkProgress } from '@/lib/lan-transfer/native-agent/types'
import type { LanCapability, LanPeer, LanWebRtcBenchmarkDirection, LanWebRtcBenchmarkProgress, LanWebRtcBenchmarkResult } from '@/lib/lan-transfer/types'
import type { LanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import { logLanConnection, shortConnectionId } from '@/lib/lan-transfer/connection-diagnostics'

export type LanBenchmarkTransport = 'auto' | 'webrtc' | 'lna-http' | 'webtransport'
export type LanBenchmarkActualTransport = Exclude<LanBenchmarkTransport, 'auto'>

export type LanBenchmarkConnection = {
	peerId: string
	peer: LanPeer
	connected: boolean
	connectionRoute: LanConnectionRoute | null
	remoteCapability: LanCapability | null
}

export type LanBenchmarkAvailability = {
	available: boolean
	status: string
}

export type LanBenchmarkEntry = {
	key: string
	peerId: string
	peerName: string
	requestedTransport: LanBenchmarkTransport
	actualTransport?: LanBenchmarkActualTransport
	direction: LanWebRtcBenchmarkDirection
	totalBytes: number
	bytes: number
	state: 'running' | 'complete' | 'error' | 'cancelled'
	startedAt: number
	finishedAt?: number
	clientElapsedMs?: number
	peerElapsedMs?: number
	clientMbps?: number
	peerMbps?: number
	sessionCount?: number
	connectionRoute: LanConnectionRoute | null
	error?: string
}

type RunWebRtcBenchmark = (
	peerId: string,
	direction: LanWebRtcBenchmarkDirection,
	totalBytes: number,
	onProgress?: (progress: LanWebRtcBenchmarkProgress) => void,
	signal?: AbortSignal
) => Promise<LanWebRtcBenchmarkResult>

type BenchmarkTask = {
	peerId: string
	transport: LanBenchmarkTransport
	direction: LanWebRtcBenchmarkDirection
	totalBytes: number
}

type BenchmarkRunOptions = {
	peerIds: string[]
	transports: LanBenchmarkTransport[]
	directions: LanWebRtcBenchmarkDirection[]
	totalBytes: number
}

type UnifiedResult = {
	actualTransport: LanBenchmarkActualTransport
	bytes: number
	clientElapsedMs: number
	peerElapsedMs: number
	clientMbps: number
	peerMbps: number
	sessionCount: number
}

export function benchmarkTransportAvailability(connection: LanBenchmarkConnection | null, transport: LanBenchmarkTransport, webTransportSupported: boolean): LanBenchmarkAvailability {
	if (!connection?.connected) return { available: false, status: '设备未连接' }
	if (transport === 'auto') return { available: true, status: '按当前策略自动选择' }
	if (transport === 'webrtc') return { available: true, status: '已建立加密直连' }
	const advertisement = connection.remoteCapability?.nativeAgent
	if (!advertisement) return { available: false, status: '对方未提供 Agent' }
	if (transport === 'lna-http') return advertisement.lnaHttpEndpoints.length
		? { available: true, status: '测试时检查本地网络权限' }
		: { available: false, status: '没有可用的 HTTP/TCP 地址' }
	if (!webTransportSupported) return { available: false, status: '当前浏览器不支持 WebTransport' }
	return advertisement.endpoints.some(validLanWebTransportEndpoint)
		? { available: true, status: '可测试 QUIC/UDP' }
		: { available: false, status: '没有可用的 QUIC 地址' }
}

export function useLanConnectionBenchmark(options: {
	connections: LanBenchmarkConnection[]
	webTransportSupported: boolean
	requestNativeAgentTicket: (peerId: string) => Promise<LanNativeAgentTicket>
	runWebRtcBenchmark: RunWebRtcBenchmark
	reserveBenchmark: (peerId: string) => () => void
}) {
	const optionsRef = useRef(options)
	const abortRef = useRef<AbortController | null>(null)
	const runIdRef = useRef(0)
	const activePeerIdRef = useRef('')
	const [entries, setEntries] = useState<LanBenchmarkEntry[]>([])
	const [running, setRunning] = useState(false)
	optionsRef.current = options

	const upsertEntry = useCallback((entry: LanBenchmarkEntry) => {
		setEntries(current => {
			const index = current.findIndex(item => item.key === entry.key)
			if (index < 0) return [entry, ...current]
			const next = current.slice()
			next[index] = entry
			return next
		})
	}, [])

	const patchEntry = useCallback((key: string, patch: Partial<LanBenchmarkEntry>) => {
		setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...patch } : entry))
	}, [])

	const cancel = useCallback(() => abortRef.current?.abort(), [])
	const clear = useCallback(() => {
		if (!abortRef.current) setEntries([])
	}, [])

	const run = useCallback(async ({ peerIds, transports, directions, totalBytes }: BenchmarkRunOptions) => {
		if (abortRef.current) return
		const runId = (runIdRef.current += 1)
		const controller = new AbortController()
		abortRef.current = controller
		setRunning(true)
		const snapshot = optionsRef.current.connections.filter(connection => connection.connected && peerIds.includes(connection.peerId))
		const tasks = snapshot.flatMap(connection => transports
			.filter(transport => benchmarkTransportAvailability(connection, transport, optionsRef.current.webTransportSupported).available)
			.flatMap(transport => directions.map(direction => ({ peerId: connection.peerId, transport, direction, totalBytes }))))

		try {
			for (const task of tasks) {
				if (controller.signal.aborted || runIdRef.current !== runId) break
				const connection = optionsRef.current.connections.find(item => item.peerId === task.peerId && item.connected)
				if (!connection) continue
				activePeerIdRef.current = task.peerId
				const key = benchmarkEntryKey(task)
				const startedAt = performance.now()
				const entry: LanBenchmarkEntry = {
					key,
					peerId: connection.peerId,
					peerName: connection.peer.name,
					requestedTransport: task.transport,
					direction: task.direction,
					totalBytes: task.totalBytes,
					bytes: 0,
					state: 'running',
					startedAt,
					connectionRoute: connection.connectionRoute,
				}
				upsertEntry(entry)
				logLanConnection('BENCHMARK', 'task-started', { peer: shortConnectionId(task.peerId), transport: task.transport, direction: task.direction, totalBytes: task.totalBytes })
				try {
					const result = await runBenchmarkTask(task, connection, optionsRef.current, controller.signal, bytes => patchEntry(key, { bytes }))
					if (controller.signal.aborted) throw new DOMException('测速已取消', 'AbortError')
					patchEntry(key, {
						state: 'complete',
						actualTransport: result.actualTransport,
						bytes: result.bytes,
						clientElapsedMs: result.clientElapsedMs,
						peerElapsedMs: result.peerElapsedMs,
						clientMbps: result.clientMbps,
						peerMbps: result.peerMbps,
						sessionCount: result.sessionCount,
						finishedAt: performance.now(),
					})
					logLanConnection('BENCHMARK', 'task-completed', { peer: shortConnectionId(task.peerId), requestedTransport: task.transport, actualTransport: result.actualTransport, direction: task.direction, clientMbps: Math.round(result.clientMbps) })
				} catch (error) {
					const cancelled = isAbortError(error) || controller.signal.aborted
					const message = cancelled ? '测速已取消' : error instanceof Error ? error.message : '测速失败'
					patchEntry(key, { state: cancelled ? 'cancelled' : 'error', error: message, finishedAt: performance.now() })
					logLanConnection('BENCHMARK', 'task-failed', { peer: shortConnectionId(task.peerId), transport: task.transport, direction: task.direction, error: message }, cancelled ? 'warn' : 'error')
					if (cancelled) break
				}
			}
		} finally {
			if (runIdRef.current === runId) {
				abortRef.current = null
				activePeerIdRef.current = ''
				setRunning(false)
			}
		}
	}, [patchEntry, upsertEntry])

	useEffect(() => {
		const activePeerId = activePeerIdRef.current
		if (activePeerId && !options.connections.some(connection => connection.peerId === activePeerId && connection.connected)) abortRef.current?.abort()
	}, [options.connections])

	useEffect(() => () => abortRef.current?.abort(), [])

	return { entries, running, run, cancel, clear }
}

export type LanConnectionBenchmarkController = ReturnType<typeof useLanConnectionBenchmark>

async function runBenchmarkTask(
	task: BenchmarkTask,
	connection: LanBenchmarkConnection,
	options: {
		webTransportSupported: boolean
		requestNativeAgentTicket: (peerId: string) => Promise<LanNativeAgentTicket>
		runWebRtcBenchmark: RunWebRtcBenchmark
		reserveBenchmark: (peerId: string) => () => void
	},
	signal: AbortSignal,
	onBytes: (bytes: number) => void
): Promise<UnifiedResult> {
	if (task.transport === 'webrtc') return runWebRtcTask(task, options.runWebRtcBenchmark, signal, onBytes)
	const advertisement = connection.remoteCapability?.nativeAgent || null
	if (task.transport === 'auto' && !advertisement) return runWebRtcTask(task, options.runWebRtcBenchmark, signal, onBytes)
	if (!advertisement) throw new Error('对方没有运行可用的加速组件')

	try {
		return await runNativeTask(task, advertisement, options, signal, onBytes)
	} catch (error) {
		if (task.transport !== 'auto' || isAbortError(error) || signal.aborted) throw error
		logLanConnection('BENCHMARK', 'auto-native-fallback', { peer: shortConnectionId(task.peerId), error: error instanceof Error ? error.message : String(error) }, 'warn')
		return runWebRtcTask(task, options.runWebRtcBenchmark, signal, onBytes)
	}
}

async function runWebRtcTask(task: BenchmarkTask, runner: RunWebRtcBenchmark, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<UnifiedResult> {
	const result = await runner(task.peerId, task.direction, task.totalBytes, progress => onBytes(progress.bytes), signal)
	return {
		actualTransport: 'webrtc',
		bytes: result.bytes,
		clientElapsedMs: result.clientElapsedMs,
		peerElapsedMs: result.receiverElapsedMs,
		clientMbps: result.clientMbps,
		peerMbps: result.receiverMbps,
		sessionCount: 1,
	}
}

async function runNativeTask(
	task: BenchmarkTask,
	advertisement: LanNativeAgentAdvertisement,
	options: {
		webTransportSupported: boolean
		requestNativeAgentTicket: (peerId: string) => Promise<LanNativeAgentTicket>
		reserveBenchmark: (peerId: string) => () => void
	},
	signal: AbortSignal,
	onBytes: (bytes: number) => void
): Promise<UnifiedResult> {
	const releaseBenchmark = options.reserveBenchmark(task.peerId)
	try {
		const direction = task.direction === 'upload' ? 'browser-to-agent' : 'agent-to-browser'
		let selected: 'lna-http' | 'webtransport'
		let endpoint = ''

		if (task.transport === 'lna-http' || task.transport === 'auto') {
			const lna = await selectLocalNetworkAccessEndpoint(advertisement.lnaHttpEndpoints, signal)
			if (lna.state === 'available') {
				selected = 'lna-http'
				endpoint = lna.endpoint
			} else if (task.transport === 'lna-http') {
				throw new Error(lna.state === 'denied' ? '本地网络访问权限已拒绝' : lna.state === 'unavailable' ? lna.reason : '当前浏览器不支持本地网络访问权限')
			} else {
				selected = await selectWebTransport(advertisement, options.webTransportSupported, lna.state === 'denied')
			}
		} else {
			const permission = await queryLocalNetworkAccessPermission()
			selected = await selectWebTransport(advertisement, options.webTransportSupported, permission === 'denied')
		}

		throwIfAborted(signal)
		const ticketCount = selected === 'lna-http' ? nativeAgentLnaTicketCount(task.totalBytes) : NATIVE_AGENT_SESSION_COUNT
		const tickets = await abortable(Promise.all(Array.from({ length: ticketCount }, () => options.requestNativeAgentTicket(task.peerId))), signal)
		if (tickets.some(ticket => ticket.ownerDeviceId !== advertisement.ownerDeviceId)) throw new Error('极速通道凭据来自错误的设备')
		const onProgress = (progress: LanNativeBenchmarkProgress) => onBytes(progress.bytes)
		const result = selected === 'lna-http'
			? await runLanNativeHttpBenchmark({ tickets, endpoint, direction, totalBytes: task.totalBytes, onProgress, signal })
			: await runLanNativeBenchmark({ tickets, direction, totalBytes: task.totalBytes, onProgress, signal })
		return {
			actualTransport: selected,
			bytes: result.bytes,
			clientElapsedMs: result.clientElapsedMs,
			peerElapsedMs: result.agentElapsedMs,
			clientMbps: result.clientMbps,
			peerMbps: result.agentMbps,
			sessionCount: result.sessionCount,
		}
	} finally {
		releaseBenchmark()
	}
}

async function selectWebTransport(advertisement: LanNativeAgentAdvertisement, supported: boolean, lnaDenied: boolean): Promise<'webtransport'> {
	if (!supported) throw new Error('当前浏览器不支持 WebTransport')
	const endpoints = advertisement.endpoints.filter(validLanWebTransportEndpoint)
	if (!endpoints.length) throw new Error('对方没有发布可用的 WebTransport 地址')
	const publicIpv6Available = endpoints.some(endpoint => endpointAddressKind(endpoint) === 'gua-ipv6')
	if (lnaDenied && !publicIpv6Available) throw new Error('本地网络权限已拒绝，且没有可用的公网 IPv6 QUIC 地址')
	return 'webtransport'
}

function benchmarkEntryKey(task: BenchmarkTask) {
	return `${task.peerId}:${task.transport}:${task.direction}`
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal) {
	if (signal.aborted) throw new DOMException('测速已取消', 'AbortError')
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
	if (signal.aborted) return Promise.reject<T>(new DOMException('测速已取消', 'AbortError'))
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new DOMException('测速已取消', 'AbortError'))
		signal.addEventListener('abort', abort, { once: true })
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
	})
}
