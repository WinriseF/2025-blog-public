'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react'
import { createEmptyLanChatState, lanChatReducer, type LanChatAction, type LanChatState } from './use-lan-chat-state'
import { downloadUrl } from '@/lib/lan-transfer/file-transfer'
import { LanConnectionRuntime } from '@/lib/lan-transfer/connection-runtime'
import type { LanConnectionRoute, LanConnectionTransport } from '@/lib/lan-transfer/transport-types'
import type { LanAttachmentKind, LanCapability, LanConnectionState, LanFileRecord, LanPeer, LanSession, LanWebRtcBenchmarkDirection, LanWebRtcBenchmarkProgress } from '@/lib/lan-transfer/types'
import type { LanNativeAgentTicket } from '@/lib/lan-transfer/native-agent/types'
import type { LanNativeLocalAgentPort } from '@/lib/lan-transfer/native-agent/ports'
import { LanNativePeerBulkAdapter } from '@/lib/lan-transfer/native-agent/peer-native-file'

type UseLanTransferEngineOptions = {
	sessionRef: MutableRefObject<LanSession | null>
	localCapabilityRef: MutableRefObject<LanCapability | null>
	setLocalCapability: (capability: LanCapability | null) => void
	setStatus: (status: string) => void
	issueNativeAgentTicket: (peerDeviceId: string) => Promise<LanNativeAgentTicket>
	getNativeLocalAgentPort: () => LanNativeLocalAgentPort | null
}

type ManagedConnection = {
	peer: LanPeer
	runtime: LanConnectionRuntime
	remoteCapability: LanCapability | null
	transportId: string
	unsubscribe: () => void
}

type ConnectionStateRecord = {
	peerId: string
	peer: LanPeer
	connected: boolean
	connectionState: LanConnectionState
	connectionRoute: LanConnectionRoute | null
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
				connectionRoute: null,
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
	const nativePeerBulkRef = useRef(new LanNativePeerBulkAdapter())
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
			const runtime = new LanConnectionRuntime(nativePeerBulkRef.current)
			const unsubscribe = runtime.subscribe(event => {
				const current = managedRef.current.get(connectionId)
				if (event.type === 'message-upsert') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'upsert-message', message: event.message } })
				if (event.type === 'message-patch') dispatch({ type: 'chat', peerId: connectionId, action: { type: 'patch-message', id: event.patch.id, patch: event.patch } })
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
			entry = { peer, runtime, remoteCapability: null, transportId: '', unsubscribe }
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

	const attachTransport = useCallback((transport: LanConnectionTransport, remotePeer: LanPeer, route: LanConnectionRoute) => {
		const session = optionsRef.current.sessionRef.current
		if (!session) return
		const connectionId = connectionIdForPeer(remotePeer)
		const entry = ensureConnection(remotePeer, { connected: true, connectionState: 'connected', connectionRoute: route, status: '已连接，可以发送消息和文件' })
		entry.transportId = transport.id
		entry.runtime.attachTransport(transport, {
			session,
			remotePeerName: entry.peer.name,
			remoteCapability: entry.remoteCapability,
			localCapability: optionsRef.current.localCapabilityRef.current,
			getHistory: () => recordsRef.current.find(item => item.peerId === connectionId)?.chat.messages || [],
			issueNativeAgentTicket: optionsRef.current.issueNativeAgentTicket,
			getNativeLocalAgentPort: optionsRef.current.getNativeLocalAgentPort,
			remoteDeviceId: remotePeer.deviceId,
		})
		setActivePeerId(current => current || connectionId)
	}, [ensureConnection])

	const updateConnectionRoute = useCallback((peerId: string, transportId: string, route: LanConnectionRoute) => {
		const entry = managedRef.current.get(peerId)
		if (entry?.transportId === transportId) dispatch({ type: 'patch', peerId, patch: { connectionRoute: route } })
	}, [])

	const detachPeer = useCallback((peerId: string, status = '连接断了，正在恢复', state: LanConnectionState = 'suspect', transportId = '') => {
		const entry = managedRef.current.get(peerId)
		if (transportId && entry?.transportId && entry.transportId !== transportId) return
		entry?.runtime.detachTransport()
		if (entry) entry.transportId = ''
		dispatch({ type: 'patch', peerId, patch: { connected: false, connectionState: state, connectionRoute: null, status } })
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

	const handlePeerData = useCallback((peerId: string, transportId: string, data: unknown) => {
		const entry = managedRef.current.get(peerId)
		if (entry?.transportId === transportId) entry.runtime.handleFrame(data)
	}, [])

	const getActiveRuntime = useCallback(() => {
		const peerId = activePeerIdRef.current
		return peerId ? managedRef.current.get(peerId)?.runtime || null : null
	}, [])

	const pauseTransport = useCallback((peerId: string, transportId: string) => {
		const entry = managedRef.current.get(peerId)
		if (entry?.transportId === transportId) entry.runtime.pauseTransport()
	}, [])

	const resumeTransport = useCallback((peerId: string, transportId: string) => {
		const entry = managedRef.current.get(peerId)
		if (entry?.transportId === transportId) entry.runtime.resumeTransport()
	}, [])

	const isTransferActive = useCallback((peerId: string) => {
		return managedRef.current.get(peerId)?.runtime.hasActiveTransfer() || false
	}, [])

	const updateLocalCapability = useCallback((capability: LanCapability) => {
		managedRef.current.forEach(entry => entry.runtime.updateLocalCapability(capability))
	}, [])

	const requestNativeAgentTicket = useCallback((peerId: string) => {
		const runtime = managedRef.current.get(peerId)?.runtime
		if (!runtime) return Promise.reject(new Error('请先选择加速电脑'))
		return runtime.requestNativeAgentTicket()
	}, [])

	const runWebRtcBenchmark = useCallback((peerId: string, direction: LanWebRtcBenchmarkDirection, totalBytes: number, onProgress?: (progress: LanWebRtcBenchmarkProgress) => void, signal?: AbortSignal) => {
		const runtime = managedRef.current.get(peerId)?.runtime
		if (!runtime) return Promise.reject(new Error('请先选择测速设备'))
		return runtime.runWebRtcBenchmark(direction, totalBytes, onProgress, signal)
	}, [])

	const reserveBenchmark = useCallback((peerId: string) => {
		const runtime = managedRef.current.get(peerId)?.runtime
		if (!runtime) throw new Error('请先选择测速设备')
		return runtime.reserveBenchmark()
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

	const selectNativeFiles = useCallback(async () => {
		const runtime = getActiveRuntime()
		if (!runtime) return optionsRef.current.setStatus('请先选择已连接设备')
		try {
			await runtime.selectNativeFiles()
		} catch (error) {
			optionsRef.current.setStatus(error instanceof Error ? error.message : '无法打开本机文件选择器')
		}
	}, [getActiveRuntime])

	const startReceivingAttachment = useCallback((id: string) => {
		const runtime = getActiveRuntime()
		if (!runtime) return optionsRef.current.setStatus('请先选择设备')
		return runtime.acceptAttachment(id)
	}, [getActiveRuntime])

	useEffect(() => () => {
		managedRef.current.forEach(entry => entry.runtime.destroy())
		managedRef.current.clear()
	}, [])

	const connections = useMemo(() => records.map(toView), [records])
	const activeConnection = useMemo(() => connections.find(item => item.peerId === activePeerId) || null, [activePeerId, connections])

	return {
		connections,
		activePeerId,
		activeConnection,
		ensureConnection,
		patchConnection,
		attachTransport,
		updateConnectionRoute,
		pauseTransport,
		resumeTransport,
		detachPeer,
		removeConnection,
		resetAll,
		handlePeerData,
		isTransferActive,
		updateLocalCapability,
		requestNativeAgentTicket,
		runWebRtcBenchmark,
		reserveBenchmark,
		selectConnection: setActivePeerId,
		sendText,
		sendFiles,
		selectNativeFiles,
		startReceivingAttachment,
		downloadAttachment: (name: string, url: string) => downloadUrl(name, url),
	}
}
