'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, QrCode, Send, UploadCloud, Wifi, X } from 'lucide-react'
import * as QRCode from 'qrcode'
import SimplePeer from 'simple-peer'
import { toast } from 'sonner'
import { LanTransferStatus } from './lan-transfer-status'
import { closeLanRoom, createLanRoom, joinLanRoom, pollLanRoom, sendLanSignal } from '@/lib/lan-transfer/signal-client'
import {
	decodeFrame,
	downloadUrl,
	encodeControl,
	formatBytes,
	prepareLanFiles,
	sendPreparedFile
} from '@/lib/lan-transfer/file-transfer'
import { LAN_LIMITS, type LanControlMessage, type LanPeer, type LanProgressState, type LanRoomResponse, type LanTransferRequest, type PreparedLanFile, type ReceivedLanFile } from '@/lib/lan-transfer/types'
type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
}

type Session = {
	roomId: string
	token: string
	peerId: string
	role: 'host' | 'guest'
	pairExpiresAt: number
	sessionExpiresAt: number
}

const rtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

function sessionFromResponse(response: LanRoomResponse, token: string): Session {
	return {
		roomId: response.roomId,
		token,
		peerId: response.peerId,
		role: response.role,
		pairExpiresAt: response.pairExpiresAt,
		sessionExpiresAt: response.sessionExpiresAt
	}
}

export function LanTransferTool({ initialInvite = null }: LanTransferToolProps) {
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
	const sessionRef = useRef<Session | null>(null)
	const remotePeerRef = useRef<LanPeer | null>(null)
	const incomingRequestRef = useRef<LanTransferRequest | null>(null)
	const outgoingFileRef = useRef<PreparedLanFile | null>(null)
	const incomingFileRef = useRef<{ request: LanTransferRequest; chunks: Uint8Array[]; received: number } | null>(null)
	const receivedFilesRef = useRef<ReceivedLanFile[]>([])
	const transferBusyRef = useRef(false)

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

	const cleanupPeer = useCallback(() => {
		peerRef.current?.destroy()
		peerRef.current = null
		setConnected(false)
	}, [])

	const sendControl = useCallback((message: LanControlMessage) => {
		const peer = peerRef.current
		if (!peer?.connected) return false
		peer.send(encodeControl(message))
		return true
	}, [])

	const finishIncomingTransfer = useCallback((id: string) => {
		const current = incomingFileRef.current
		if (!current || current.request.id !== id) return
		const blob = new Blob(current.chunks.map(chunk => chunk.slice().buffer as ArrayBuffer), { type: current.request.mime || 'application/octet-stream' })
		const url = URL.createObjectURL(blob)
		const received = {
			id,
			name: current.request.name,
			mime: current.request.mime,
			size: current.request.size,
			url,
			receivedAt: Date.now()
		}
		setReceivedFiles(files => [received, ...files].slice(0, 8))
		downloadUrl(received.name, url)
		incomingFileRef.current = null
		setIncoming(null)
		setTransferBusy(false)
		setStatus('接收完成，文件已准备下载。')
	}, [])

	const handleControl = useCallback(
		async (message: LanControlMessage) => {
			if (message.type === 'transfer-request') {
				if (transferBusyRef.current || incomingRequestRef.current) {
					sendControl({ type: 'transfer-reject', id: message.id, reason: '当前有传输正在进行' })
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
				setStatus('对方已接收，正在发送文件...')
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: 0, label: '正在发送' })
				await sendPreparedFile(peer, file, done => setOutgoing({ id: file.id, name: file.name, size: file.size, done, label: '正在发送' }))
				outgoingFileRef.current = null
				setOutgoing({ id: file.id, name: file.name, size: file.size, done: file.size, label: '发送完成' })
				setSelectedFiles([])
				setTransferBusy(false)
				setStatus('发送完成。')
				return
			}
			if (message.type === 'transfer-reject') {
				outgoingFileRef.current = null
				setOutgoing(null)
				setTransferBusy(false)
				setStatus(message.reason || '对方拒绝接收。')
				return
			}
			if (message.type === 'transfer-complete') finishIncomingTransfer(message.id)
			if (message.type === 'transfer-cancel') {
				incomingFileRef.current = null
				outgoingFileRef.current = null
				setIncoming(null)
				setOutgoing(null)
				setTransferBusy(false)
				setStatus(message.reason || '传输已取消。')
			}
		},
		[finishIncomingTransfer, sendControl]
	)

	const handlePeerData = useCallback(
		(data: unknown) => {
			const frame = decodeFrame(data)
			if (!frame) return
			if (frame.kind === 'control') {
				void handleControl(frame.message).catch(error => (setTransferBusy(false), setStatus(error instanceof Error ? error.message : '传输失败')))
				return
			}
			const current = incomingFileRef.current
			if (!current) return
			current.chunks.push(frame.bytes)
			current.received += frame.bytes.byteLength
			setIncoming({
				id: current.request.id,
				name: current.request.name,
				size: current.request.size,
				done: current.received,
				label: '正在接收'
			})
		},
		[handleControl]
	)

	const createPeer = useCallback(
		(initiator: boolean, remotePeerId: string) => {
			if (peerRef.current) return peerRef.current
			const peer = new SimplePeer({ initiator, trickle: true, channelName: 'file', config: rtcConfig })
			peer.on('signal', signal => {
				const current = sessionRef.current
				if (!current) return
				void sendLanSignal(current.roomId, current.token, current.peerId, remotePeerId, signal).catch(error => setStatus(error instanceof Error ? error.message : '信令发送失败'))
			})
			peer.on('connect', () => {
				setConnected(true)
				setStatus('点对点连接已建立，双方都可以发送文件。')
			})
			peer.on('data', handlePeerData)
			peer.on('close', () => {
				setConnected(false)
				setStatus('连接已断开。')
			})
			peer.on('error', error => {
				setConnected(false)
				setStatus(error instanceof Error ? error.message : 'WebRTC 连接失败')
			})
			peerRef.current = peer
			return peer
		},
		[handlePeerData]
	)

	const setSessionNow = (next: Session) => {
		sessionRef.current = next
		setSession(next)
	}

	const handleCreateRoom = async () => {
		setBusy(true)
		cleanupPeer()
		setRemotePeer(null)
		setStatus('正在创建连接二维码...')
		try {
			const response = await createLanRoom()
			setSessionNow(sessionFromResponse(response, response.token || ''))
			setStatus('二维码已创建，等待另一台设备扫码。')
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '创建连接失败')
		} finally {
			setBusy(false)
		}
	}

	const handleJoinRoom = useCallback(
		async (roomId: string, token: string) => {
			setBusy(true)
			cleanupPeer()
			setStatus('正在加入对方设备...')
			try {
				const response = await joinLanRoom(roomId, token)
				const next = sessionFromResponse(response, token)
				const host = response.peers?.[0] || null
				setSessionNow(next)
				setRemotePeer(host)
				if (host) createPeer(false, host.id)
				setStatus('已加入，正在建立点对点连接...')
			} catch (error) {
				setStatus(error instanceof Error ? error.message : '加入连接失败')
			} finally {
				setBusy(false)
			}
		},
		[cleanupPeer, createPeer]
	)

	useEffect(() => {
		if (!initialInvite?.roomId || !initialInvite.token || sessionRef.current) return
		void handleJoinRoom(initialInvite.roomId, initialInvite.token)
	}, [handleJoinRoom, initialInvite])

	useEffect(() => {
		if (!session) return
		let stopped = false
		const tick = async () => {
			try {
				const response = await pollLanRoom(session.roomId, session.token, session.peerId)
				if (stopped) return
				const firstPeer = response.peers[0]
				if (firstPeer) setRemotePeer(firstPeer)
				for (const message of response.messages) {
					if (message.type === 'peer-joined') {
						const peer = (message.payload as { peer?: LanPeer }).peer
						if (peer) {
							setRemotePeer(peer)
							if (session.role === 'host') createPeer(true, peer.id)
						}
					}
					if (message.type === 'signal') {
						const remoteId = message.from
						const peer = peerRef.current || createPeer(session.role === 'host', remoteId)
						peer.signal(message.payload as SimplePeer.SignalData)
					}
					if (message.type === 'peer-left') {
						cleanupPeer()
						setRemotePeer(null)
						setStatus('对方设备已离开。')
					}
				}
			} catch (error) {
				if (!stopped) setStatus(error instanceof Error ? error.message : '信令轮询失败')
			} finally {
				if (!stopped) setTimeout(tick, LAN_LIMITS.pollMs)
			}
		}
		void tick()
		return () => {
			stopped = true
		}
	}, [cleanupPeer, createPeer, session])

	useEffect(() => {
		return () => {
			const current = sessionRef.current
			if (current) void closeLanRoom(current.roomId, current.token, current.peerId).catch(() => {})
			peerRef.current?.destroy()
			receivedFilesRef.current.forEach(file => URL.revokeObjectURL(file.url))
		}
	}, [])

	const handleSendFiles = async () => {
		const peer = peerRef.current
		if (!peer?.connected || transferBusy || incomingRequest) return
		setTransferBusy(true)
		setStatus('正在准备文件...')
		try {
			const prepared = await prepareLanFiles(selectedFiles)
			outgoingFileRef.current = prepared
			setOutgoing({ id: prepared.id, name: prepared.name, size: prepared.size, done: 0, label: '等待对方确认' })
			peer.send(
				encodeControl({
					type: 'transfer-request',
					id: prepared.id,
					name: prepared.name,
					mime: prepared.mime,
					size: prepared.size,
					fileCount: prepared.fileCount
				})
			)
			setStatus('已发送接收请求，等待对方确认。')
		} catch (error) {
			setTransferBusy(false)
			setOutgoing(null)
			setStatus(error instanceof Error ? error.message : '发送失败')
		}
	}

	const acceptIncoming = () => {
		if (!incomingRequest) return
		incomingFileRef.current = { request: incomingRequest, chunks: [], received: 0 }
		setIncoming({ id: incomingRequest.id, name: incomingRequest.name, size: incomingRequest.size, done: 0, label: '等待数据' })
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
		const current = sessionRef.current
		if (current) void closeLanRoom(current.roomId, current.token, current.peerId).catch(() => {})
		cleanupPeer()
		setSession(null)
		setRemotePeer(null)
		setQrDataUrl('')
		setIncomingRequest(null)
		setIncoming(null)
		setOutgoing(null)
		setTransferBusy(false)
		setStatus('创建二维码后，用另一台设备扫码配对。')
	}

	return (
		<div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]'>
			<section className='space-y-4'>
				<div className='rounded-2xl border border-brand/20 bg-brand/5 p-5'>
					<div className='flex flex-wrap items-start justify-between gap-4'>
						<div>
							<p className='text-secondary text-xs tracking-[0.18em] uppercase'>LAN SESSION</p>
							<h2 className='mt-1 text-lg font-semibold'>局域网互传</h2>
							<p className='text-secondary mt-2 text-sm leading-6'>二维码只负责配对。连接成功后，两台设备都能发送，也都能接收。</p>
						</div>
						<div className={`rounded-full px-3 py-1.5 text-xs font-medium ${connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-background/60 text-secondary'}`}>
							{connected ? '已直连' : session ? '连接中' : '未连接'}
						</div>
					</div>
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
							<span className='text-secondary mt-2 block text-sm leading-6'>手机扫电脑、电脑扫手机都可以，角色只影响谁先发起 WebRTC。</span>
						</div>
					</div>
				) : (
					<div className='space-y-4'>
						<div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]'>
							<div className='rounded-2xl border border-border bg-article p-5'>
								<div className='flex flex-wrap items-center justify-between gap-3'>
									<div>
										<p className='text-secondary text-xs'>对方设备</p>
										<p className='mt-1 text-base font-semibold'>{remotePeer?.name || '等待另一台设备'}</p>
									</div>
									<button onClick={leaveSession} className='flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-secondary'>
										<X size={14} />
										离开
									</button>
								</div>
								<p className='text-secondary mt-4 text-sm'>{connected ? '点对点通道已打开。' : '保持页面打开，正在等待信令和 WebRTC 建连。'}</p>
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
