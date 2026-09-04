'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLanInviteQrCode } from './use-lan-invite-qrcode'
import { useLanRecorder } from './use-lan-recorder'
import { useLanTransferEngine } from './use-lan-transfer-engine'
import { detectLanCapability } from '@/lib/lan-transfer/capability'
import { fileFromBlob } from '@/lib/lan-transfer/file-transfer'
import { createNativeWebRtcTransport } from '@/lib/lan-transfer/native-webrtc-transport'
import { PeerConnectionManager } from '@/lib/lan-transfer/peer-connection-manager'
import { createLanSession, forgetLanRoom, inviteSecretFromHash, joinLanSession, lanInviteLink, restoreLanSession } from '@/lib/lan-transfer/session-store'
import { LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import { cleanupLanRoomPersistentStorage, cleanupLanTransferPersistentStorage } from '@/lib/lan-transfer/storage/persistent-cleanup'
import { LAN_PROTOCOL_VERSION, type LanAttachmentKind, type LanCapability, type LanPeer, type LanSession, type LanSignalMessage } from '@/lib/lan-transfer/types'
import type { LanNativeAgentAdvertisement, LanNativeAgentTicket } from '@/lib/lan-transfer/native-agent/types'
import type { LanNativeLocalAgentPort } from '@/lib/lan-transfer/native-agent/ports'

type LanTransferControllerOptions = { initialRoomId?: string | null; onLeaveSession?: () => void }

function newerPeer(current: LanPeer | undefined, candidate: LanPeer) {
	if (!current || candidate.startedAt !== current.startedAt) return !current || candidate.startedAt > current.startedAt
	return candidate.instanceId > current.instanceId
}

export function useLanTransferController({ initialRoomId = null, onLeaveSession }: LanTransferControllerOptions) {
	const recorder = useLanRecorder()
	const [session, setSession] = useState<LanSession | null>(null)
	const [status, setStatus] = useState(initialRoomId ? '正在恢复房间' : '创建二维码，让另一台设备扫码')
	const [busy, setBusy] = useState(Boolean(initialRoomId))
	const [localCapability, setLocalCapability] = useState<LanCapability | null>(null)
	const managersRef = useRef(new Map<string, PeerConnectionManager>())
	const earlySignalsRef = useRef(new Map<string, LanSignalMessage[]>())
	const closedDeviceIdsRef = useRef(new Set<string>())
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const signalingOnlineRef = useRef(false)
	const sessionRef = useRef<LanSession | null>(null)
	const localCapabilityRef = useRef<LanCapability | null>(null)
	const nativeTicketIssuerRef = useRef<((peerDeviceId: string) => Promise<LanNativeAgentTicket>) | null>(null)
	const nativeLocalAgentPortRef = useRef<LanNativeLocalAgentPort | null>(null)

	useEffect(() => void (sessionRef.current = session), [session])
	useEffect(() => void (localCapabilityRef.current = localCapability), [localCapability])

	const inviteLink = useMemo(() => {
		if (!session || session.role !== 'host' || typeof window === 'undefined') return ''
		return lanInviteLink(session, window.location.origin)
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

	const ensureManager = useCallback((peer: LanPeer) => {
		const current = sessionRef.current
		if (!current || peer.deviceId === current.localPeer.deviceId || current.role === peer.role || closedDeviceIdsRef.current.has(peer.deviceId)) return null
		const existing = managersRef.current.get(peer.deviceId)
		if (existing) {
			existing.updatePeer(peer)
			return existing
		}
		engineRef.current.ensureConnection(peer, { connectionState: 'connecting', status: '找到设备，正在连接' })
		const manager = new PeerConnectionManager({
			localDeviceId: current.localPeer.deviceId,
			remotePeer: peer,
			createTransport: createNativeWebRtcTransport,
			sendSignal: (type, target, details) => {
				const client = signalClientRef.current
				return client ? client.sendSignal(type, target, details) : Promise.reject(new Error('连接服务尚未就绪'))
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
			onDetach: (remotePeer, transportId, connectionState, message) => engineRef.current.detachPeer(remotePeer.deviceId, message, connectionState, transportId || ''),
			onData: (remotePeer, transportId, data) => engineRef.current.handlePeerData(remotePeer.deviceId, transportId, data),
		})
		managersRef.current.set(peer.deviceId, manager)
		manager.setSignalingOnline(signalingOnlineRef.current)
		const queued = earlySignalsRef.current.get(peer.deviceId) || []
		earlySignalsRef.current.delete(peer.deviceId)
		for (const message of queued) manager.handleSignal(message)
		return manager
	}, [])

	const handleSignalMessage = useCallback((message: LanSignalMessage) => {
		const current = sessionRef.current
		if (!current || message.fromDeviceId === current.localPeer.deviceId || closedDeviceIdsRef.current.has(message.fromDeviceId)) return
		const manager = managersRef.current.get(message.fromDeviceId)
		if (manager) return manager.handleSignal(message)
		const messages = earlySignalsRef.current.get(message.fromDeviceId) || []
		messages.push(message)
		earlySignalsRef.current.set(message.fromDeviceId, messages.slice(-64))
	}, [])

	const handlePresence = useCallback((peers: LanPeer[]) => {
		const current = sessionRef.current
		if (!current) return
		const localReplacement = peers.filter(peer => peer.deviceId === current.localPeer.deviceId).sort((a, b) => b.startedAt - a.startedAt || b.instanceId.localeCompare(a.instanceId))[0]
		if (localReplacement && newerPeer(current.localPeer, localReplacement)) {
			setStatus('此房间已在新页面接管')
			managersRef.current.forEach(manager => manager.close())
			managersRef.current.clear()
			void signalClientRef.current?.close()
			return
		}

		const latest = new Map<string, LanPeer>()
		for (const peer of peers) {
			if (peer.deviceId === current.localPeer.deviceId || peer.role === current.role) continue
			if (newerPeer(latest.get(peer.deviceId), peer)) latest.set(peer.deviceId, peer)
		}
		for (const [deviceId, manager] of managersRef.current) {
			const peer = latest.get(deviceId)
			if (peer) {
				manager.updatePeer(peer)
				manager.setPeerPresent(peer, true)
			} else manager.setPeerPresent(manager.remotePeer, false)
		}
		for (const peer of latest.values()) if (!managersRef.current.has(peer.deviceId)) ensureManager(peer)?.setPeerPresent(peer, true)
	}, [ensureManager])

	const closeManagers = useCallback((resetRuntime: boolean, cleanupPersistent = false) => {
		managersRef.current.forEach(manager => manager.close())
		managersRef.current.clear()
		earlySignalsRef.current.clear()
		if (resetRuntime) engineRef.current.resetAll(cleanupPersistent)
	}, [])

	const stopSignaling = useCallback(() => {
		const client = signalClientRef.current
		signalClientRef.current = null
		signalingOnlineRef.current = false
		return client?.close().catch(() => {})
	}, [])

	const detectCapabilityInBackground = useCallback((next: LanSession) => {
		void detectLanCapability(next.localPeer.deviceId).then(capability => {
			if (sessionRef.current?.instanceId !== next.instanceId) return
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			engineRef.current.updateLocalCapability(capability)
		}).catch(() => {})
	}, [])

	const startSignaling = useCallback((next: LanSession) => {
		void stopSignaling()
		const client = new LanSignalingClient(
			next,
			message => {
				if (sessionRef.current?.instanceId === next.instanceId) handleSignalMessage(message)
			},
			realtimeState => {
				if (sessionRef.current?.instanceId !== next.instanceId) return
				const online = realtimeState === 'online'
				signalingOnlineRef.current = online
				managersRef.current.forEach(manager => manager.setSignalingOnline(online))
				if (online && !managersRef.current.size) setStatus(next.role === 'host' ? '房间已恢复，等待设备连接' : '房间已恢复，正在查找设备')
				else if (!online && realtimeState !== 'closed') setStatus('连接服务正在恢复')
			},
			error => {
				if (sessionRef.current?.instanceId === next.instanceId) setStatus(error.message)
			},
			() => {
				if (sessionRef.current?.instanceId === next.instanceId) managersRef.current.forEach(manager => manager.wake())
			},
			peers => {
				if (sessionRef.current?.instanceId === next.instanceId) handlePresence(peers)
			},
		)
		signalClientRef.current = client
		void client.ready.catch(() => {})
	}, [handlePresence, handleSignalMessage, stopSignaling])

	const activateSession = useCallback((next: LanSession) => {
		sessionRef.current = next
		setSession(next)
		setLocalCapability(null)
		localCapabilityRef.current = null
		closedDeviceIdsRef.current.clear()
		startSignaling(next)
		detectCapabilityInBackground(next)
		void cleanupLanTransferPersistentStorage({ activeRoomId: next.roomId })
	}, [detectCapabilityInBackground, startSignaling])

	const handleCreateRoom = useCallback(async () => {
		setBusy(true)
		await stopSignaling()
		closeManagers(true, true)
		try {
			const next = await createLanSession()
			if (typeof window !== 'undefined') window.history.replaceState(null, '', `/t/lan/${encodeURIComponent(next.roomId)}`)
			activateSession(next)
			return true
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '创建失败')
			return false
		} finally {
			setBusy(false)
		}
	}, [activateSession, closeManagers, stopSignaling])

	useEffect(() => {
		if (!initialRoomId) return
		let cancelled = false
		void (async () => {
			try {
				const secret = typeof window === 'undefined' ? '' : inviteSecretFromHash(window.location.hash)
				const next = secret ? await joinLanSession(initialRoomId, secret) : await restoreLanSession(initialRoomId)
				if (cancelled) return
				if (!next) {
					setStatus('此设备没有该房间的邀请密钥，请重新打开完整邀请链接')
					return
				}
				if (secret) window.history.replaceState(null, '', `/t/lan/${encodeURIComponent(initialRoomId)}`)
				activateSession(next)
			} catch (error) {
				if (!cancelled) setStatus(error instanceof Error ? error.message : '房间恢复失败')
			} finally {
				if (!cancelled) setBusy(false)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [activateSession, initialRoomId])

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
		const current = sessionRef.current
		void stopSignaling()
		closeManagers(true, true)
		if (current) {
			forgetLanRoom(current.roomId)
			void cleanupLanRoomPersistentStorage(current.roomId, current.localPeer.deviceId)
		}
		sessionRef.current = null
		setSession(null)
		setLocalCapability(null)
		localCapabilityRef.current = null
		onLeaveSession?.()
	}

	const closeConnection = (deviceId = engine.activePeerId) => {
		if (!deviceId) return
		closedDeviceIdsRef.current.add(deviceId)
		managersRef.current.get(deviceId)?.close()
		managersRef.current.delete(deviceId)
		engine.removeConnection(deviceId)
		setStatus(engine.connections.length > 1 ? '已关闭当前会话' : '已关闭会话，等待设备连接')
	}

	const retryConnection = (deviceId = engine.activePeerId) => {
		if (!deviceId) return
		managersRef.current.get(deviceId)?.retry()
	}

	const setNativeAgentAdvertisement = useCallback((advertisement: LanNativeAgentAdvertisement | null) => {
		const current = localCapabilityRef.current
		if (!current || current.nativeAgent === (advertisement || undefined)) return
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
		managersRef.current.forEach(manager => manager.close())
		managersRef.current.clear()
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
		runWebRtcBenchmark: engine.runWebRtcBenchmark,
		reserveBenchmark: engine.reserveBenchmark,
		retryConnection,
		closeConnection,
		leaveSession,
		downloadAttachment: engine.downloadAttachment,
		version: LAN_PROTOCOL_VERSION,
	}
}

export type LanTransferController = ReturnType<typeof useLanTransferController>
