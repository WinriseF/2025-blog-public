'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react'
import type SimplePeer from 'simple-peer'
import { createEmptyLanChatState, lanChatReducer, type LanChatAction, type LanChatState } from './use-lan-chat-state'
import { downloadUrl, type LanConnectionTransport } from '@/lib/lan-transfer/file-transfer'
import { LanConnectionRuntime } from '@/lib/lan-transfer/connection-runtime'
import type { LanAttachmentKind, LanCapability, LanConnectionState, LanFileRecord, LanPeer, LanSession } from '@/lib/lan-transfer/types'

type UseLanTransferEngineOptions = {
	sessionRef: MutableRefObject<LanSession | null>
	localCapabilityRef: MutableRefObject<LanCapability | null>
	setLocalCapability: (capability: LanCapability | null) => void
	setStatus: (status: string) => void
}

type ManagedConnection = {
	peer: LanPeer
	runtime: LanConnectionRuntime
	remoteCapability: LanCapability | null
	unsubscribe: () => void
}

type ConnectionStateRecord = {
	peerId: string
	peer: LanPeer
	connected: boolean
	connectionState: LanConnectionState
	connectionRoute: string
	status: string
	remoteCapability: LanCapability | null
	chat: LanChatState
	updatedAt: number
}

export type LanConnectionView = Omit<ConnectionStateRecord, 'chat'> & {
	messages: LanChatState['messages']
	fileRecords: LanFileRecord[]
}

type ConnectionPatch = Partial<Omit<ConnectionStateRecord, 'peerId' | 'peer' | 'chat'>>

type ConnectionAction =
	| { type: 'upsert'; peer: LanPeer; patch?: ConnectionPatch }
	| { type: 'patch'; peerId: string; patch: ConnectionPatch }
	| { type: 'chat'; peerId: string; action: LanChatAction }
	| { type: 'remove'; peerId: string }
	| { type: 'reset' }

function connectionIdForPeer(peer: LanPeer) {
	return peer.deviceId
}

function getDataChannel(peer: SimplePeer.Instance) {
	return (peer as unknown as { _channel?: RTCDataChannel })._channel
}

function getOpenDataChannel(peer: SimplePeer.Instance) {
	const channel = getDataChannel(peer)
	if (!peer.connected || !channel || channel.readyState !== 'open') throw new Error('连接已断开，请重新连接后再发送')
	return channel
}

async function waitForBufferedAmount(peer: SimplePeer.Instance, limit: number, lowWatermark: number, timeoutMs: number) {
	const startedAt = Date.now()
	let channel = getOpenDataChannel(peer)
	channel.bufferedAmountLowThreshold = lowWatermark
	while (channel.bufferedAmount > limit) {
		if (Date.now() - startedAt > timeoutMs) throw new Error('发送暂停，请保持两台设备页面打开')
		await new Promise<void>((resolve, reject) => {
			let done = false
			let timer: number | null = null
			const cleanup = () => {
				channel.removeEventListener('bufferedamountlow', onLow)
				channel.removeEventListener('close', onClose)
				channel.removeEventListener('error', onClose)
				if (timer !== null) window.clearTimeout(timer)
			}
			const finish = () => {
				if (done) return
				done = true
				cleanup()
				resolve()
			}
			const fail = () => {
				if (done) return
				done = true
				cleanup()
				reject(new Error('连接已断开，请重新连接后再发送'))
			}
			const onLow = () => finish()
			const onClose = () => fail()
			timer = window.setTimeout(finish, 250)
			channel.addEventListener('bufferedamountlow', onLow)
			channel.addEventListener('close', onClose, { once: true })
			channel.addEventListener('error', onClose, { once: true })
		})
		channel = getOpenDataChannel(peer)
		channel.bufferedAmountLowThreshold = lowWatermark
	}
}

function simplePeerTransport(peer: SimplePeer.Instance): LanConnectionTransport {
	return {
		isOpen: () => {
			const channel = getDataChannel(peer)
			return Boolean(peer.connected && channel?.readyState === 'open')
		},
		send: data => {
			try {
				if (!peer.connected) return false
				peer.send(data)
				return true
			} catch {
				return false
			}
		},
		waitUntilWritable: (highWatermark, lowWatermark, timeoutMs) => waitForBufferedAmount(peer, highWatermark, lowWatermark, timeoutMs),
		waitUntilDrained: (lowWatermark, timeoutMs) => waitForBufferedAmount(peer, lowWatermark, lowWatermark, timeoutMs),
	}
}

function connectionReducer(state: ConnectionStateRecord[], action: ConnectionAction): ConnectionStateRecord[] {
	if (action.type === 'reset') return []
	if (action.type === 'remove') return state.filter(item => item.peerId !== action.peerId)
	if (action.type === 'chat') {
		return state.map(item => item.peerId === action.peerId ? { ...item, chat: lanChatReducer(item.chat, action.action), updatedAt: Date.now() } : item)
	}
	if (action.type === 'patch') {
		return state.map(item => item.peerId === action.peerId ? { ...item, ...action.patch, updatedAt: Date.now() } : item)
	}
	const connectionId = connectionIdForPeer(action.peer)
	const index = state.findIndex(item => item.peerId === connectionId)
	if (index < 0) {
		return [
			...state,
			{
				peerId: connectionId,
				peer: action.peer,
				connected: false,
				connectionState: 'discovered',
				connectionRoute: '',
				status: '找到设备，正在连接',
				remoteCapability: null,
				chat: createEmptyLanChatState(),
				updatedAt: Date.now(),
				...action.patch,
			},
		]
	}
	const next = state.slice()
	next[index] = { ...next[index], peer: action.peer, ...action.patch, updatedAt: Date.now() }
	return next
}

function toView(record: ConnectionStateRecord): LanConnectionView {
	return {
		peerId: record.peerId,
		peer: record.peer,
		connected: record.connected,
		connectionState: record.connectionState,
		connectionRoute: record.connectionRoute,
		status: record.status,
		remoteCapability: record.remoteCapability,
		updatedAt: record.updatedAt,
		messages: record.chat.messages,
		fileRecords: record.chat.fileRecords,
	}
}

export function useLanTransferEngine(options: UseLanTransferEngineOptions) {
	const optionsRef = useRef(options)
	const managedRef = useRef(new Map<string, ManagedConnection>())
	const recordsRef = useRef<ConnectionStateRecord[]>([])
	const activePeerIdRef = useRef<string | null>(null)
	const [records, dispatch] = useReducer(connectionReducer, [])
	const [activePeerId, setActivePeerId] = useState<string | null>(null)

	useEffect(() => {
		optionsRef.current = options
	}, [options])

	useEffect(() => {
		recordsRef.current = records
	}, [records])

	useEffect(() => {
		activePeerIdRef.current = activePeerId
	}, [activePeerId])

	useEffect(() => {
		if (!records.length) {
			if (activePeerId) setActivePeerId(null)
			return
		}
		if (!activePeerId || !records.some(item => item.peerId === activePeerId)) setActivePeerId(records[0].peerId)
	}, [activePeerId, records])

	const ensureConnection = useCallback((peer: LanPeer, patch?: ConnectionPatch) => {
		const connectionId = connectionIdForPeer(peer)
		let entry = managedRef.current.get(connectionId)
		if (!entry) {
			const runtime = new LanConnectionRuntime()
			const unsubscribe = runtime.subscribe(event => {
				const current = managedRef.current.get(connectionId)
				if (event.type === 'message-upsert') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'upsert-message', message: event.message } })
				if (event.type === 'history-merge') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'merge-history', messages: event.messages } })
				if (event.type === 'attachment-upsert') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'upsert-attachment', message: event.message, attachment: event.attachment } })
				if (event.type === 'attachment-patch') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'patch-attachment', patch: event.patch } })
				if (event.type === 'file-record-upsert') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'upsert-file-record', record: event.record } })
				if (event.type === 'file-record-patch') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'patch-file-record', id: event.id, patch: event.patch } })
				if (event.type === 'status') {
					dispatch({ type: 'patch', peerId: connectionId, patch: { status: event.message } })
				}
				if (event.type === 'local-capability') {
					optionsRef.current.localCapabilityRef.current = event.capability
					optionsRef.current.setLocalCapability(event.capability)
				}
				if (event.type === 'remote-capability') {
					if (current) current.remoteCapability = event.capability
					dispatch({ type: 'patch', peerId: connectionId, patch: { remoteCapability: event.capability } })
				}
				if (event.type === 'download-ready') downloadUrl(event.name, event.url)
			})
			entry = { peer, runtime, remoteCapability: null, unsubscribe }
			managedRef.current.set(connectionId, entry)
		} else {
			entry.peer = peer
		}
		dispatch({ type: 'upsert', peer, patch })
		setActivePeerId(current => current || connectionId)
		return entry
	}, [])

	const patchConnection = useCallback((peerId: string, patch: ConnectionPatch) => {
		dispatch({ type: 'patch', peerId, patch })
	}, [])

	const attachPeer = useCallback((peerId: string, peer: SimplePeer.Instance, remotePeer: LanPeer, route: string) => {
		const session = optionsRef.current.sessionRef.current
		if (!session) return
		const connectionId = connectionIdForPeer(remotePeer)
		const entry = ensureConnection(remotePeer, { connected: true, connectionState: 'connected', connectionRoute: route, status: '已连接，可以发送消息和文件' })
		entry.runtime.attachTransport(simplePeerTransport(peer), {
			session,
			remotePeerName: entry.peer.name,
			remoteCapability: entry.remoteCapability,
			localCapability: optionsRef.current.localCapabilityRef.current,
			getHistory: () => recordsRef.current.find(item => item.peerId === connectionId)?.chat.messages || [],
		})
		setActivePeerId(current => current || peerId)
	}, [ensureConnection])

	const detachPeer = useCallback((peerId: string, status = '连接断了，正在恢复', state: LanConnectionState = 'signaling') => {
		const entry = managedRef.current.get(peerId)
		entry?.runtime.detachTransport()
		dispatch({ type: 'patch', peerId, patch: { connected: false, connectionState: state, connectionRoute: '', status } })
		if (!activePeerIdRef.current || activePeerIdRef.current === peerId) optionsRef.current.setStatus(status)
	}, [])

	const removeConnection = useCallback((peerId: string) => {
		const entry = managedRef.current.get(peerId)
		entry?.unsubscribe()
		entry?.runtime.destroy()
		managedRef.current.delete(peerId)
		dispatch({ type: 'remove', peerId })
		setActivePeerId(current => current === peerId ? null : current)
	}, [])

	const resetAll = useCallback(() => {
		managedRef.current.forEach(entry => {
			entry.unsubscribe()
			entry.runtime.destroy()
		})
		managedRef.current.clear()
		dispatch({ type: 'reset' })
		setActivePeerId(null)
	}, [])

	const handlePeerData = useCallback((peerId: string, data: unknown) => {
		managedRef.current.get(peerId)?.runtime.handleFrame(data)
	}, [])

	const getActiveRuntime = useCallback(() => {
		const peerId = activePeerIdRef.current
		return peerId ? managedRef.current.get(peerId)?.runtime || null : null
	}, [])

	const sendText = useCallback((text: string) => {
		const runtime = getActiveRuntime()
		if (!runtime) return optionsRef.current.setStatus('请先选择已连接设备')
		runtime.sendText(text)
	}, [getActiveRuntime])

	const sendFiles = useCallback(async (files: File[], forcedKind?: LanAttachmentKind, durationMs?: number) => {
		const runtime = getActiveRuntime()
		if (!runtime) return optionsRef.current.setStatus('请先选择已连接设备')
		await runtime.sendFiles(files, { kind: forcedKind, durationMs })
	}, [getActiveRuntime])

	const startReceivingAttachment = useCallback((id: string) => {
		const runtime = getActiveRuntime()
		if (!runtime) return optionsRef.current.setStatus('请先选择设备')
		return runtime.acceptAttachment(id)
	}, [getActiveRuntime])

	const addSystemMessage = useCallback((text: string, peerId = activePeerIdRef.current) => {
		if (!peerId) return
		dispatch({
			type: 'chat',
			peerId,
			action: {
				type: 'upsert-message',
				message: {
					id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					direction: 'system',
					kind: 'system',
					text,
					attachments: [],
					status: 'received',
					createdAt: Date.now(),
				},
			},
		})
	}, [])

	useEffect(() => () => {
		managedRef.current.forEach(entry => entry.runtime.destroy())
		managedRef.current.clear()
	}, [])

	const connections = useMemo(() => records.map(toView), [records])
	const activeConnection = useMemo(() => connections.find(item => item.peerId === activePeerId) || null, [activePeerId, connections])
	const connected = useMemo(() => connections.some(item => item.connected), [connections])

	return {
		connections,
		activePeerId,
		activeConnection,
		connected,
		ensureConnection,
		patchConnection,
		attachPeer,
		detachPeer,
		removeConnection,
		resetAll,
		handlePeerData,
		selectConnection: setActivePeerId,
		addSystemMessage,
		sendText,
		sendFiles,
		startReceivingAttachment,
		clearFileRecord: (id: string) => getActiveRuntime()?.clearReceivedFile(id),
		downloadAttachment: (name: string, url: string) => downloadUrl(name, url),
	}
}
