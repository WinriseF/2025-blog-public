'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectLanNativeAgentCapability, type LanNativeAgentCapability } from '@/lib/lan-transfer/native-agent/capability'
import { createLanAgentLaunchRequest, launchLanNativeAgent, subscribeLanAgentCallbacks } from '@/lib/lan-transfer/native-agent/launch-client'
import { LanNativeLocalBridge } from '@/lib/lan-transfer/native-agent/local-bridge'
import type { LanNativeLocalAgentPort } from '@/lib/lan-transfer/native-agent/ports'
import { nativeAgentLnaTicketCount, runLanNativeHttpBenchmark, selectLocalNetworkAccessEndpoint } from '@/lib/lan-transfer/native-agent/peer-lna-http'
import { runLanNativeBenchmark } from '@/lib/lan-transfer/native-agent/peer-webtransport'
import { endpointAddressKind, validLanWebTransportEndpoint } from '@/lib/lan-transfer/native-agent/endpoint-validation'
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
	const launchNonceRef = useRef('')
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
		if (next.nonce !== launchNonceRef.current || next.nonce === handledNonceRef.current) return
		handledNonceRef.current = next.nonce
		const attempt = (connectionAttemptRef.current += 1)
		if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
		launchTimerRef.current = null
		setAgentState('connecting')
		setAgentError('')
		try {
			const bridge = await LanNativeLocalBridge.connect(next)
			if (attempt !== connectionAttemptRef.current) {
				bridge.close()
				return
			}
			bridgeRef.current?.close()
			bridgeRef.current = bridge
			endpointSubscriptionRef.current?.()
			endpointSubscriptionRef.current = bridge.subscribeNetworkEndpoints(snapshot => setCallback(current => current ? {
				...current,
				networkEpoch: snapshot.networkEpoch,
				benchmarkEndpoints: snapshot.benchmarkEndpoints,
				lnaHttpEndpoints: snapshot.lnaHttpEndpoints,
				fileHttpEndpoints: snapshot.fileHttpEndpoints,
				fileWebTransportEndpoints: snapshot.fileWebTransportEndpoints,
			} : current))
			setCallback({ ...bridge.callback })
			setAgentState('connected')
		} catch (error) {
			if (attempt !== connectionAttemptRef.current) return
			if (bridgeRef.current) {
				setAgentState('connected')
				return
			}
			setAgentState('error')
			setAgentError(error instanceof Error ? error.message : '无法连接本机加速组件')
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
		if (!capability.canHostAgent) return
		autoLaunchAttemptedRef.current = true
		const request = createLanAgentLaunchRequest()
		connectionAttemptRef.current += 1
		handledNonceRef.current = ''
		launchNonceRef.current = request.nonce
		setAgentState('launching')
		setAgentError('')
		launchLanNativeAgent(request.uri)
		if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
		launchTimerRef.current = setTimeout(() => {
			launchTimerRef.current = null
			setAgentState(current => (current === 'launching' ? 'error' : current))
			setAgentError('没有收到本机组件回调，请先注册或启动 WinriseF Agent')
		}, 12_000)
	}, [capability.canHostAgent])

	useEffect(() => {
		if (!ready || !preferenceEnabled || !capability.canHostAgent || autoLaunchAttemptedRef.current) return
		launch()
	}, [capability.canHostAgent, launch, preferenceEnabled, ready])

	const setEnabled = useCallback(
		(value: boolean) => {
			setPreferenceEnabled(value)
			try {
				localStorage.setItem(SPEED_MODE_PREFERENCE_KEY, String(value))
			} catch {}
			if (value) launch()
			else {
				if (launchTimerRef.current) clearTimeout(launchTimerRef.current)
				launchTimerRef.current = null
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
			networkEpoch: callback.networkEpoch
		}
	}, [agentState, callback, ownerDeviceId])

	const localWins = Boolean(localAdvertisement && advertisedByPeer && localAdvertisement.ownerDeviceId < advertisedByPeer.ownerDeviceId)
	const remoteAdvertisement = localAdvertisement && localWins ? null : advertisedByPeer

	useEffect(() => {
		if (!localAdvertisement || !advertisedByPeer || localWins) return
		closeBridge()
		setAgentState('error')
		setAgentError('本次会话已由另一台电脑提供极速模式')
	}, [advertisedByPeer, closeBridge, localAdvertisement, localWins])

	useEffect(() => setBenchmark({ state: 'idle' }), [remoteAdvertisement?.ownerDeviceId])

	const issuePeerTicket = useCallback(
		(peerDeviceId: string) => {
			const bridge = bridgeRef.current
			if (!bridge || !ownerDeviceId || peerDeviceId === ownerDeviceId) return Promise.reject(new Error('本机加速组件未连接'))
			return bridge.issueTicket(ownerDeviceId)
		},
		[ownerDeviceId]
	)

	const runBenchmark = useCallback(
		async (direction: LanNativeBenchmarkDirection, totalBytes: number, requestTicket: () => Promise<LanNativeAgentTicket>) => {
			if (!remoteAdvertisement) return void setBenchmark({ state: 'error', error: '当前连接没有可用的加速电脑' })
			const sessionCount = NATIVE_AGENT_SESSION_COUNT
			setBenchmark({ state: 'running', progress: { direction, transport: 'lna-http', sessionCount, bytes: 0, totalBytes, startedAt: performance.now() } })
			try {
				const lna = await selectLocalNetworkAccessEndpoint(remoteAdvertisement.lnaHttpEndpoints)
				const webTransportEndpoints = remoteAdvertisement.endpoints.filter(validLanWebTransportEndpoint)
				const publicIpv6Available = webTransportEndpoints.some(endpoint => endpointAddressKind(endpoint) === 'gua-ipv6')
				const canUseWebTransport = capability.webTransport && webTransportEndpoints.length > 0 && (lna.state !== 'denied' || publicIpv6Available)
				const ticketCount = lna.state === 'available' ? nativeAgentLnaTicketCount(totalBytes) : sessionCount
				if (lna.state !== 'available' && !canUseWebTransport)
					throw new Error(lna.state === 'denied' ? '你已拒绝本地网络访问权限，且加速电脑没有可用的公网 IPv6 WebTransport 地址' : lna.state === 'unavailable' ? lna.reason : '当前浏览器既不支持本地网络访问，也不支持 WebTransport')
				const tickets = await Promise.all(Array.from({ length: ticketCount }, () => requestTicket()))
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
			} catch (error) {
				setBenchmark({ state: 'error', error: error instanceof Error ? error.message : '极速模式测速失败' })
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
	if (local) return '本机组件已连接，等待网页设备使用'
	if (remote) return '已发现加速电脑，大文件将自动加速'
	if (state === 'connected') return '本机组件已连接，创建配对码后启用'
	if (device === 'mobile') return '连接加速电脑后自动使用'
	if (state === 'launching') return '正在启动本机加速组件'
	if (state === 'connecting') return '正在建立安全本机连接'
	if (state === 'error') return error
	return enabled ? '等待重新连接本机加速组件' : '大文件继续使用网页直传'
}
