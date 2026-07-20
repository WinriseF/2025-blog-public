'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLanInviteQrCode } from './use-lan-invite-qrcode'
import { useLanRecorder } from './use-lan-recorder'
import { useLanTransferEngine } from './use-lan-transfer-engine'
import { detectLanCapability } from '@/lib/lan-transfer/capability'
import { fileFromBlob } from '@/lib/lan-transfer/file-transfer'
import { createNativeWebRtcTransport } from '@/lib/lan-transfer/native-webrtc-transport'
import { ReconnectCoordinator } from '@/lib/lan-transfer/reconnect-coordinator'
import { createLanSession, joinLanSession, LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import { LAN_PROTOCOL_VERSION, type LanAttachmentKind, type LanCapability, type LanPeer, type LanSession, type LanSignalMessage } from '@/lib/lan-transfer/types'
import type { LanNativeAgentAdvertisement, LanNativeAgentTicket } from '@/lib/lan-transfer/native-agent/types'
import type { LanNativeLocalAgentPort } from '@/lib/lan-transfer/native-agent/ports'

type LanTransferControllerOptions = { initialInvite?: { roomId: string; token: string } | null; onLeaveSession?: () => void }

export function useLanTransferController({ initialInvite = null, onLeaveSession }: LanTransferControllerOptions) {
	const recorder = useLanRecorder()
	const [session, setSession] = useState<LanSession | null>(null)
	const [status, setStatus] = useState('创建二维码，让另一台设备扫码')
	const [busy, setBusy] = useState(false)
	const [localCapability, setLocalCapability] = useState<LanCapability | null>(null)
	const coordinatorRef = useRef(new Map<string, ReconnectCoordinator>())
	const knownDevicesRef = useRef(new Map<string, LanPeer>())
	const closedDeviceIdsRef = useRef(new Set<string>())
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const signalingOnlineRef = useRef(false)
	const sessionRef = useRef<LanSession | null>(null)
	const localCapabilityRef = useRef<LanCapability | null>(null)
	const handledInviteRef = useRef<typeof initialInvite>(null)
	const nativeTicketIssuerRef = useRef<((peerDeviceId: string) => Promise<LanNativeAgentTicket>) | null>(null)
	const nativeLocalAgentPortRef = useRef<LanNativeLocalAgentPort | null>(null)

	useEffect(() => void (sessionRef.current = session), [session])
	useEffect(() => void (localCapabilityRef.current = localCapability), [localCapability])

	const inviteLink = useMemo(() => {
		if (!session || session.role !== 'host' || typeof window === 'undefined') return ''
		return `${window.location.origin}/t#mode=lan&room=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token)}`
	}, [session])
	const qrDataUrl = useLanInviteQrCode(inviteLink)

	const engine = useLanTransferEngine({
		sessionRef,
		localCapabilityRef,
		setLocalCapability,
		setStatus,
		issueNativeAgentTicket: peerDeviceId => {
			const issuer = nativeTicketIssuerRef.current
			return issuer ? issuer(peerDeviceId) : Promise.reject(new Error('本机加速组件未连接'))
		},
		getNativeLocalAgentPort: () => nativeLocalAgentPortRef.current,
	})
	const engineRef = useRef(engine)
	useEffect(() => void (engineRef.current = engine), [engine])

	const rememberPeer = useCallback((peer: LanPeer) => {
		const current = knownDevicesRef.current.get(peer.deviceId)
		if (current && current.instanceId !== peer.instanceId && current.joinedAt > peer.joinedAt) return false
		if (current && current.instanceId !== peer.instanceId) signalClientRef.current?.discardPendingForReplacedInstance(peer.deviceId, peer.instanceId)
		knownDevicesRef.current.set(peer.deviceId, peer)
		return true
	}, [])

	const ensureCoordinator = useCallback((peer: LanPeer) => {
		const current = sessionRef.current
		if (!current || peer.deviceId === current.localPeer.deviceId || closedDeviceIdsRef.current.has(peer.deviceId)) return null
		if (current.role === peer.role || !rememberPeer(peer)) return null
		const existing = coordinatorRef.current.get(peer.deviceId)
		if (existing) {
			existing.updatePeer(peer)
			return existing
		}
		engineRef.current.ensureConnection(peer, { connectionState: 'discovered', status: '找到设备，正在连接' })
		const coordinator = new ReconnectCoordinator({
			role: current.role,
			remotePeer: peer,
			createTransport: createNativeWebRtcTransport,
			isTransferActive: () => engineRef.current.isTransferActive(peer.deviceId),
			sendSignal: (type, target, details) => {
				const client = signalClientRef.current
				if (!client) return Promise.reject(new Error('连接服务尚未就绪'))
				return client.sendSignal(type, target, details)
			},
			onState: (remotePeer, connectionState, message, connected) => {
				engineRef.current.ensureConnection(remotePeer, { connected, connectionState, ...(connected ? {} : { connectionRoute: null }), status: message })
				setStatus(message)
			},
			onAttach: (remotePeer, transport, route) => {
				engineRef.current.attachTransport(transport, remotePeer, route)
				setStatus('已连接，可以发送消息和文件')
			},
			onPause: (remotePeer, transportId) => engineRef.current.pauseTransport(remotePeer.deviceId, transportId),
			onResume: (remotePeer, transportId) => engineRef.current.resumeTransport(remotePeer.deviceId, transportId),
			onRoute: (remotePeer, transportId, route) => engineRef.current.updateConnectionRoute(remotePeer.deviceId, transportId, route),
			onDetach: (remotePeer, transportId, connectionState, message) => {
				engineRef.current.detachPeer(remotePeer.deviceId, message, connectionState, transportId || '')
			},
			onData: (remotePeer, transportId, data) => engineRef.current.handlePeerData(remotePeer.deviceId, transportId, data),
		})
		coordinatorRef.current.set(peer.deviceId, coordinator)
		coordinator.setSignalingOnline(signalingOnlineRef.current)
		return coordinator
	}, [rememberPeer])

	const handleSignalMessage = useCallback((message: LanSignalMessage) => {
		const current = sessionRef.current
		if (!current || message.fromDeviceId === current.localPeer.deviceId || closedDeviceIdsRef.current.has(message.fromDeviceId)) return
		const peer = message.peer || knownDevicesRef.current.get(message.fromDeviceId)
		if (!peer) return
		if (message.type === 'peer-left') signalClientRef.current?.discardPendingForDevice(message.fromDeviceId)
		ensureCoordinator(peer)?.handleSignal(message)
	}, [ensureCoordinator])

	const closeCoordinators = useCallback((resetRuntime: boolean) => {
		coordinatorRef.current.forEach(coordinator => coordinator.close())
		coordinatorRef.current.clear()
		knownDevicesRef.current.clear()
		if (resetRuntime) engineRef.current.resetAll()
	}, [])
	const stopSignaling = useCallback(() => {
		const client = signalClientRef.current
		signalClientRef.current = null
		signalingOnlineRef.current = false
		return client?.close().catch(() => {})
	}, [])

	const startSignaling = useCallback(async (next: LanSession) => {
		await stopSignaling()
		const client = new LanSignalingClient(
			next,
			handleSignalMessage,
			realtimeState => {
				const online = realtimeState === 'online'
				signalingOnlineRef.current = online
				coordinatorRef.current.forEach(coordinator => coordinator.setSignalingOnline(online))
				if (online) setStatus(next.role === 'host' ? '二维码已创建，等待扫码' : '正在连接')
				else if (realtimeState !== 'closed') setStatus('连接服务正在恢复')
			},
			error => setStatus(error.message),
			() => coordinatorRef.current.forEach(coordinator => coordinator.wake()),
		)
		signalClientRef.current = client
		await client.ready
	}, [handleSignalMessage, stopSignaling])

	const setSessionNow = (next: LanSession) => {
		sessionRef.current = next
		setSession(next)
	}

	const handleCreateRoom = useCallback(async () => {
		setBusy(true)
		await stopSignaling()
		closeCoordinators(true)
		closedDeviceIdsRef.current.clear()
		setLocalCapability(null)
		localCapabilityRef.current = null
		try {
			const next = await createLanSession()
			setSessionNow(next)
			const capability = await detectLanCapability(next.instanceId)
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			await startSignaling(next)
			return true
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '创建失败')
			return false
		} finally {
			setBusy(false)
		}
	}, [closeCoordinators, startSignaling, stopSignaling])

	const handleJoinRoom = useCallback(async (roomId: string, token: string) => {
		setBusy(true)
		await stopSignaling()
		const current = sessionRef.current
		const sameInvite = Boolean(current && current.role === 'guest' && current.roomId === roomId && current.token === token)
		closedDeviceIdsRef.current.clear()
		closeCoordinators(!sameInvite)
		if (!sameInvite) {
			setLocalCapability(null)
			localCapabilityRef.current = null
		}
		try {
			const next = await joinLanSession(roomId, token)
			setSessionNow(next)
			const capability = localCapabilityRef.current || await detectLanCapability(next.instanceId)
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			await startSignaling(next)
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '连接失败')
		} finally {
			setBusy(false)
		}
	}, [closeCoordinators, startSignaling, stopSignaling])

	useEffect(() => {
		if (!initialInvite?.roomId || !initialInvite.token || handledInviteRef.current === initialInvite) return
		handledInviteRef.current = initialInvite
		void handleJoinRoom(initialInvite.roomId, initialInvite.token)
	}, [handleJoinRoom, initialInvite])

	const stopRecordingAndSend = async () => {
		const result = await recorder.stop()
		if (!result?.blob || result.blob.size === 0) return
		await engine.sendFiles([fileFromBlob(result.blob, `voice-${Date.now()}.webm`, Date.now())], 'voice', result.durationMs)
	}

	const copyInvite = async () => {
		if (!inviteLink) return
		await navigator.clipboard.writeText(inviteLink)
		setStatus('链接已复制')
	}

	const leaveSession = () => {
		void stopSignaling()
		closeCoordinators(true)
		closedDeviceIdsRef.current.clear()
		setSession(null)
		setLocalCapability(null)
		localCapabilityRef.current = null
		onLeaveSession?.()
	}

	const closeConnection = (deviceId = engine.activePeerId) => {
		if (!deviceId) return
		closedDeviceIdsRef.current.add(deviceId)
		const peer = knownDevicesRef.current.get(deviceId)
		if (peer) void signalClientRef.current?.sendPeerLeft({ deviceId, instanceId: peer.instanceId }).catch(() => {})
		signalClientRef.current?.discardPendingForDevice(deviceId)
		coordinatorRef.current.get(deviceId)?.close()
		coordinatorRef.current.delete(deviceId)
		knownDevicesRef.current.delete(deviceId)
		engine.removeConnection(deviceId)
		setStatus(engine.connections.length > 1 ? '已关闭当前会话' : '已关闭会话，等待设备连接')
	}

	const setNativeAgentAdvertisement = useCallback((advertisement: LanNativeAgentAdvertisement | null) => {
		const current = localCapabilityRef.current
		if (!current) return
		if (current.nativeAgent === (advertisement || undefined)) return
		const next = { ...current, nativeAgent: advertisement || undefined }
		localCapabilityRef.current = next
		setLocalCapability(next)
		engineRef.current.updateLocalCapability(next)
	}, [])

	const setNativeTicketIssuer = useCallback((issuer: ((peerDeviceId: string) => Promise<LanNativeAgentTicket>) | null) => {
		nativeTicketIssuerRef.current = issuer
	}, [])

	const setNativeLocalAgentPort = useCallback((port: LanNativeLocalAgentPort | null) => {
		nativeLocalAgentPortRef.current = port
	}, [])

	useEffect(() => () => {
		void stopSignaling()
		coordinatorRef.current.forEach(coordinator => coordinator.close())
		coordinatorRef.current.clear()
	}, [stopSignaling])

	return {
		session,
		connections: engine.connections,
		activePeerId: engine.activePeerId,
		activeConnection: engine.activeConnection,
		activeConnected: Boolean(engine.activeConnection?.connected),
		qrDataUrl,
		inviteLink,
		roomStatus: status,
		busy,
		localCapability,
		recorder,
		handleCreateRoom,
		selectConnection: engine.selectConnection,
		sendText: engine.sendText,
		sendFiles: (files: File[], kind?: LanAttachmentKind) => engine.sendFiles(files, kind),
		selectNativeFiles: engine.selectNativeFiles,
		startReceivingAttachment: engine.startReceivingAttachment,
		stopRecordingAndSend,
		copyInvite,
		setNativeAgentAdvertisement,
		setNativeTicketIssuer,
		setNativeLocalAgentPort,
		requestNativeAgentTicket: engine.requestNativeAgentTicket,
		closeConnection,
		leaveSession,
		downloadAttachment: engine.downloadAttachment,
		version: LAN_PROTOCOL_VERSION,
	}
}

export type LanTransferController = ReturnType<typeof useLanTransferController>
