'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectLanNativeAgentCapability, type LanNativeAgentCapability } from '@/lib/lan-transfer/native-agent/capability'
import { createLanAgentLaunchRequest, launchLanNativeAgent, subscribeLanAgentCallbacks } from '@/lib/lan-transfer/native-agent/launch-client'
import { LanNativeLocalBridge } from '@/lib/lan-transfer/native-agent/local-bridge'
import type { LanNativeLocalAgentPort } from '@/lib/lan-transfer/native-agent/ports'
import { nativeAgentLnaTicketCount, runLanNativeHttpBenchmark, selectLocalNetworkAccessEndpoint } from '@/lib/lan-transfer/native-agent/peer-lna-http'
import { runLanNativeBenchmark } from '@/lib/lan-transfer/native-agent/peer-webtransport'
import { endpointAddressKind, summarizeNativeEndpoints, validLanWebTransportEndpoint } from '@/lib/lan-transfer/native-agent/endpoint-validation'
import { logLanConnection, shortConnectionId } from '@/lib/lan-transfer/connection-diagnostics'
import {
	NATIVE_AGENT_BENCHMARK_VERSION,
	NATIVE_AGENT_LNA_HTTP_VERSION,
	NATIVE_AGENT_FILE_VERSION,
	NATIVE_AGENT_SESSION_COUNT,
	type LanNativeAgentAdvertisement,
	type LanNativeAgentCallback,
	type LanNativeAgentTicket,
	type LanNativeBenchmarkDirection,
	type LanNativeBenchmarkProgress,
	type LanNativeBenchmarkResult
} from '@/lib/lan-transfer/native-agent/types'

const SPEED_MODE_PREFERENCE_KEY = 'lan-native-speed-mode-enabled'
const LAUNCH_CALLBACK_TIMEOUT_MS = 30_000
const LAUNCH_NONCE_TTL_MS = 150_000
const INITIAL_CAPABILITY: LanNativeAgentCapability = { device: 'desktop', webTransport: false, canHostAgent: false }

export type LanNativeBenchmarkState = {
	state: 'idle' | 'running' | 'complete' | 'error'
	progress?: LanNativeBenchmarkProgress
	result?: LanNativeBenchmarkResult
	error?: string
}

export type LanNativeSpeedModeState = LanNativeAgentCapability & {
	ready: boolean
	enabled: boolean
	agentState: 'idle' | 'launching' | 'connecting' | 'connected' | 'error'
	status: string
	localAdvertisement: LanNativeAgentAdvertisement | null
	remoteAdvertisement: LanNativeAgentAdvertisement | null
	canBenchmark: boolean
	benchmark: LanNativeBenchmarkState
	setEnabled: (enabled: boolean) => void
	reconnect: () => void
	issuePeerTicket: (peerDeviceId: string) => Promise<LanNativeAgentTicket>
	runBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number, requestTicket: () => Promise<LanNativeAgentTicket>) => Promise<void>
	localAgentPort: LanNativeLocalAgentPort | null
}

export function useLanNativeSpeedMode(ownerDeviceId = '', advertisedByPeer: LanNativeAgentAdvertisement | null = null): LanNativeSpeedModeState {
	const bridgeRef = useRef<LanNativeLocalBridge | null>(null)
	const endpointSubscriptionRef = useRef<(() => void) | null>(null)
	const pendingLaunchesRef = useRef(new Map<string, number>())
	const launchInFlightRef = useRef(false)
	const handledNonceRef = useRef('')
	const connectionAttemptRef = useRef(0)
	const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const autoLaunchAttemptedRef = useRef(false)
	const [ready, setReady] = useState(false)
	const [capability, setCapability] = useState(INITIAL_CAPABILITY)
	const [preferenceEnabled, setPreferenceEnabled] = useState(false)
	const [agentState, setAgentState] = useState<LanNativeSpeedModeState['agentState']>('idle')
	const [agentError, setAgentError] = useState('')
	const [callback, setCallback] = useState<LanNativeAgentCallback | null>(null)
	const [benchmark, setBenchmark] = useState<LanNativeBenchmarkState>({ state: 'idle' })

	const closeBridge = useCallback(() => {
		connectionAttemptRef.current += 1
		bridgeRef.current?.close()
		endpointSubscriptionRef.current?.()
		endpointSubscriptionRef.current = null
		bridgeRef.current = null
		setCallback(null)
	}, [])

	const connectCallback = useCallback(async (next: LanNativeAgentCallback) => {
		const now = Date.now()
		pendingLaunchesRef.current.forEach((expiresAt, nonce) => {
			if (expiresAt <= now) pendingLaunchesRef.current.delete(nonce)
		})
		if (!pendingLaunchesRef.current.has(next.nonce) || next.nonce === handledNonceRef.current) {
			logLanConnection('NATIVE', 'callback-ignored', { reason: next.nonce === handledNonceRef.current ? 'already-handled' : 'nonce-not-pending', pendingLaunchCount: pendingLaunchesRef.current.size }, 'warn')
			return
		}
		logLanConnection('NATIVE', 'callback-accepted', {
			bridgeVersion: next.bridgeVersion,
			publicIpv6State: next.publicIpv6State,
			networkEpoch: next.networkEpoch,
			benchmarkEndpoints: summarizeNativeEndpoints(next.benchmarkEndpoints),
			lnaHttpEndpoints: summarizeNativeEndpoints(next.lnaHttpEndpoints),
		})
		handledNonceRef.current = next.nonce
		const attempt = (connectionAttemptRef.current += 1)
		if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
		launchTimerRef.current = null
		setAgentState('connecting')
		setAgentError('')
		logLanConnection('NATIVE', 'bridge-connecting', { bridgeVersion: next.bridgeVersion })
		try {
			const bridge = await LanNativeLocalBridge.connect(next)
			if (attempt !== connectionAttemptRef.current) {
				bridge.close()
				return
			}
			bridgeRef.current?.close()
			bridgeRef.current = bridge
			pendingLaunchesRef.current.clear()
			launchInFlightRef.current = false
			endpointSubscriptionRef.current?.()
			endpointSubscriptionRef.current = bridge.subscribeNetworkEndpoints(snapshot => {
				logLanConnection('NATIVE', 'endpoint-snapshot-changed', {
					publicIpv6State: snapshot.publicIpv6State,
					networkEpoch: snapshot.networkEpoch,
					benchmarkEndpoints: summarizeNativeEndpoints(snapshot.benchmarkEndpoints),
					lnaHttpEndpoints: summarizeNativeEndpoints(snapshot.lnaHttpEndpoints),
					fileHttpEndpoints: summarizeNativeEndpoints(snapshot.fileHttpEndpoints),
					fileWebTransportEndpoints: summarizeNativeEndpoints(snapshot.fileWebTransportEndpoints),
				})
				setCallback(current => current ? {
					...current,
					networkEpoch: snapshot.networkEpoch,
					benchmarkEndpoints: snapshot.benchmarkEndpoints,
					lnaHttpEndpoints: snapshot.lnaHttpEndpoints,
					fileHttpEndpoints: snapshot.fileHttpEndpoints,
					fileWebTransportEndpoints: snapshot.fileWebTransportEndpoints,
					publicIpv6State: snapshot.publicIpv6State,
				} : current)
			})
			setCallback({ ...bridge.callback })
			setAgentState('connected')
			logLanConnection('NATIVE', 'bridge-connected', {
				publicIpv6State: bridge.callback.publicIpv6State,
				networkEpoch: bridge.callback.networkEpoch,
				benchmarkEndpoints: summarizeNativeEndpoints(bridge.callback.benchmarkEndpoints),
				lnaHttpEndpoints: summarizeNativeEndpoints(bridge.callback.lnaHttpEndpoints),
			})
		} catch (error) {
			if (attempt !== connectionAttemptRef.current) return
			pendingLaunchesRef.current.delete(next.nonce)
			launchInFlightRef.current = false
			if (bridgeRef.current) {
				setAgentState('connected')
				return
			}
			setAgentState('error')
			const message = error instanceof Error ? error.message : '无法连接本机加速组件'
			setAgentError(message)
			logLanConnection('NATIVE', 'bridge-connection-failed', { error: message }, 'error')
		}
	}, [])

	useEffect(() => {
		const nextCapability = detectLanNativeAgentCapability()
		let storedPreference = false
		try {
			storedPreference = localStorage.getItem(SPEED_MODE_PREFERENCE_KEY) === 'true'
		} catch {}
		setCapability(nextCapability)
		setPreferenceEnabled(storedPreference)
		setReady(true)
		logLanConnection('NATIVE', 'capability-detected', { ...nextCapability, preferenceEnabled: storedPreference })
		return subscribeLanAgentCallbacks(callback => void connectCallback(callback))
	}, [connectCallback])

	useEffect(
		() => () => {
			connectionAttemptRef.current += 1
			if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
			bridgeRef.current?.close()
			endpointSubscriptionRef.current?.()
		},
		[]
	)

	const launch = useCallback(() => {
		if (!capability.canHostAgent || launchInFlightRef.current || bridgeRef.current) return
		autoLaunchAttemptedRef.current = true
		const request = createLanAgentLaunchRequest()
		connectionAttemptRef.current += 1
		handledNonceRef.current = ''
		pendingLaunchesRef.current.set(request.nonce, Date.now() + LAUNCH_NONCE_TTL_MS)
		launchInFlightRef.current = true
		setAgentState('launching')
		setAgentError('')
		logLanConnection('NATIVE', 'launch-requested', { callbackTimeoutMs: LAUNCH_CALLBACK_TIMEOUT_MS, nonceTtlMs: LAUNCH_NONCE_TTL_MS, pendingLaunchCount: pendingLaunchesRef.current.size })
		launchLanNativeAgent(request.uri)
		if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
		launchTimerRef.current = setTimeout(() => {
			launchTimerRef.current = null
			launchInFlightRef.current = false
			setAgentState(current => (current === 'launching' ? 'error' : current))
			setAgentError('暂时没有收到本机组件回调；如果系统权限窗口仍在处理，请稍候，或稍后重试')
			logLanConnection('NATIVE', 'launch-callback-timeout', { pendingLaunchCount: pendingLaunchesRef.current.size }, 'warn')
		}, LAUNCH_CALLBACK_TIMEOUT_MS)
	}, [capability.canHostAgent])

	useEffect(() => {
		if (!ready || !preferenceEnabled || !capability.canHostAgent || autoLaunchAttemptedRef.current) return
		launch()
	}, [capability.canHostAgent, launch, preferenceEnabled, ready])

	const setEnabled = useCallback(
		(value: boolean) => {
			logLanConnection('NATIVE', 'preference-changed', { enabled: value })
			setPreferenceEnabled(value)
			try {
				localStorage.setItem(SPEED_MODE_PREFERENCE_KEY, String(value))
			} catch {}
			if (value) launch()
			else {
				if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
				launchTimerRef.current = null
				pendingLaunchesRef.current.clear()
				launchInFlightRef.current = false
				closeBridge()
				setAgentState('idle')
				setAgentError('')
			}
		},
		[closeBridge, launch]
	)

	const localAdvertisement = useMemo<LanNativeAgentAdvertisement | null>(() => {
		if (!callback || !ownerDeviceId || agentState !== 'connected') return null
		return {
			bridgeVersion: callback.bridgeVersion,
			benchmarkVersion: NATIVE_AGENT_BENCHMARK_VERSION,
			lnaHttpVersion: NATIVE_AGENT_LNA_HTTP_VERSION,
			ownerDeviceId,
			endpoints: callback.benchmarkEndpoints,
			lnaHttpEndpoints: callback.lnaHttpEndpoints,
			fileVersion: NATIVE_AGENT_FILE_VERSION,
			fileHttpEndpoints: callback.fileHttpEndpoints,
			fileWebTransportEndpoints: callback.fileWebTransportEndpoints,
			certificateSha256: callback.certificateSha256,
			networkEpoch: callback.networkEpoch,
			publicIpv6State: callback.publicIpv6State
		}
	}, [agentState, callback, ownerDeviceId])

	const localWins = Boolean(localAdvertisement && advertisedByPeer && localAdvertisement.ownerDeviceId < advertisedByPeer.ownerDeviceId)
	const remoteAdvertisement = localAdvertisement && localWins ? null : advertisedByPeer

	useEffect(() => {
		if (!advertisedByPeer) {
			logLanConnection('NATIVE', 'remote-advertisement-cleared')
			return
		}
		logLanConnection('NATIVE', 'remote-advertisement-updated', {
			owner: shortConnectionId(advertisedByPeer.ownerDeviceId),
			publicIpv6State: advertisedByPeer.publicIpv6State,
			networkEpoch: advertisedByPeer.networkEpoch,
			benchmarkEndpoints: summarizeNativeEndpoints(advertisedByPeer.endpoints),
			lnaHttpEndpoints: summarizeNativeEndpoints(advertisedByPeer.lnaHttpEndpoints),
		})
	}, [advertisedByPeer?.networkEpoch, advertisedByPeer?.ownerDeviceId, advertisedByPeer?.publicIpv6State])

	useEffect(() => {
		if (!localAdvertisement || !advertisedByPeer || localWins) return
		closeBridge()
		setAgentState('error')
		setAgentError('本次会话已由另一台电脑提供极速模式')
	}, [advertisedByPeer, closeBridge, localAdvertisement, localWins])

	useEffect(() => setBenchmark({ state: 'idle' }), [remoteAdvertisement?.ownerDeviceId])

	const issuePeerTicket = useCallback(
		async (peerDeviceId: string) => {
			const bridge = bridgeRef.current
			if (!bridge || !ownerDeviceId || peerDeviceId === ownerDeviceId) return Promise.reject(new Error('本机加速组件未连接'))
			logLanConnection('NATIVE', 'ticket-issue-requested', { owner: shortConnectionId(ownerDeviceId), peer: shortConnectionId(peerDeviceId) })
			try {
				const ticket = await bridge.issueTicket(ownerDeviceId)
				logLanConnection('NATIVE', 'ticket-issued', {
					publicIpv6State: ticket.publicIpv6State,
					networkEpoch: ticket.networkEpoch,
					benchmarkEndpoints: summarizeNativeEndpoints(ticket.endpoints),
					lnaHttpEndpoints: summarizeNativeEndpoints(ticket.lnaHttpEndpoints),
				})
				return ticket
			} catch (error) {
				logLanConnection('NATIVE', 'ticket-issue-failed', { error: error instanceof Error ? error.message : String(error) }, 'error')
				throw error
			}
		},
		[ownerDeviceId]
	)

	const runBenchmark = useCallback(
		async (direction: LanNativeBenchmarkDirection, totalBytes: number, requestTicket: () => Promise<LanNativeAgentTicket>) => {
			if (!remoteAdvertisement) return void setBenchmark({ state: 'error', error: '当前连接没有可用的加速电脑' })
			const sessionCount = NATIVE_AGENT_SESSION_COUNT
			logLanConnection('NATIVE', 'benchmark-started', { direction, totalBytes, remoteOwner: shortConnectionId(remoteAdvertisement.ownerDeviceId), publicIpv6State: remoteAdvertisement.publicIpv6State })
			setBenchmark({ state: 'running', progress: { direction, transport: 'lna-http', sessionCount, bytes: 0, totalBytes, startedAt: performance.now() } })
			try {
				const lna = await selectLocalNetworkAccessEndpoint(remoteAdvertisement.lnaHttpEndpoints)
				const webTransportEndpoints = remoteAdvertisement.endpoints.filter(validLanWebTransportEndpoint)
				const publicIpv6Available = webTransportEndpoints.some(endpoint => endpointAddressKind(endpoint) === 'gua-ipv6')
				const canUseWebTransport = capability.webTransport && webTransportEndpoints.length > 0 && (lna.state !== 'denied' || publicIpv6Available)
				const ticketCount = lna.state === 'available' ? nativeAgentLnaTicketCount(totalBytes) : sessionCount
				logLanConnection('NATIVE', 'benchmark-route-evaluated', { lnaState: lna.state, webTransportSupported: capability.webTransport, publicIpv6Available, canUseWebTransport, selectedTransport: lna.state === 'available' ? 'lna-http' : canUseWebTransport ? 'webtransport' : 'none', ticketCount })
				if (lna.state !== 'available' && !canUseWebTransport)
					throw new Error(lna.state === 'denied' ? '你已拒绝本地网络访问权限，且加速电脑没有可用的公网 IPv6 WebTransport 地址' : lna.state === 'unavailable' ? lna.reason : '当前浏览器既不支持本地网络访问，也不支持 WebTransport')
				logLanConnection('NATIVE', 'benchmark-tickets-requested', { ticketCount })
				const tickets = await Promise.all(Array.from({ length: ticketCount }, () => requestTicket()))
				logLanConnection('NATIVE', 'benchmark-tickets-received', { ticketCount: tickets.length })
				if (tickets.some(ticket => ticket.ownerDeviceId !== remoteAdvertisement.ownerDeviceId)) throw new Error('极速通道凭据来自错误的设备')
				const result =
					lna.state === 'available'
						? await runLanNativeHttpBenchmark({
								tickets,
								endpoint: lna.endpoint,
								direction,
								totalBytes,
								onProgress: progress => setBenchmark({ state: 'running', progress })
							})
						: await runLanNativeBenchmark({ tickets, direction, totalBytes, onProgress: progress => setBenchmark({ state: 'running', progress }) })
				setBenchmark({ state: 'complete', result })
				logLanConnection('NATIVE', 'benchmark-completed', { direction, transport: result.transport, sessionCount: result.sessionCount, totalBytes, clientMbps: Math.round(result.clientMbps), agentMbps: Math.round(result.agentMbps) })
			} catch (error) {
				const message = error instanceof Error ? error.message : '极速模式测速失败'
				setBenchmark({ state: 'error', error: message })
				logLanConnection('NATIVE', 'benchmark-failed', { direction, totalBytes, error: message }, 'error')
			}
		},
		[capability.webTransport, remoteAdvertisement]
	)

	const status = nativeSpeedStatus(localAdvertisement, remoteAdvertisement, agentState, agentError, capability.device, preferenceEnabled)

	return {
		...capability,
		ready,
		enabled: capability.canHostAgent && preferenceEnabled,
		agentState,
		status,
		localAdvertisement,
		remoteAdvertisement,
		canBenchmark: Boolean(remoteAdvertisement && !localAdvertisement),
		benchmark,
		setEnabled,
		reconnect: launch,
		issuePeerTicket,
		runBenchmark,
		localAgentPort: bridgeRef.current
	}
}

function nativeSpeedStatus(
	local: LanNativeAgentAdvertisement | null,
	remote: LanNativeAgentAdvertisement | null,
	state: LanNativeSpeedModeState['agentState'],
	error: string,
	device: LanNativeAgentCapability['device'],
	enabled: boolean
) {
	if (local?.publicIpv6State === 'authorizing') return '本机组件已连接，正在后台配置公网 IPv6；IPv4/内网通道可先使用'
	if (local?.publicIpv6State === 'available') return '本机组件已连接，公网 IPv6 与内网通道均已就绪'
	if (local?.publicIpv6State === 'unavailable') return '本机组件已连接，公网 IPv6 未授权；继续使用 IPv4、内网或普通直连'
	if (local) return '本机组件已连接，等待网页设备使用'
	if (remote) return '已发现加速电脑，大文件将自动加速'
	if (state === 'connected') return '本机组件已连接，创建配对码后启用'
	if (device === 'mobile') return '连接加速电脑后自动使用'
	if (state === 'launching') return '正在启动本机加速组件'
	if (state === 'connecting') return '正在建立安全本机连接'
	if (state === 'error') return error
	return enabled ? '等待重新连接本机加速组件' : '大文件继续使用网页直传'
}
