'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type SimplePeer from 'simple-peer'
import { useLanChatState } from './use-lan-chat-state'
import { downloadUrl, type LanConnectionTransport } from '@/lib/lan-transfer/file-transfer'
import { LanConnectionRuntime } from '@/lib/lan-transfer/connection-runtime'
import type { LanAttachmentKind, LanCapability, LanPeer, LanSession } from '@/lib/lan-transfer/types'

type UseLanTransferEngineOptions = {
	sessionRef: MutableRefObject<LanSession | null>
	remotePeerRef: MutableRefObject<LanPeer | null>
	remoteCapabilityRef: MutableRefObject<LanCapability | null>
	localCapabilityRef: MutableRefObject<LanCapability | null>
	setLocalCapability: (capability: LanCapability | null) => void
	setRemoteCapability: (capability: LanCapability | null) => void
	setStatus: (status: string) => void
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

export function useLanTransferEngine(options: UseLanTransferEngineOptions) {
	const chat = useLanChatState()
	const runtimeRef = useRef<LanConnectionRuntime | null>(null)
	if (!runtimeRef.current) runtimeRef.current = new LanConnectionRuntime()
	const runtime = runtimeRef.current

	useEffect(() => {
		const unsubscribe = runtime.subscribe(event => {
			if (event.type === 'message-upsert') chat.upsertMessage(event.message)
			if (event.type === 'attachment-upsert') chat.upsertAttachment(event.message, event.attachment)
			if (event.type === 'attachment-patch') chat.patchAttachment(event.patch)
			if (event.type === 'file-record-upsert') chat.upsertFileRecord(event.record)
			if (event.type === 'file-record-patch') chat.patchFileRecord(event.id, event.patch)
			if (event.type === 'status') options.setStatus(event.message)
			if (event.type === 'local-capability') {
				options.localCapabilityRef.current = event.capability
				options.setLocalCapability(event.capability)
			}
			if (event.type === 'remote-capability') {
				options.remoteCapabilityRef.current = event.capability
				options.setRemoteCapability(event.capability)
			}
			if (event.type === 'download-ready') downloadUrl(event.name, event.url)
		})
		return () => {
			unsubscribe()
		}
	}, [chat, options, runtime])

	useEffect(() => () => runtime.destroy(), [runtime])

	const attachPeer = useCallback((peer: SimplePeer.Instance) => {
		const session = options.sessionRef.current
		if (!session) return
		runtime.attachTransport(simplePeerTransport(peer), {
			session,
			remotePeerName: options.remotePeerRef.current?.name,
			remoteCapability: options.remoteCapabilityRef.current,
			localCapability: options.localCapabilityRef.current,
		})
	}, [options, runtime])

	const detachPeer = useCallback(() => {
		runtime.detachTransport()
	}, [runtime])

	const resetSession = useCallback(() => {
		runtime.reset()
	}, [runtime])

	const handlePeerData = useCallback((data: unknown) => {
		runtime.handleFrame(data)
	}, [runtime])

	const sendFiles = useCallback(async (files: File[], forcedKind?: LanAttachmentKind, durationMs?: number) => {
		await runtime.sendFiles(files, { kind: forcedKind, durationMs })
	}, [runtime])

	return {
		messages: chat.messages,
		fileRecords: chat.fileRecords,
		addSystemMessage: chat.addSystemMessage,
		attachPeer,
		detachPeer,
		resetSession,
		handlePeerData,
		resumeAfterConnect: runtime.resumeAfterConnect.bind(runtime),
		pauseTransfers: runtime.detachTransport.bind(runtime),
		pumpQueue: runtime.resumeAfterConnect.bind(runtime),
		sendText: runtime.sendText.bind(runtime),
		sendFiles,
		startReceivingAttachment: runtime.acceptAttachment.bind(runtime),
		clearFileRecord: runtime.clearReceivedFile.bind(runtime),
		downloadAttachment: runtime.downloadAttachment.bind(runtime),
	}
}
