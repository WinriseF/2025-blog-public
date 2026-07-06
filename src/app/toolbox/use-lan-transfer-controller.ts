'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { inspectLanConnectionRoute, lanRtcConfig, nowLabel } from './lan-transfer-controller-utils'
import { useLanInviteQrCode } from './use-lan-invite-qrcode'
import { useLanRecorder } from './use-lan-recorder'
import { useLanTransferEngine } from './use-lan-transfer-engine'
import { detectLanCapability } from '@/lib/lan-transfer/capability'
import { createLanSession, joinLanSession, LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import { encodeControl, fileFromBlob } from '@/lib/lan-transfer/file-transfer'
import { LAN_PROTOCOL_VERSION, type LanCapability, type LanConnectionState, type LanControlMessage, type LanPeer, type LanSession, type LanSignalMessage } from '@/lib/lan-transfer/types'

type LanTransferControllerOptions = { initialInvite?: { roomId: string; token: string } | null; onLeaveSession?: () => void }

export function useLanTransferController({ initialInvite = null, onLeaveSession }: LanTransferControllerOptions) {
	const recorder = useLanRecorder()
	const [session, setSession] = useState<LanSession | null>(null)
	const [remotePeer, setRemotePeer] = useState<LanPeer | null>(null)
	const [connected, setConnected] = useState(false)
	const [connectionState, setConnectionState] = useState<LanConnectionState>('idle')
	const [connectionRoute, setConnectionRoute] = useState('')
	const [status, setStatus] = useState('创建二维码后，用另一台设备扫码配对')
	const [busy, setBusy] = useState(false)
	const [activeMobileTab, setActiveMobileTab] = useState<'chats' | 'devices' | 'files'>('chats')
	const [localCapability, setLocalCapability] = useState<LanCapability | null>(null)
	const [remoteCapability, setRemoteCapability] = useState<LanCapability | null>(null)

	const peerRef = useRef<SimplePeer.Instance | null>(null)
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const sessionRef = useRef<LanSession | null>(null)
	const remotePeerRef = useRef<LanPeer | null>(null)
	const remoteCapabilityRef = useRef<LanCapability | null>(null)
	const localCapabilityRef = useRef<LanCapability | null>(null)

	useEffect(() => void (sessionRef.current = session), [session])
	useEffect(() => void (remotePeerRef.current = remotePeer), [remotePeer])
	useEffect(() => void (remoteCapabilityRef.current = remoteCapability), [remoteCapability])
	useEffect(() => void (localCapabilityRef.current = localCapability), [localCapability])

	const inviteLink = useMemo(() => {
		if (!session || session.role !== 'host' || typeof window === 'undefined') return ''
		return `${window.location.origin}/t#mode=lan&room=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token)}`
	}, [session])
	const qrDataUrl = useLanInviteQrCode(inviteLink)

	const sendControl = useCallback((message: LanControlMessage) => {
		const peer = peerRef.current
		if (!peer?.connected) return false
		try {
			peer.send(encodeControl(message))
			return true
		} catch {
			return false
		}
	}, [])

	const engine = useLanTransferEngine({
		connected,
		peerRef,
		sessionRef,
		remotePeerRef,
		remoteCapabilityRef,
		localCapabilityRef,
		setLocalCapability,
		setRemoteCapability,
		setStatus,
	})

	const sendLocalCapability = useCallback(async () => {
		const current = sessionRef.current
		if (!current) return
		const capability = await detectLanCapability(current.peerId)
		localCapabilityRef.current = capability
		setLocalCapability(capability)
		sendControl(capability)
	}, [sendControl])

	const clearPeer = useCallback(() => {
		const peer = peerRef.current
		peerRef.current = null
		if (peer) peer.destroy()
		engine.pauseTransfers()
		setConnected(false)
		setConnectionRoute('')
	}, [engine])

	const createPeer = useCallback((initiator: boolean, remotePeerId: string) => {
		if (peerRef.current) return peerRef.current
		setConnectionState('connecting')
		const peer = new SimplePeer({ initiator, trickle: true, channelName: 'lan-session-v4', config: lanRtcConfig })
		peer.on('signal', signal => void signalClientRef.current?.sendSignal(remotePeerId, signal).catch(error => setStatus(error instanceof Error ? error.message : '连接消息发送失败')))
		peer.on('connect', () => {
			if (peerRef.current !== peer) return
			setConnected(true)
			setConnectionState('connected')
			signalClientRef.current?.stopAnnouncing()
			void inspectLanConnectionRoute(peer).then(route => {
				if (peerRef.current !== peer) return
				setConnectionRoute(route)
				void sendLocalCapability().catch(() => {})
				engine.resumeAfterConnect()
			}).catch(error => {
				peer.destroy()
				peerRef.current = null
				setConnected(false)
				setConnectionState('failed')
				setStatus(error instanceof Error ? error.message : '连接失败，请重新连接')
			})
		})
		peer.on('data', engine.handlePeerData)
		peer.on('close', () => {
			if (peerRef.current !== peer) return
			peerRef.current = null
			engine.pauseTransfers()
			setConnected(false)
			setConnectionState('signaling')
			setConnectionRoute('')
			setStatus('连接已断开，正在等待重连')
			signalClientRef.current?.restartAnnouncing()
		})
		peer.on('error', error => {
			if (peerRef.current !== peer) return
			peerRef.current = null
			engine.pauseTransfers()
			setConnected(false)
			setConnectionState('failed')
			setConnectionRoute('')
			setStatus(error instanceof Error ? error.message : '连接失败，正在等待重连')
			signalClientRef.current?.restartAnnouncing()
		})
		peerRef.current = peer
		return peer
	}, [engine, sendLocalCapability])

	const closeCurrentConnection = useCallback((nextStatus = '创建二维码后，用另一台设备扫码配对', nextState: LanConnectionState = 'idle') => {
		clearPeer()
		setRemotePeer(null)
		setRemoteCapability(null)
		setConnectionState(nextState)
		setStatus(nextStatus)
	}, [clearPeer])

	const handleSignalMessage = useCallback((message: LanSignalMessage) => {
		const current = sessionRef.current
		if (!current) return
		const knownRemote = remotePeerRef.current
		if (knownRemote && knownRemote.id !== message.from && message.type !== 'announce') return
		if (message.peer) {
			remotePeerRef.current = message.peer
			setRemotePeer(message.peer)
		}
		if (message.type === 'announce') {
			const activePeer = peerRef.current
			if (activePeer?.connected && remotePeerRef.current?.id === message.from) return
			setConnectionState(activePeer ? 'connecting' : 'discovered')
			setStatus('已发现对方设备，正在连接...')
			if (current.role === 'host') {
				void signalClientRef.current?.sendAnnounce(message.from).catch(error => setStatus(error instanceof Error ? error.message : '连接消息发送失败'))
				createPeer(true, message.from)
			} else {
				createPeer(false, message.from)
			}
			return
		}
		if (message.type === 'signal') return void (peerRef.current || createPeer(current.role === 'host', message.from)).signal(message.signal as SimplePeer.SignalData)
		if (message.type === 'peer-left') {
			clearPeer()
			setConnectionState('signaling')
			setStatus('对方设备已离开，等待重新连接')
			signalClientRef.current?.restartAnnouncing()
		}
	}, [clearPeer, createPeer])

	const startSignaling = useCallback(async (next: LanSession) => {
		await signalClientRef.current?.close().catch(() => {})
		setConnectionState('signaling')
		const client = new LanSignalingClient(next, handleSignalMessage, realtimeStatus => {
			if (realtimeStatus === 'SUBSCRIBED') setStatus(next.role === 'host' ? '二维码已创建，等待另一台设备扫码' : '已加入，正在连接')
		}, error => {
			setConnectionState('failed')
			setStatus(error.message)
		})
		signalClientRef.current = client
		await client.ready
	}, [handleSignalMessage])

	const setSessionNow = (next: LanSession) => {
		sessionRef.current = next
		setSession(next)
	}

	const handleCreateRoom = async () => {
		setBusy(true)
		closeCurrentConnection('正在创建二维码...', 'signaling')
		try {
			const next = await createLanSession()
			setSessionNow(next)
			const capability = await detectLanCapability(next.peerId)
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			await startSignaling(next)
			engine.addSystemMessage('LAN Session V4 已创建，旧版本连接将不会兼容')
		} catch (error) {
			setConnectionState('failed')
			setStatus(error instanceof Error ? error.message : '创建连接失败')
		} finally {
			setBusy(false)
		}
	}

	const handleJoinRoom = useCallback(async (roomId: string, token: string) => {
		setBusy(true)
		closeCurrentConnection('正在加入...', 'signaling')
		try {
			const next = await joinLanSession(roomId, token)
			setSessionNow(next)
			const capability = await detectLanCapability(next.peerId)
			localCapabilityRef.current = capability
			setLocalCapability(capability)
			await startSignaling(next)
		} catch (error) {
			setConnectionState('failed')
			setStatus(error instanceof Error ? error.message : '加入连接失败')
		} finally {
			setBusy(false)
		}
	}, [closeCurrentConnection, startSignaling])

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
		setStatus('连接链接已复制')
	}

	const leaveSession = () => {
		void signalClientRef.current?.close().catch(() => {})
		signalClientRef.current = null
		closeCurrentConnection()
		setSession(null)
		setRemotePeer(null)
		onLeaveSession?.()
	}

	useEffect(() => () => {
		void signalClientRef.current?.close().catch(() => {})
		peerRef.current?.destroy()
	}, [])

	return {
		session,
		remotePeer,
		connected,
		connectionState,
		connectionRoute,
		qrDataUrl,
		inviteLink,
		messages: engine.messages,
		fileRecords: engine.fileRecords,
		status,
		busy,
		localCapability,
		remoteCapability,
		activeMobileTab,
		recorder,
		nowLabel,
		setActiveMobileTab,
		handleCreateRoom,
		sendText: engine.sendText,
		sendFiles: engine.sendFiles,
		startReceivingAttachment: engine.startReceivingAttachment,
		stopRecordingAndSend,
		copyInvite,
		leaveSession,
		clearFileRecord: engine.clearFileRecord,
		downloadAttachment: engine.downloadAttachment,
		version: LAN_PROTOCOL_VERSION,
	}
}

export type LanTransferController = ReturnType<typeof useLanTransferController>
