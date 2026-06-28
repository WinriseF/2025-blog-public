'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, QrCode, Send, UploadCloud, Wifi, X } from 'lucide-react'
import * as QRCode from 'qrcode'
import SimplePeer from 'simple-peer'
import { toast } from 'sonner'
import { LanTransferStatus } from './lan-transfer-status'
import { createLanSession, joinLanSession, LanSignalingClient } from '@/lib/lan-transfer/signal-client'
import {
	decodeFrame,
	downloadUrl,
	encodeControl,
	formatBytes,
	prepareLanFiles,
	sendPreparedFile
} from '@/lib/lan-transfer/file-transfer'
import { LAN_LIMITS, LAN_PROTOCOL_VERSION, type LanControlMessage, type LanPeer, type LanProgressState, type LanSession, type LanSignalMessage, type LanTransferRequest, type PreparedLanFile, type ReceivedLanFile } from '@/lib/lan-transfer/types'

type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
	onLeaveSession?: () => void
}

type Session = LanSession

type IncomingTransfer = {
	request: LanTransferRequest
	chunks: Uint8Array[]
	received: number
	chunkCount: number
}

const rtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

function safeBlobPart(bytes: Uint8Array) {
	return bytes as unknown as BlobPart
}

export function LanTransferTool({ initialInvite = null, onLeaveSession }: LanTransferToolProps) {
	const [session, setSession] = useState<Session | null>(null)
	const [remotePeer, setRemotePeer] = useState<LanPeer | null>(null)
	const [connected, setConnected] = useState(false)
	const [qrDataUrl, setQrDataUrl] = useState('')
	const [selectedFiles, setSelectedFiles] = useState<File[]>([])
	const [incomingRequest, setIncomingRequest] = useState<LanTransferRequest | null>(null)
	const [outgoing, setOutgoing] = useState<LanProgressState | null>(null)
	const [incoming, setIncoming] = useState<LanProgressState | null>(null)
	const [receivedFiles, setReceivedFiles] = useState<ReceivedLanFile[]>([])
	const [status, setStatus] = useState('创建二维码后，用另一台设备扫码配对。')
	const [busy, setBusy] = useState(false)
	const [transferBusy, setTransferBusy] = useState(false)

	const peerRef = useRef<SimplePeer.Instance | null>(null)
	const signalClientRef = useRef<LanSignalingClient | null>(null)
	const sessionRef = useRef<Session | null>(null)
	const remotePeerRef = useRef<LanPeer | null>(null)
	const incomingRequestRef = useRef<LanTransferRequest | null>(null)
	const outgoingFileRef = useRef<PreparedLanFile | null>(null)
	const incomingFileRef = useRef<IncomingTransfer | null>(null)
	const receivedFilesRef = useRef<ReceivedLanFile[]>([])
	const transferBusyRef = useRef(false)
	const ackTimerRef = useRef<number | null>(null)

	useEffect(() => void (sessionRef.current = session), [session])
	useEffect(() => void (remotePeerRef.current = remotePeer), [remotePeer])
	useEffect(() => void (incomingRequestRef.current = incomingRequest), [incomingRequest])
	useEffect(() => void (receivedFilesRef.current = receivedFiles), [receivedFiles])
	useEffect(() => void (transferBusyRef.current = transferBusy), [transferBusy])

	const inviteLink = useMemo(() => {
		if (!session || session.role !== 'host' || typeof window === 'undefined') return ''
		return `${window.location.origin}/t#mode=lan&room=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token)}`
	}, [session])

	useEffect(() => {
		if (!inviteLink) {
			setQrDataUrl('')
			return
		}
		let cancelled = false
		QRCode.toDataURL(inviteLink, {
			errorCorrectionLevel: 'M',
			margin: 2,
			width: 220,
			color: { dark: '#173f42', light: '#ffffffff' }
		}).then(url => {
			if (!cancelled) setQrDataUrl(url)
		})
		return () => {
			cancelled = true
		}
	}, [inviteLink])

	const clearAckTimer = useCallback(() => {
		if (ackTimerRef.current !== null) window.clearTimeout(ackTimerRef.current)
		ackTimerRef.current = null
	}, [])

	const resetTransferState = useCallback(
		(nextStatus?: string) => {
			clearAckTimer()
			incomingFileRef.current = null
			incomingRequestRef.current = null
			outgoingFileRef.current = null
			transferBusyRef.current = false
			setIncomingRequest(null)
			setIncoming(null)
			setOutgoing(null)
			setTransferBusy(false)
			if (nextStatus) setStatus(nextStatus)
		},
		[clearAckTimer]
	)

	const cleanupPeer = useCallback(() => {
		const peer = peerRef.current
		peerRef.current = null
		if (peer) peer.destroy()
		setConnected(false)
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

	const failTransfer = useCallback(
		(reason: string) => {
			sendControl({ type: 'transfer-cancel', id: incomingFileRef.current?.request.id || outgoingFileRef.current?.id || 'unknown', reason })
			resetTransferState(reason)
		},
		[resetTransferState, sendControl]
	)

	const startAckTimer = useCallback(
		(file: PreparedLanFile) => {
			clearAckTimer()
			ackTimerRef.current = window.setTimeout(() => {
				if (outgoingFileRef.current?.id !== file.id) return
				outgoingFileRef.current = null
				transferBusyRef.current = false
				setTransferBusy(false)
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '等待确认超时' })
				setStatus('文件已经发出，但对方没有返回接收确认。请确认手机页面没有刷新、锁屏或切到后台。')
			}, LAN_LIMITS.receiveAckTimeoutMs)
		},
		[clearAckTimer]
	)

	const finishIncomingTransfer = useCallback(
		(messageId: string, sent?: number, chunkCount?: number) => {
			const current = incomingFileRef.current
			if (!current || current.request.id !== messageId) return
			if (typeof sent === 'number' && sent !== current.request.size) {
				failTransfer(`发送端声明大小异常：${formatBytes(sent)} / ${formatBytes(current.request.size)}`)
				return
			}
			if (typeof chunkCount === 'number' && chunkCount !== current.chunkCount) {
				failTransfer(`分片数量异常：${current.chunkCount} / ${chunkCount}`)
				return
			}
			if (current.received !== current.request.size) {
				failTransfer(`接收不完整：${formatBytes(current.received)} / ${formatBytes(current.request.size)}`)
				return
			}
			const blob = new Blob(current.chunks.map(safeBlobPart), { type: current.request.mime || 'application/octet-stream' })
			const url = URL.createObjectURL(blob)
			const received = {
				id: messageId,
				name: current.request.name,
				mime: current.request.mime,
				size: current.request.size,
				url,
				receivedAt: Date.now()
			}
			setReceivedFiles(files => [received, ...files].slice(0, 8))
			downloadUrl(received.name, url)
			incomingFileRef.current = null
			transferBusyRef.current = false
			setIncoming({ id: received.id, name: received.name, size: received.size, done: received.size, label: '接收完成' })
			setTransferBusy(false)
			setStatus('接收完成，文件已准备下载，并已向对方确认。')
			sendControl({ type: 'transfer-received', id: messageId, received: received.size, expected: received.size })
		},
		[failTransfer, sendControl]
	)

	const handleControl = useCallback(
		async (message: LanControlMessage) => {
			if (message.type === 'transfer-request') {
				if (message.protocolVersion !== LAN_PROTOCOL_VERSION) {
					sendControl({ type: 'transfer-reject', id: message.id, reason: '双方局域网互传协议版本不一致，请刷新两个页面后重试' })
					return
				}
				if (transferBusyRef.current || incomingRequestRef.current) {
					sendControl({ type: 'transfer-reject', id: message.id, reason: '当前有传输正在进行' })
					return
				}
				if (message.size > LAN_LIMITS.maxBytes) {
					sendControl({ type: 'transfer-reject', id: message.id, reason: `单次最多 ${formatBytes(LAN_LIMITS.maxBytes)}` })
					return
				}
				setIncomingRequest(message)
				setStatus(`${remotePeerRef.current?.name || '对方设备'} 想发送 ${message.fileCount} 个文件。`)
				return
			}
			if (message.type === 'transfer-accept') {
				const file = outgoingFileRef.current
				const peer = peerRef.current
				if (!file || !peer || file.id !== message.id) return
				setStatus('对方已接收，正在稳定发送文件...')
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: 0, label: '正在发送' })
				try {
					await sendPreparedFile(peer, file, done => setOutgoing({ id: file.id, name: file.name, size: file.size, done, label: '正在发送' }))
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '等待对方确认' })
					setStatus('文件已发出，正在等待对方浏览器确认接收完成...')
					startAckTimer(file)
				} catch (error) {
					outgoingFileRef.current = null
					transferBusyRef.current = false
					setTransferBusy(false)
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: 0, label: '发送失败' })
					setStatus(error instanceof Error ? error.message : '发送失败')
				}
				return
			}
			if (message.type === 'transfer-received') {
				const file = outgoingFileRef.current
				if (!file || file.id !== message.id) return
				clearAckTimer()
				if (message.received !== file.size || message.expected !== file.size) {
					outgoingFileRef.current = null
					transferBusyRef.current = false
					setTransferBusy(false)
					setOutgoing({ id: file.id, name: file.name, size: file.size, done: message.received, label: '对方接收异常' })
					setStatus(`对方接收大小异常：${formatBytes(message.received)} / ${formatBytes(file.size)}`)
					return
				}
				outgoingFileRef.current = null
				transferBusyRef.current = false
				setTransferBusy(false)
				setSelectedFiles([])
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '对方已接收' })
				setStatus('对方已确认接收完成。')
				return
			}
			if (message.type === 'transfer-reject') {
				resetTransferState(message.reason || '对方拒绝接收。')
				return
			}
			if (message.type === 'transfer-complete') {
				finishIncomingTransfer(message.id, message.sent, message.chunkCount)
				return
			}
			if (message.type === 'transfer-cancel') {
				resetTransferState(message.reason || '传输已取消。')
			}
		},
		[clearAckTimer, finishIncomingTransfer, resetTransferState, sendControl, startAckTimer]
	)

	const handlePeerData = useCallback(
		(data: unknown) => {
			const frame = decodeFrame(data)
			if (!frame) return
			if (frame.kind === 'control') {
				void handleControl(frame.message).catch(error => (resetTransferState(error instanceof Error ? error.message : '传输失败')))
				return
			}
			const current = incomingFileRef.current
			if (!current) return
			const nextReceived = current.received + frame.bytes.byteLength
			if (nextReceived > current.request.size) {
				failTransfer(`收到的数据超过声明大小：${formatBytes(nextReceived)} / ${formatBytes(current.request.size)}`)
				return
			}
			current.chunks.push(frame.bytes)
			current.received = nextReceived
			current.chunkCount += 1
			setIncoming({
				id: current.request.id,
				name: current.request.name,
				size: current.request.size,
				done: current.received,
				label: '正在接收'
			})
		},
		[failTransfer, handleControl, resetTransferState]
	)

	const closeCurrentConnection = useCallback((nextStatus = '连接已断开，可以重新扫码连接。') => {
		cleanupPeer()
		setRemotePeer(null)
		resetTransferState(nextStatus)
	}, [cleanupPeer, resetTransferState])

	const createPeer = useCallback(
		(initiator: boolean, remotePeerId: string) => {
			if (peerRef.current) return peerRef.current
			const peer = new SimplePeer({ initiator, trickle: true, channelName: 'file-v2', config: rtcConfig })
			peer.on('signal', signal => {
				void signalClientRef.current?.sendSignal(remotePeerId, signal).catch(error => setStatus(error instanceof Error ? error.message : '信令发送失败'))
			})
			peer.on('connect', () => {
				if (peerRef.current !== peer) return
				setConnected(true)
				setStatus('点对点连接已建立，双方都可以发送文件。')
			})
			peer.on('data', handlePeerData)
			peer.on('close', () => {
				if (peerRef.current !== peer) return
				peerRef.current = null
				setConnected(false)
				setRemotePeer(null)
				resetTransferState('连接已断开，可以重新扫码连接。')
			})
			peer.on('error', error => {
				if (peerRef.current !== peer) return
				peerRef.current = null
				setConnected(false)
				setRemotePeer(null)
				resetTransferState(error instanceof Error ? error.message : 'WebRTC 连接失败')
			})
			peerRef.current = peer
			return peer
		},
		[handlePeerData, resetTransferState]
	)

	const handleSignalMessage = useCallback(
		(message: LanSignalMessage) => {
			const current = sessionRef.current
			if (!current) return
			const knownRemote = remotePeerRef.current
			if (knownRemote && knownRemote.id !== message.peerId) {
				if (message.type !== 'hello') return
				closeCurrentConnection('检测到对方刷新或重新扫码，正在重建连接...')
			}

			if (message.peer) setRemotePeer(message.peer)
			if (message.type === 'hello') {
				setStatus('已发现对方设备，正在建立点对点连接...')
				if (current.role === 'host') {
					void signalClientRef.current?.sendHello().catch(error => setStatus(error instanceof Error ? error.message : '信令发送失败'))
					createPeer(true, message.peerId)
				} else {
					createPeer(false, message.peerId)
				}
				return
			}
			if (message.type === 'signal') {
				const peer = peerRef.current || createPeer(current.role === 'host', message.peerId)
				peer.signal(message.signal as SimplePeer.SignalData)
				return
			}
			if (message.type === 'peer-left') {
				closeCurrentConnection('对方设备已离开。')
			}
		},
		[closeCurrentConnection, createPeer]
	)

	const startSignaling = useCallback(
		async (next: Session) => {
			await signalClientRef.current?.close().catch(() => {})
			const client = new LanSignalingClient(
				next,
				handleSignalMessage,
				realtimeStatus => {
					if (realtimeStatus === 'SUBSCRIBED') setStatus(next.role === 'host' ? '二维码已创建，等待另一台设备扫码。' : '已加入，正在等待对方设备回应。')
				},
				error => setStatus(error.message)
			)
			signalClientRef.current = client
			await client.ready
		},
		[handleSignalMessage]
	)

	const setSessionNow = (next: Session) => {
		sessionRef.current = next
		setSession(next)
	}

	const handleCreateRoom = async () => {
		setBusy(true)
		closeCurrentConnection('正在创建连接二维码...')
		try {
			const next = await createLanSession()
			setSessionNow(next)
			await startSignaling(next)
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '创建连接失败')
		} finally {
			setBusy(false)
		}
	}

	const handleJoinRoom = useCallback(
		async (roomId: string, token: string) => {
			setBusy(true)
			closeCurrentConnection('正在加入对方设备...')
			try {
				const next = await joinLanSession(roomId, token)
				setSessionNow(next)
				setRemotePeer(null)
				await startSignaling(next)
			} catch (error) {
				setStatus(error instanceof Error ? error.message : '加入连接失败')
			} finally {
				setBusy(false)
			}
		},
		[closeCurrentConnection, startSignaling]
	)

	useEffect(() => {
		if (!initialInvite?.roomId || !initialInvite.token || sessionRef.current) return
		void handleJoinRoom(initialInvite.roomId, initialInvite.token)
	}, [handleJoinRoom, initialInvite])

	useEffect(() => {
		return () => {
			clearAckTimer()
			void signalClientRef.current?.close().catch(() => {})
			peerRef.current?.destroy()
			receivedFilesRef.current.forEach(file => URL.revokeObjectURL(file.url))
		}
	}, [clearAckTimer])

	const handleSendFiles = async () => {
		const peer = peerRef.current
		if (!peer?.connected || transferBusy || incomingRequest) return
		setTransferBusy(true)
		transferBusyRef.current = true
		setStatus('正在准备文件...')
		try {
			const prepared = await prepareLanFiles(selectedFiles)
			outgoingFileRef.current = prepared
			setOutgoing({ id: prepared.id, name: prepared.name, size: prepared.size, done: 0, label: '等待对方确认' })
			peer.send(
				encodeControl({
					type: 'transfer-request',
					protocolVersion: LAN_PROTOCOL_VERSION,
					id: prepared.id,
					name: prepared.name,
					mime: prepared.mime,
					size: prepared.size,
					fileCount: prepared.fileCount
				})
			)
			setStatus('已发送接收请求，等待对方确认。')
		} catch (error) {
			resetTransferState(error instanceof Error ? error.message : '发送失败')
		}
	}

	const acceptIncoming = () => {
		if (!incomingRequest) return
		incomingFileRef.current = { request: incomingRequest, chunks: [], received: 0, chunkCount: 0 }
		setIncoming({ id: incomingRequest.id, name: incomingRequest.name, size: incomingRequest.size, done: 0, label: '等待数据' })
		transferBusyRef.current = true
		setTransferBusy(true)
		sendControl({ type: 'transfer-accept', id: incomingRequest.id })
		setIncomingRequest(null)
		setStatus('已接收请求，正在等待文件数据。')
	}

	const rejectIncoming = () => {
		if (!incomingRequest) return
		sendControl({ type: 'transfer-reject', id: incomingRequest.id, reason: '对方拒绝接收' })
		setIncomingRequest(null)
		setStatus('已拒绝接收。')
	}

	const copyInvite = async () => {
		if (!inviteLink) return
		await navigator.clipboard.writeText(inviteLink)
		toast('连接链接已复制')
	}

	const leaveSession = () => {
		void signalClientRef.current?.close().catch(() => {})
		signalClientRef.current = null
		closeCurrentConnection('创建二维码后，用另一台设备扫码配对。')
		setSession(null)
		setRemotePeer(null)
		setQrDataUrl('')
		setSelectedFiles([])
		onLeaveSession?.()
	}

	return (
		<div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]'>
			<section className='space-y-4'>
				<div className='rounded-2xl border border-brand/20 bg-brand/5 p-5 max-sm:p-4'>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<div className='min-w-0'>
							<p className='text-secondary text-xs tracking-[0.18em] uppercase'>LAN SESSION</p>
							<h2 className='mt-1 text-lg font-semibold'>局域网互传</h2>
						</div>
						<div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-background/60 text-secondary'}`}>
							{connected ? '已直连' : session ? '连接中' : '未连接'}
						</div>
					</div>
					<p className='text-secondary mt-3 text-sm leading-6 max-sm:text-xs'>扫码配对后，双方都能发送和接收。</p>
				</div>

				{!session ? (
					<div className='grid gap-3 sm:grid-cols-2'>
						<button onClick={() => void handleCreateRoom()} disabled={busy} className='min-h-[150px] rounded-2xl border border-border bg-article p-5 text-left transition hover:border-brand/50 disabled:opacity-50'>
							<QrCode className='mb-4 text-brand' size={28} />
							<span className='block text-base font-semibold'>创建连接二维码</span>
							<span className='text-secondary mt-2 block text-sm leading-6'>让另一台设备扫码，建立双向互传会话。</span>
						</button>
						<div className='min-h-[150px] rounded-2xl border border-dashed border-border bg-background/30 p-5 text-left'>
							<Wifi className='mb-4 text-secondary' size={28} />
							<span className='block text-base font-semibold'>扫码后等待连接</span>
							<span className='text-secondary mt-2 block text-sm leading-6'>手机扫电脑、电脑扫手机都可以，刷新后会自动重建连接。</span>
						</div>
					</div>
				) : (
					<div className='space-y-4'>
						<div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]'>
							<div className='rounded-2xl border border-border bg-article p-5 max-sm:p-4'>
								<div className='flex items-start justify-between gap-3'>
									<div className='min-w-0'>
										<p className='text-secondary text-xs'>对方设备</p>
										<p className='mt-1 truncate text-base font-semibold'>{remotePeer?.name || '等待另一台设备'}</p>
										<p className='text-secondary mt-3 text-sm'>{connected ? '点对点通道已打开。' : '等待信令和 WebRTC 建连。'}</p>
									</div>
									<button onClick={leaveSession} className='flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-secondary'>
										<X size={14} />
										离开
									</button>
								</div>
							</div>
							{session.role === 'host' && (
								<div className='rounded-2xl border border-border bg-white p-3 text-center shadow-sm'>
									{qrDataUrl ? <img src={qrDataUrl} alt='局域网互传连接二维码' className='mx-auto size-[180px]' /> : <div className='text-secondary flex h-[180px] items-center justify-center text-xs'>生成二维码中</div>}
									<button onClick={() => void copyInvite()} className='mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-primary'>
										<Copy size={14} />
										复制连接
									</button>
								</div>
							)}
						</div>

						<label className='border-brand/20 bg-background/40 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center'>
							<UploadCloud className='mb-3 text-brand' size={30} />
							<input type='file' multiple className='hidden' onChange={event => setSelectedFiles(Array.from(event.target.files || []))} />
							<span className='font-semibold'>{selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : '选择要发送的文件'}</span>
							<span className='text-secondary mt-1 text-xs'>多文件会先打包 ZIP，单次建议不超过 {formatBytes(LAN_LIMITS.maxBytes)}</span>
						</label>

						{selectedFiles.length > 0 && (
							<div className='rounded-2xl border border-border bg-article p-4 text-sm'>
								<div className='text-secondary mb-2 text-xs'>待发送</div>
								<div className='space-y-1'>
									{selectedFiles.slice(0, 5).map(file => (
										<div key={`${file.name}-${file.size}-${file.lastModified}`} className='flex justify-between gap-3'>
											<span className='truncate'>{file.name}</span>
											<span className='text-secondary shrink-0'>{formatBytes(file.size)}</span>
										</div>
									))}
								</div>
							</div>
						)}

						<button disabled={!connected || !selectedFiles.length || transferBusy || !!incomingRequest} onClick={() => void handleSendFiles()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
							<Send size={16} />
							发送给对方
						</button>
					</div>
				)}

				{incomingRequest && (
					<div className='rounded-2xl border border-brand/40 bg-brand/10 p-4'>
						<p className='font-semibold'>{remotePeer?.name || '对方设备'} 想发送文件</p>
						<p className='text-secondary mt-1 text-sm'>
							{incomingRequest.name} · {incomingRequest.fileCount} 个文件 · {formatBytes(incomingRequest.size)}
						</p>
						<div className='mt-3 flex gap-2'>
							<button onClick={acceptIncoming} className='bg-brand text-background rounded-full px-4 py-2 text-xs font-semibold'>
								接收
							</button>
							<button onClick={rejectIncoming} className='rounded-full border border-border px-4 py-2 text-xs font-semibold'>
								拒绝
							</button>
						</div>
					</div>
				)}
			</section>

			<LanTransferStatus busy={busy} status={status} outgoing={outgoing} incoming={incoming} receivedFiles={receivedFiles} />
		</div>
	)
}
