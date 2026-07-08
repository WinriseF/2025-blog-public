'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { inspectLanConnectionRoute, lanRtcConfig } from './lan-transfer-controller-utils'
import { useLanInviteQrCode } from './use-lan-invite-qrcode'
import { useLanRecorder } from './use-lan-recorder'
import { useLanTransferEngine } from './use-lan-transfer-engine'
import { detectLanCapability } from '@/lib/lan-transfer/capability'
import { fileFromBlob } from '@/lib/lan-transfer/file-transfer'
import { createLanSession, joinLanSession, LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import { LAN_PROTOCOL_VERSION, type LanAttachmentKind, type LanCapability, type LanConnectionState, type LanPeer, type LanSession, type LanSignalMessage } from '@/lib/lan-transfer/types'

type LanTransferControllerOptions = { initialInvite?: { roomId: string; token: string } | null; onLeaveSession?: () => void }

export function useLanTransferController({ initialInvite = null, onLeaveSession }: LanTransferControllerOptions) {
	const recorder = useLanRecorder()
	const [session, setSession] = useState<LanSession | null>(null)
	const [status, setStatus] = useState('创建二维码，让另一台设备扫码')
	const [busy, setBusy] = useState(false)
	const [localCapability, setLocalCapability] = useState<LanCapability | null>(null)

	const peerRef = useRef(new Map<string, SimplePeer.Instance>())
	const knownPeersRef = useRef(new Map<string, LanPeer>())
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const sessionRef = useRef<LanSession | null>(null)
	const localCapabilityRef = useRef<LanCapability | null>(null)

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
	})

	const destroyPeer = useCallback((peerId: string, nextStatus = '连接断了，正在恢复', nextState: LanConnectionState = 'signaling') => {
		const peer = peerRef.current.get(peerId)
		peerRef.current.delete(peerId)
		if (peer) peer.destroy()
		engine.detachPeer(peerId, nextStatus, nextState)
	}, [engine])

	const destroyAllPeers = useCallback((nextStatus = '创建二维码，让另一台设备扫码') => {
		const peers = Array.from(peerRef.current.values())
		peerRef.current.clear()
		for (const peer of peers) peer.destroy()
		knownPeersRef.current.clear()
		engine.resetAll()
		setStatus(nextStatus)
	}, [engine])

	const createPeer = useCallback((initiator: boolean, remotePeer: LanPeer) => {
		const existing = peerRef.current.get(remotePeer.id)
		if (existing) return existing
		knownPeersRef.current.set(remotePeer.id, remotePeer)
		engine.ensureConnection(remotePeer, { connectionState: 'connecting', status: '正在连接' })
		setStatus('找到设备，正在连接')

		const peer = new SimplePeer({ initiator, trickle: true, channelName: 'lan-session-v5', config: lanRtcConfig })
		peer.on('signal', signal => void signalClientRef.current?.sendSignal(remotePeer.id, signal).catch(error => {
			engine.patchConnection(remotePeer.id, { connectionState: 'failed', status: error instanceof Error ? error.message : '连接失败，请重试' })
			setStatus(error instanceof Error ? error.message : '连接失败，请重试')
		}))
		peer.on('connect', () => {
			if (peerRef.current.get(remotePeer.id) !== peer) return
			engine.patchConnection(remotePeer.id, { connected: true, connectionState: 'connected', status: '正在检测连接线路' })
			if (sessionRef.current?.role === 'guest') signalClientRef.current?.stopAnnouncing()
			void inspectLanConnectionRoute(peer).then(route => {
				if (peerRef.current.get(remotePeer.id) !== peer) return
				engine.attachPeer(remotePeer.id, peer, remotePeer, route)
				setStatus('已连接，可以发送消息和文件')
			}).catch(error => {
				if (peerRef.current.get(remotePeer.id) !== peer) return
				peerRef.current.delete(remotePeer.id)
				peer.destroy()
				const message = error instanceof Error ? error.message : '连接失败，请重试'
				engine.detachPeer(remotePeer.id, message, 'failed')
				setStatus(message)
			})
		})
		peer.on('data', data => engine.handlePeerData(remotePeer.id, data))
		peer.on('close', () => {
			if (peerRef.current.get(remotePeer.id) !== peer) return
			peerRef.current.delete(remotePeer.id)
			engine.detachPeer(remotePeer.id, '连接断了，正在恢复', 'signaling')
			setStatus('连接断了，正在恢复')
			signalClientRef.current?.restartAnnouncing()
		})
		peer.on('error', error => {
			if (peerRef.current.get(remotePeer.id) !== peer) return
			peerRef.current.delete(remotePeer.id)
			const message = error instanceof Error ? error.message : '连接失败，正在恢复'
			engine.detachPeer(remotePeer.id, message, 'failed')
			setStatus(message)
			signalClientRef.current?.restartAnnouncing()
		})
		peerRef.current.set(remotePeer.id, peer)
		return peer
	}, [engine])

	const handleSignalMessage = useCallback((message: LanSignalMessage) => {
		const current = sessionRef.current
		if (!current) return
		if (message.peer) {
			knownPeersRef.current.set(message.peer.id, message.peer)
			engine.ensureConnection(message.peer, { connectionState: 'discovered', status: '找到设备，正在连接' })
		}
		const remotePeer = message.peer || knownPeersRef.current.get(message.from)

		if (message.type === 'announce') {
			if (!remotePeer) return
			if (current.role === 'host') {
				if (remotePeer.role !== 'guest') return
				void signalClientRef.current?.sendAnnounce(remotePeer.id).catch(error => setStatus(error instanceof Error ? error.message : '连接失败，请重试'))
				createPeer(true, remotePeer)
				return
			}
			if (remotePeer.role !== 'host') return
			createPeer(false, remotePeer)
			return
		}

		if (message.type === 'signal') {
			if (!remotePeer) return
			try {
				(peerRef.current.get(remotePeer.id) || createPeer(current.role === 'host', remotePeer)).signal(message.signal as SimplePeer.SignalData)
			} catch (error) {
				const text = error instanceof Error ? error.message : '连接失败，请重试'
				engine.patchConnection(remotePeer.id, { connectionState: 'failed', status: text })
				setStatus(text)
			}
			return
		}

		if (message.type === 'peer-left') {
			destroyPeer(message.from, '对方已离开，等待重新连接', 'signaling')
			signalClientRef.current?.restartAnnouncing()
		}
	}, [createPeer, destroyPeer, engine])

	const startSignaling = useCallback(async (next: LanSession) => {
		await signalClientRef.current?.close().catch(() => {})
		const client = new LanSignalingClient(next, handleSignalMessage, realtimeStatus => {
			if (realtimeStatus === 'SUBSCRIBED') setStatus(next.role === 'host' ? '二维码已创建，等待扫码' : '正在连接')
		}, error => {
			setStatus(error.message)
		})
		signalClientRef.current = client
		await client.ready
	}, [handleSignalMessage])

	const setSessionNow = (next: LanSession) => {
		sessionRef.current = next
		setSession(next)
	}

	const handleCreateRoom = useCallback(async () => {
		setBusy(true)
		destroyAllPeers('正在创建二维码')
		setLocalCapability(null)
		localCapabilityRef.current = null
		try {
			const next = await createLanSession()
			setSessionNow(next)
			const capability = await detectLanCapability(next.peerId)
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
	}, [destroyAllPeers, startSignaling])

	const handleJoinRoom = useCallback(async (roomId: string, token: string) => {
		setBusy(true)
		destroyAllPeers('正在连接')
		setLocalCapability(null)
		localCapabilityRef.current = null
		try {
			const next = await joinLanSession(roomId, token)
			setSessionNow(next)
			const capability = await detectLanCapability(next.peerId)
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			await startSignaling(next)
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '连接失败')
		} finally {
			setBusy(false)
		}
	}, [destroyAllPeers, startSignaling])

	useEffect(() => {
		if (!initialInvite?.roomId || !initialInvite.token || sessionRef.current) return
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
		void signalClientRef.current?.close().catch(() => {})
		signalClientRef.current = null
		destroyAllPeers()
		setSession(null)
		setLocalCapability(null)
		localCapabilityRef.current = null
		onLeaveSession?.()
	}

	useEffect(() => () => {
		void signalClientRef.current?.close().catch(() => {})
		const peers = Array.from(peerRef.current.values())
		peerRef.current.clear()
		for (const peer of peers) peer.destroy()
	}, [])

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
		recorder,
		handleCreateRoom,
		selectConnection: engine.selectConnection,
		sendText: engine.sendText,
		sendFiles: (files: File[], kind?: LanAttachmentKind) => engine.sendFiles(files, kind),
		startReceivingAttachment: engine.startReceivingAttachment,
		stopRecordingAndSend,
		copyInvite,
		leaveSession,
		downloadAttachment: engine.downloadAttachment,
		version: LAN_PROTOCOL_VERSION,
	}
}

export type LanTransferController = ReturnType<typeof useLanTransferController>
