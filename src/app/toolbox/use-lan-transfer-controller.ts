'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { toast } from 'sonner'
import { lanRtcConfig, totalSelectedSize } from './lan-transfer-controller-utils'
import { useLanInviteQrCode } from './use-lan-invite-qrcode'
import { useLanReceivedFiles } from './use-lan-received-files'
import { createLanSession, joinLanSession, LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import { assertCanReceiveFile, detectLanCapability, selectStorageForFile } from '@/lib/lan-transfer/capability'
import { decodeFrame, downloadUrl, encodeControl, formatBytes, prepareLanFiles, sendPreparedFile } from '@/lib/lan-transfer/file-transfer'
import { createStorageEngine, chooseStorageKind } from '@/lib/lan-transfer/storage/storage-manager'
import type { LanStorageEngine, TransferFileMeta } from '@/lib/lan-transfer/storage/types'
import {
	LAN_LIMITS,
	LAN_PROTOCOL_VERSION,
	type LanCapability,
	type LanConnectionState,
	type LanControlMessage,
	type LanPeer,
	type LanProgressState,
	type LanSession,
	type LanSignalMessage,
	type LanTransferRequest,
	type PreparedLanFile,
	type ReceivedLanFile,
} from '@/lib/lan-transfer/types'

type LanTransferControllerOptions = { initialInvite?: { roomId: string; token: string } | null; onLeaveSession?: () => void }
type IncomingTransfer = { request: LanTransferRequest; meta: TransferFileMeta; engine: LanStorageEngine; received: number; chunkCount: number }
type SimplePeerWithConnection = SimplePeer.Instance & { _pc?: RTCPeerConnection }
type CandidatePairStats = RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; selected?: boolean; state?: string }

function getStatsCandidateType(stats: RTCStatsReport, candidateId: string | undefined) {
	if (!candidateId) return ''
	const candidate = stats.get(candidateId) as (RTCStats & { candidateType?: string }) | undefined
	return typeof candidate?.candidateType === 'string' ? candidate.candidateType : ''
}

function getSelectedCandidatePair(stats: RTCStatsReport): CandidatePairStats | null {
	let selectedPair: CandidatePairStats | null = null
	stats.forEach(report => {
		if (selectedPair || report.type !== 'candidate-pair') return
		const candidatePair = report as CandidatePairStats
		if (candidatePair.selected || (candidatePair.nominated && candidatePair.state === 'succeeded')) selectedPair = candidatePair
	})
	return selectedPair
}

async function inspectLanConnectionRoute(peer: SimplePeer.Instance) {
	const connection = (peer as SimplePeerWithConnection)._pc
	if (!connection?.getStats) return '已连接'
	await new Promise(resolve => setTimeout(resolve, 250))
	const stats = await connection.getStats()
	const selectedPair = getSelectedCandidatePair(stats)
	if (!selectedPair) return '已连接'
	const localType = getStatsCandidateType(stats, selectedPair.localCandidateId)
	const remoteType = getStatsCandidateType(stats, selectedPair.remoteCandidateId)
	if (localType === 'relay' || remoteType === 'relay') throw new Error('连接不可用，请重新连接')
	return '已连接'
}

export function useLanTransferController({ initialInvite = null, onLeaveSession }: LanTransferControllerOptions) {
	const [session, setSession] = useState<LanSession | null>(null)
	const [remotePeer, setRemotePeer] = useState<LanPeer | null>(null)
	const [connected, setConnected] = useState(false)
	const [connectionState, setConnectionState] = useState<LanConnectionState>('idle')
	const [connectionRoute, setConnectionRoute] = useState('')
	const [selectedFiles, setSelectedFiles] = useState<File[]>([])
	const [incomingRequest, setIncomingRequest] = useState<LanTransferRequest | null>(null)
	const [outgoing, setOutgoing] = useState<LanProgressState | null>(null)
	const [incoming, setIncoming] = useState<LanProgressState | null>(null)
	const [localCapability, setLocalCapability] = useState<LanCapability | null>(null)
	const [remoteCapability, setRemoteCapability] = useState<LanCapability | null>(null)
	const [status, setStatus] = useState('创建二维码后，用另一台设备扫码配对')
	const [busy, setBusy] = useState(false)
	const [transferBusy, setTransferBusy] = useState(false)

	const peerRef = useRef<SimplePeer.Instance | null>(null)
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const sessionRef = useRef<LanSession | null>(null)
	const remotePeerRef = useRef<LanPeer | null>(null)
	const localCapabilityRef = useRef<LanCapability | null>(null)
	const remoteCapabilityRef = useRef<LanCapability | null>(null)
	const incomingRequestRef = useRef<LanTransferRequest | null>(null)
	const outgoingFileRef = useRef<PreparedLanFile | null>(null)
	const incomingFileRef = useRef<IncomingTransfer | null>(null)
	const transferBusyRef = useRef(false)
	const ackTimerRef = useRef<number | null>(null)
	const outgoingAckedBytesRef = useRef(0)
	const incomingProgressAckRef = useRef({ id: '', bytes: 0, at: 0 })
	const chunkWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
	const { receivedFiles, addReceivedFile, clearReceivedFile } = useLanReceivedFiles()

	useEffect(() => void (sessionRef.current = session), [session])
	useEffect(() => void (remotePeerRef.current = remotePeer), [remotePeer])
	useEffect(() => void (localCapabilityRef.current = localCapability), [localCapability])
	useEffect(() => void (remoteCapabilityRef.current = remoteCapability), [remoteCapability])
	useEffect(() => void (incomingRequestRef.current = incomingRequest), [incomingRequest])
	useEffect(() => void (transferBusyRef.current = transferBusy), [transferBusy])

	const inviteLink = useMemo(() => {
		if (!session || session.role !== 'host' || typeof window === 'undefined') return ''
		return `${window.location.origin}/t#mode=lan&room=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token)}`
	}, [session])
	const qrDataUrl = useLanInviteQrCode(inviteLink)

	const clearAckTimer = useCallback(() => {
		if (ackTimerRef.current !== null) window.clearTimeout(ackTimerRef.current)
		ackTimerRef.current = null
	}, [])

	const cleanupIncomingStorage = useCallback((current: IncomingTransfer | null) => {
		if (!current) return
		void chunkWriteQueueRef.current
			.catch(() => {})
			.then(() => current.engine.cleanup(current.meta.id))
			.catch(() => {})
	}, [])

	const resetTransferState = useCallback(
		(nextStatus?: string) => {
			clearAckTimer()
			cleanupIncomingStorage(incomingFileRef.current)
			incomingFileRef.current = null
			incomingRequestRef.current = null
			outgoingFileRef.current = null
			chunkWriteQueueRef.current = Promise.resolve()
			outgoingAckedBytesRef.current = 0
			incomingProgressAckRef.current = { id: '', bytes: 0, at: 0 }
			transferBusyRef.current = false
			setIncomingRequest(null)
			setIncoming(null)
			setOutgoing(null)
			setTransferBusy(false)
			if (nextStatus) setStatus(nextStatus)
		},
		[clearAckTimer, cleanupIncomingStorage],
	)

	const cleanupPeer = useCallback(() => {
		const peer = peerRef.current
		peerRef.current = null
		if (peer) peer.destroy()
		setConnected(false)
		setConnectionRoute('')
	}, [])

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

	const sendLocalCapability = useCallback(async () => {
		const current = sessionRef.current
		if (!current) return
		const capability = await detectLanCapability(current.peerId)
		localCapabilityRef.current = capability
		setLocalCapability(capability)
		sendControl(capability)
	}, [sendControl])

	const failTransfer = useCallback(
		(reason: string) => {
			sendControl({ type: 'transfer-cancel', id: incomingFileRef.current?.request.id || outgoingFileRef.current?.id || 'unknown', reason })
			resetTransferState(reason)
		},
		[resetTransferState, sendControl],
	)

	const startAckTimer = useCallback(
		(file: PreparedLanFile) => {
			clearAckTimer()
			ackTimerRef.current = window.setTimeout(() => {
				if (outgoingFileRef.current?.id !== file.id) return
				outgoingFileRef.current = null
				transferBusyRef.current = false
				setTransferBusy(false)
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '等待确认超时', stage: '等待确认' })
				setStatus('文件已经发出，但对方没有返回接收确认，请确认对方页面仍在前台，必要时重新发送')
			}, LAN_LIMITS.receiveAckTimeoutMs)
		},
		[clearAckTimer],
	)

	const finishIncomingTransfer = useCallback(
		async (messageId: string, sent?: number, chunkCount?: number) => {
			const current = incomingFileRef.current
			if (!current || current.request.id !== messageId) return
			setIncoming({ id: current.request.id, name: current.request.name, size: current.request.size, done: current.received, label: '正在处理', stage: '处理' })
			await chunkWriteQueueRef.current
			const manifest = await current.engine.getManifest(current.meta.id)
			if (!manifest) return failTransfer('接收失败，请重新发送')
			if (typeof sent === 'number' && sent !== current.request.size) return failTransfer(`发送端声明大小异常：${formatBytes(sent)} / ${formatBytes(current.request.size)}`)
			if (typeof chunkCount === 'number' && chunkCount !== manifest.receivedChunks) return failTransfer(`分片数量异常：${manifest.receivedChunks} / ${chunkCount}`)
			if (manifest.receivedBytes !== current.request.size || manifest.receivedChunks !== current.request.chunkCount)
				return failTransfer(`接收不完整：${formatBytes(manifest.receivedBytes)} / ${formatBytes(current.request.size)}`)
			setStatus('正在准备下载...')
			const finalized = await current.engine.finalize(current.meta)
			const received: ReceivedLanFile = {
				id: messageId,
				name: current.request.name,
				mime: current.request.mime,
				size: current.request.size,
				url: finalized.url,
				storage: current.engine.kind,
				receivedAt: Date.now(),
				cacheStatus: 'retained',
			}
			addReceivedFile(received, current.engine, current.meta.id)
			if (received.url) downloadUrl(received.name, received.url)
			setIncoming({ id: received.id, name: received.name, size: received.size, done: received.size, label: finalized.directSave ? '已直接保存' : '接收完成', stage: '完成' })
			setTransferBusy(false)
			setStatus(finalized.directSave ? '接收完成，文件已保存' : '接收完成，已准备下载')
			sendControl({ type: 'transfer-received', id: messageId, received: received.size, expected: received.size, chunkCount: manifest.receivedChunks, storage: current.engine.kind })
			incomingFileRef.current = null
			transferBusyRef.current = false
		},
		[addReceivedFile, failTransfer, sendControl],
	)

	const handleControl = useCallback(
		async (message: LanControlMessage) => {
			if (message.type === 'capability') {
				setRemoteCapability(message)
				remoteCapabilityRef.current = message
				setStatus('已连接，可以发送文件')
				return
			}
			if (message.type === 'transfer-request') {
				if (message.protocolVersion !== LAN_PROTOCOL_VERSION) return void sendControl({ type: 'transfer-reject', id: message.id, reason: '双方页面版本不一致，请刷新后重试' })
				if (transferBusyRef.current || incomingRequestRef.current) return void sendControl({ type: 'transfer-reject', id: message.id, reason: '当前有传输正在进行' })
				const capability = localCapabilityRef.current || (sessionRef.current ? await detectLanCapability(sessionRef.current.peerId, message.size) : null)
				if (capability) {
					localCapabilityRef.current = capability
					setLocalCapability(capability)
				}
				try {
					if (capability) assertCanReceiveFile(message.size, capability)
				} catch (error) {
					sendControl({ type: 'transfer-reject', id: message.id, reason: error instanceof Error ? error.message : '当前设备不能接收该文件' })
					return
				}
				setIncomingRequest(message)
				setStatus(`${remotePeerRef.current?.name || '对方设备'} 想发送 ${message.fileCount} 个文件，大小 ${formatBytes(message.size)}`)
				return
			}
			if (message.type === 'transfer-accept') {
				const file = outgoingFileRef.current
				const peer = peerRef.current
				if (!file || !peer || file.id !== message.id) return
				setStatus('对方已接收，正在发送...')
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: 0, label: '正在发送', stage: '传输' })
				try {
					outgoingAckedBytesRef.current = 0
					await sendPreparedFile(
						peer,
						file,
						(done) => setOutgoing({ id: file.id, name: file.name, size: file.size, done, label: `正在发送 · 对方已收到 ${formatBytes(outgoingAckedBytesRef.current)}`, stage: '传输' }),
						{
							mobile: remoteCapabilityRef.current?.platform === 'android' || remoteCapabilityRef.current?.platform === 'ios',
							getAckedBytes: () => outgoingAckedBytesRef.current,
						},
					)
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '等待对方确认', stage: '等待确认' })
					setStatus('已发送，等待对方确认')
					startAckTimer(file)
				} catch (error) {
					sendControl({ type: 'transfer-cancel', id: file.id, reason: error instanceof Error ? error.message : '发送失败' })
					outgoingFileRef.current = null
					transferBusyRef.current = false
					setTransferBusy(false)
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: 0, label: '发送失败', stage: '失败' })
					setStatus(error instanceof Error ? error.message : '发送失败')
				}
				return
			}
			if (message.type === 'transfer-progress') {
				const file = outgoingFileRef.current
				if (!file || file.id !== message.id) return
				outgoingAckedBytesRef.current = Math.max(outgoingAckedBytesRef.current, message.received)
				setOutgoing((current) => (current && current.id === file.id ? { ...current, label: `正在发送 · 对方已收到 ${formatBytes(outgoingAckedBytesRef.current)}` } : current))
				return
			}
			if (message.type === 'transfer-received') {
				const file = outgoingFileRef.current
				if (!file || file.id !== message.id) return
				clearAckTimer()
				outgoingAckedBytesRef.current = message.received
				if (message.received !== file.size || message.expected !== file.size || message.chunkCount !== file.chunkCount) {
					outgoingFileRef.current = null
					transferBusyRef.current = false
					setTransferBusy(false)
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: message.received, label: '对方接收异常', stage: '异常' })
					setStatus(`对方接收异常：${formatBytes(message.received)} / ${formatBytes(file.size)}`)
					return
				}
				outgoingFileRef.current = null
				transferBusyRef.current = false
				setTransferBusy(false)
				setSelectedFiles([])
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '对方已接收', stage: '完成' })
				setStatus('对方已确认接收完成')
				return
			}
			if (message.type === 'transfer-reject') return resetTransferState(message.reason || '对方拒绝接收')
			if (message.type === 'transfer-complete') return void (await finishIncomingTransfer(message.id, message.sent, message.chunkCount))
			if (message.type === 'transfer-cancel') resetTransferState(message.reason || '传输已取消')
		},
		[clearAckTimer, finishIncomingTransfer, resetTransferState, sendControl, startAckTimer],
	)

	const queueIncomingChunk = useCallback(
		(fileId: string, chunkIndex: number, bytes: Uint8Array) => {
			chunkWriteQueueRef.current = chunkWriteQueueRef.current
				.then(async () => {
					const current = incomingFileRef.current
					if (!current || current.request.id !== fileId) return
					if (chunkIndex < 0 || chunkIndex >= current.request.chunkCount) throw new Error('接收失败，请重新发送')
					const manifest = await current.engine.writeChunk(current.meta, chunkIndex, bytes)
					if (manifest.receivedBytes > current.request.size) throw new Error('接收失败，请重新发送')
					current.received = manifest.receivedBytes
					current.chunkCount = manifest.receivedChunks
					const ack = incomingProgressAckRef.current
					const now = Date.now()
					if (ack.id !== current.request.id || current.received - ack.bytes >= LAN_LIMITS.progressAckBytes || now - ack.at >= LAN_LIMITS.progressAckIntervalMs || manifest.status === 'complete') {
						incomingProgressAckRef.current = { id: current.request.id, bytes: current.received, at: now }
						sendControl({ type: 'transfer-progress', id: current.request.id, received: current.received, chunkCount: current.chunkCount, storage: current.engine.kind })
					}
					setIncoming({
						id: current.request.id,
						name: current.request.name,
						size: current.request.size,
						done: current.received,
						label: '正在接收',
						stage: '传输',
					})
				})
				.catch((error) => failTransfer(error instanceof Error ? error.message : '接收失败'))
		},
		[failTransfer, sendControl],
	)

	const handlePeerData = useCallback(
		(data: unknown) => {
			const frame = decodeFrame(data)
			if (!frame) return
			if (frame.kind === 'control') return void handleControl(frame.message).catch((error) => resetTransferState(error instanceof Error ? error.message : '传输失败'))
			queueIncomingChunk(frame.id, frame.index, frame.bytes)
		},
		[handleControl, queueIncomingChunk, resetTransferState],
	)

	const closeCurrentConnection = useCallback(
		(nextStatus = '连接已断开，可以重新扫码连接', nextState?: LanConnectionState) => {
			cleanupPeer()
			setRemotePeer(null)
			setRemoteCapability(null)
			remotePeerRef.current = null
			remoteCapabilityRef.current = null
			setConnectionState(nextState || (sessionRef.current ? 'signaling' : 'idle'))
			resetTransferState(nextStatus)
		},
		[cleanupPeer, resetTransferState],
	)

	const createPeer = useCallback(
		(initiator: boolean, remotePeerId: string) => {
			if (peerRef.current) return peerRef.current
			setConnectionState('connecting')
			setConnectionRoute('')
			const peer = new SimplePeer({ initiator, trickle: true, channelName: 'file-v3', config: lanRtcConfig })
			peer.on('signal', (signal) => void signalClientRef.current?.sendSignal(remotePeerId, signal).catch((error) => setStatus(error instanceof Error ? error.message : '连接消息发送失败')))
			peer.on('connect', () => {
				if (peerRef.current !== peer) return
				setConnected(true)
				setConnectionState('connected')
				signalClientRef.current?.stopAnnouncing()
				setStatus('已连接')
				void inspectLanConnectionRoute(peer)
					.then(route => {
						if (peerRef.current !== peer) return
						setConnectionRoute(route)
						setStatus('已连接，可以发送文件')
						void sendLocalCapability().catch(() => setStatus('已连接，可以发送文件'))
					})
					.catch(error => {
						if (peerRef.current !== peer) return
						peerRef.current = null
						peer.destroy()
						setConnected(false)
						setConnectionRoute('')
						setConnectionState('failed')
						resetTransferState(error instanceof Error ? error.message : '连接失败，请重新连接')
					})
			})
			peer.on('data', handlePeerData)
			peer.on('close', () => {
				if (peerRef.current !== peer) return
				peerRef.current = null
				setConnected(false)
				setConnectionRoute('')
				setConnectionState('failed')
				setRemotePeer(null)
				setRemoteCapability(null)
				resetTransferState('连接已断开，请重新扫码或重新发送')
			})
			peer.on('error', (error) => {
				if (peerRef.current !== peer) return
				peerRef.current = null
				setConnected(false)
				setConnectionRoute('')
				setConnectionState('failed')
				setRemotePeer(null)
				setRemoteCapability(null)
				resetTransferState(error instanceof Error ? error.message : '连接失败，请重新连接')
			})
			peerRef.current = peer
			return peer
		},
		[handlePeerData, resetTransferState, sendLocalCapability],
	)

	const handleSignalMessage = useCallback(
		(message: LanSignalMessage) => {
			const current = sessionRef.current
			if (!current) return
			const knownRemote = remotePeerRef.current
			if (knownRemote && knownRemote.id !== message.from) {
				if (message.type !== 'announce') return
				closeCurrentConnection('对方已重新连接，正在恢复...', 'connecting')
			}
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
					void signalClientRef.current?.sendAnnounce(message.from).catch((error) => setStatus(error instanceof Error ? error.message : '连接消息发送失败'))
					createPeer(true, message.from)
				} else {
					createPeer(false, message.from)
				}
				return
			}
			if (message.type === 'signal') return void (peerRef.current || createPeer(current.role === 'host', message.from)).signal(message.signal as SimplePeer.SignalData)
			if (message.type === 'peer-left') closeCurrentConnection('对方设备已离开', 'failed')
		},
		[closeCurrentConnection, createPeer],
	)

	const startSignaling = useCallback(
		async (next: LanSession) => {
			await signalClientRef.current?.close().catch(() => {})
			setConnectionState('signaling')
			setConnectionRoute('')
			const client = new LanSignalingClient(
				next,
				handleSignalMessage,
				(realtimeStatus) => {
					if (realtimeStatus === 'SUBSCRIBED') setStatus(next.role === 'host' ? '二维码已创建，等待另一台设备扫码' : '已加入，正在连接')
				},
				(error) => {
					setConnectionState('failed')
					setStatus(error.message)
				},
			)
			signalClientRef.current = client
			await client.ready
		},
		[handleSignalMessage],
	)

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
		} catch (error) {
			setConnectionState('failed')
			setStatus(error instanceof Error ? error.message : '创建连接失败')
		} finally {
			setBusy(false)
		}
	}

	const handleJoinRoom = useCallback(
		async (roomId: string, token: string) => {
			setBusy(true)
			closeCurrentConnection('正在加入...', 'signaling')
			try {
				const next = await joinLanSession(roomId, token)
				setSessionNow(next)
				const capability = await detectLanCapability(next.peerId)
				localCapabilityRef.current = capability
				setLocalCapability(capability)
				setRemotePeer(null)
				await startSignaling(next)
			} catch (error) {
				setConnectionState('failed')
				setStatus(error instanceof Error ? error.message : '加入连接失败')
			} finally {
				setBusy(false)
			}
		},
		[closeCurrentConnection, startSignaling],
	)

	useEffect(() => {
		if (!initialInvite?.roomId || !initialInvite.token || sessionRef.current) return
		void handleJoinRoom(initialInvite.roomId, initialInvite.token)
	}, [handleJoinRoom, initialInvite])

	useEffect(() => {
		return () => {
			clearAckTimer()
			cleanupIncomingStorage(incomingFileRef.current)
			void signalClientRef.current?.close().catch(() => {})
			peerRef.current?.destroy()
		}
	}, [clearAckTimer, cleanupIncomingStorage])

	const handleSendFiles = async () => {
		const peer = peerRef.current
		if (!peer?.connected || transferBusy || incomingRequest) return
		setTransferBusy(true)
		transferBusyRef.current = true
			setStatus('正在准备文件...')
		try {
			const remote = remoteCapabilityRef.current
			const totalSize = totalSelectedSize(selectedFiles)
			if (remote) assertCanReceiveFile(totalSize, remote)
			const storage = selectStorageForFile(totalSize, remote)
			const chunkSize = remote?.limits.recommendedChunkSize || LAN_LIMITS.defaultChunkSize
			const maxBytes = remote?.limits.maxExperimentalFileSize || LAN_LIMITS.experimentalMaxBytes
			const prepared = await prepareLanFiles(selectedFiles, { chunkSize, suggestedStorage: storage, maxBytes })
			outgoingFileRef.current = prepared
			setOutgoing({ id: prepared.id, name: prepared.name, size: prepared.size, done: 0, label: '等待对方确认', stage: '请求' })
			peer.send(
				encodeControl({
					type: 'transfer-request',
					protocolVersion: LAN_PROTOCOL_VERSION,
					id: prepared.id,
					name: prepared.name,
					mime: prepared.mime,
					size: prepared.size,
					fileCount: prepared.fileCount,
					lastModified: prepared.lastModified,
					chunkSize: prepared.chunkSize,
					chunkCount: prepared.chunkCount,
					suggestedStorage: prepared.suggestedStorage,
				}),
			)
			setStatus('已发送请求，等待对方接收')
		} catch (error) {
			resetTransferState(error instanceof Error ? error.message : '发送失败')
		}
	}

	const acceptIncoming = async () => {
		if (!incomingRequest) return
		try {
			const capability = localCapabilityRef.current || (sessionRef.current ? await detectLanCapability(sessionRef.current.peerId, incomingRequest.size) : null)
			if (capability) {
				assertCanReceiveFile(incomingRequest.size, capability)
				localCapabilityRef.current = capability
				setLocalCapability(capability)
			}
			const storage = chooseStorageKind(incomingRequest.size, incomingRequest.suggestedStorage, capability)
			if (storage === 'memory' && incomingRequest.size > LAN_LIMITS.memoryMaxBytes) throw new Error('当前浏览器不能接收这么大的文件')
			const engine = createStorageEngine(storage)
			const meta: TransferFileMeta = {
				id: incomingRequest.id,
				name: incomingRequest.name,
				mime: incomingRequest.mime,
				size: incomingRequest.size,
				lastModified: incomingRequest.lastModified,
				chunkSize: incomingRequest.chunkSize,
				chunkCount: incomingRequest.chunkCount,
				storage,
			}
			await engine.cleanup(meta.id).catch(() => {})
			await engine.prepare(meta).catch(async (error) => {
				await engine.cleanup(meta.id).catch(() => {})
				throw error
			})
			const manifest = await engine.getManifest(meta.id)
			incomingFileRef.current = { request: incomingRequest, meta, engine, received: manifest?.receivedBytes || 0, chunkCount: manifest?.receivedChunks || 0 }
			setIncoming({ id: incomingRequest.id, name: incomingRequest.name, size: incomingRequest.size, done: manifest?.receivedBytes || 0, label: '等待文件', stage: '准备' })
			transferBusyRef.current = true
			setTransferBusy(true)
			sendControl({ type: 'transfer-accept', id: incomingRequest.id, storage })
			setIncomingRequest(null)
			setStatus('已接收，等待文件发送')
		} catch (error) {
			sendControl({ type: 'transfer-reject', id: incomingRequest.id, reason: error instanceof Error ? error.message : '当前设备不能接收该文件' })
			setIncomingRequest(null)
			setStatus(error instanceof Error ? error.message : '当前设备不能接收该文件')
		}
	}

	const rejectIncoming = () => {
		if (!incomingRequest) return
		sendControl({ type: 'transfer-reject', id: incomingRequest.id, reason: '对方拒绝接收' })
		setIncomingRequest(null)
		setStatus('已拒绝接收')
	}

	const copyInvite = async () => {
		if (!inviteLink) return
		await navigator.clipboard.writeText(inviteLink)
		toast('连接链接已复制')
	}

	const leaveSession = () => {
		void signalClientRef.current?.close().catch(() => {})
		signalClientRef.current = null
		closeCurrentConnection('创建二维码后，用另一台设备扫码配对')
		setSession(null)
		setRemotePeer(null)
		setConnectionState('idle')
		setConnectionRoute('')
		setSelectedFiles([])
		onLeaveSession?.()
	}

	return {
		session,
		remotePeer,
		connected,
		connectionState,
		connectionRoute,
		qrDataUrl,
		selectedFiles,
		incomingRequest,
		outgoing,
		incoming,
		receivedFiles,
		localCapability,
		remoteCapability,
		status,
		busy,
		transferBusy,
		setSelectedFiles,
		handleCreateRoom,
		handleSendFiles,
		acceptIncoming,
		rejectIncoming,
		copyInvite,
		leaveSession,
		clearReceivedFile,
	}
}

export type LanTransferController = ReturnType<typeof useLanTransferController>
