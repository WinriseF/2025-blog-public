import { hasChunk, type ChunkRange } from './storage/ranges'
import { LAN_CHUNK_TIERS, LAN_LIMITS, type LanAttachmentKind, type LanControlMessage, type LanStorageKind, type PreparedLanAttachment } from './types'
import type { LanConnectionTransport } from './transport-types'

const FILE_READ_BATCH_BYTES = 4 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function transferId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function receivedBytesFromRanges(file: PreparedLanAttachment, ranges: ChunkRange[]) {
	let total = 0
	for (const [start, end] of ranges) for (let index = start; index <= end; index += 1) {
		const offset = index * file.chunkSize
		if (offset < file.size) total += Math.min(file.chunkSize, file.size - offset)
	}
	return total
}

export function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes)) return '未知'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`
	return `${(bytes / 1024 / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 * 1024 ? 2 : 1)} GB`
}

export function messageId() {
	return transferId()
}

export function attachmentKindForFile(file: File): LanAttachmentKind {
	return file.type.startsWith('image/') ? 'image' : 'file'
}

export type PrepareLanAttachmentOptions = {
	messageId: string
	kind?: LanAttachmentKind
	chunkSize?: number
	suggestedStorage?: LanStorageKind
	maxBytes?: number
	durationMs?: number
	name?: string
}

export function fileFromBlob(blob: Blob, name: string, lastModified = Date.now()) {
	return new File([blob], name, { type: blob.type || 'application/octet-stream', lastModified })
}

export async function imagePreviewUrl(file: File) {
	if (!file.type.startsWith('image/') || file.size > LAN_LIMITS.imageInlinePreviewBytes) return ''
	return URL.createObjectURL(file)
}

export function prepareLanAttachment(file: File, options: PrepareLanAttachmentOptions) {
	const maxBytes = options.maxBytes || LAN_LIMITS.experimentalMaxBytes
	if (file.size > maxBytes) throw new Error(`对方最多可接收 ${formatBytes(maxBytes)}`)
	const requested = Math.min(options.chunkSize || LAN_LIMITS.defaultChunkSize, LAN_LIMITS.dataChannelMaxChunkSize)
	const chunkSize = LAN_CHUNK_TIERS.find(tier => tier.chunkSize <= requested)?.chunkSize || LAN_LIMITS.dataChannelFallbackChunkSize
	return {
		id: transferId(),
		messageId: options.messageId,
		kind: options.kind || attachmentKindForFile(file),
		name: options.name || file.name || 'received-file',
		mime: file.type || 'application/octet-stream',
		size: file.size,
		lastModified: file.lastModified || Date.now(),
		durationMs: options.durationMs,
		chunkSize,
		chunkCount: Math.ceil(file.size / chunkSize),
		suggestedStorage: options.suggestedStorage || (file.size <= LAN_LIMITS.memoryMaxBytes ? 'memory' : 'opfs'),
		file,
	} satisfies PreparedLanAttachment
}

export function encodeControl(message: LanControlMessage) {
	return encoder.encode(JSON.stringify(message))
}

export function decodeControl(data: unknown) {
	const bytes = toBytes(data)
	if (!bytes.length) return null
	try {
		return JSON.parse(decoder.decode(bytes)) as LanControlMessage
	} catch {
		return null
	}
}

export function encodeChunk(attachmentId: string, chunkIndex: number, bytes: Uint8Array) {
	const header = encoder.encode(JSON.stringify({ id: attachmentId, index: chunkIndex }))
	if (header.byteLength > 0xffff) throw new Error('文件发送失败，请重新发送')
	const frame = new Uint8Array(2 + header.byteLength + bytes.byteLength)
	frame[0] = (header.byteLength >> 8) & 0xff
	frame[1] = header.byteLength & 0xff
	frame.set(header, 2)
	frame.set(bytes, 2 + header.byteLength)
	return frame
}

export function decodeChunk(data: unknown) {
	const bytes = toBytes(data)
	if (bytes.byteLength < 2) return null
	const headerLength = (bytes[0] << 8) | bytes[1]
	const headerEnd = 2 + headerLength
	if (!headerLength || bytes.byteLength < headerEnd) return null
	try {
		const header = JSON.parse(decoder.decode(bytes.subarray(2, headerEnd))) as { id?: unknown; index?: unknown }
		if (typeof header.id !== 'string' || typeof header.index !== 'number') return null
		return { id: header.id, index: header.index, bytes: bytes.subarray(headerEnd) }
	} catch {
		return null
	}
}

function toBytes(data: unknown) {
	if (data instanceof ArrayBuffer) return new Uint8Array(data)
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	if (typeof data === 'string') return encoder.encode(data)
	return new Uint8Array()
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('发送已暂停', 'AbortError')
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
	if (!signal) return promise
	throwIfAborted(signal)
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new DOMException('发送已暂停', 'AbortError'))
		signal.addEventListener('abort', abort, { once: true })
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
	})
}

export type LanSenderFlowState = {
	committedBytes: number
	receiveWindowBytes: number
	pausedReason?: string
}

async function waitForReceiverWindow(getFlowState: (() => LanSenderFlowState) | undefined, sent: number, nextBytes: number, maxAheadBytes: number, signal?: AbortSignal) {
	if (!getFlowState) return
	const startedAt = Date.now()
	while (true) {
		throwIfAborted(signal)
		const state = getFlowState()
		const ahead = Math.max(0, sent - state.committedBytes)
		const windowBytes = Math.min(maxAheadBytes, Math.max(0, state.receiveWindowBytes))
		if (windowBytes > 0 && ahead + nextBytes <= windowBytes) return
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error(state.pausedReason || '对方接收太慢，请保持页面打开并确认磁盘可写')
		await abortable(new Promise(resolve => window.setTimeout(resolve, 80)), signal)
	}
}

export async function sendPreparedAttachment(
	transport: LanConnectionTransport,
	file: PreparedLanAttachment,
	onProgress: (sent: number) => void,
	options: {
		mobile?: boolean
		getFlowState?: () => LanSenderFlowState
		receivedRanges?: ChunkRange[]
		signal?: AbortSignal
		completeMessage: LanControlMessage
	},
) {
	const high = options.mobile ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark
	const low = options.mobile ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark
	const maxAhead = options.mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes
	const receivedRanges = options.receivedRanges || []
	let sent = receivedBytesFromRanges(file, receivedRanges)
	let readBatchOffset = -1
	let readBatch = new Uint8Array()
	onProgress(Math.min(file.size, sent))
	for (let chunkIndex = 0; chunkIndex < file.chunkCount; chunkIndex += 1) {
		throwIfAborted(options.signal)
		if (hasChunk(receivedRanges, chunkIndex)) continue
		const offset = chunkIndex * file.chunkSize
		if (offset >= file.size) continue
		const chunkEnd = Math.min(offset + file.chunkSize, file.size)
		await waitForReceiverWindow(options.getFlowState, sent, chunkEnd - offset, maxAhead, options.signal)
		await abortable(transport.waitUntilDataWritable(high, low, LAN_LIMITS.bufferDrainTimeoutMs), options.signal)
		if (readBatchOffset < 0 || offset < readBatchOffset || chunkEnd > readBatchOffset + readBatch.byteLength) {
			readBatchOffset = offset
			readBatch = new Uint8Array(await file.file.slice(offset, Math.min(offset + FILE_READ_BATCH_BYTES, file.size)).arrayBuffer())
			throwIfAborted(options.signal)
		}
		const chunk = readBatch.subarray(offset - readBatchOffset, chunkEnd - readBatchOffset)
		const frame = encodeChunk(file.id, chunkIndex, chunk)
		if (frame.byteLength > file.chunkSize + LAN_LIMITS.dataChannelFrameHeaderReserve || frame.byteLength > LAN_LIMITS.dataChannelMaxFrameSize) throw new Error('文件发送失败，请重新发送')
		if (!transport.sendData(frame)) throw new Error('连接已断开，请重新连接后再发送')
		sent += chunk.byteLength
		onProgress(Math.min(file.size, sent))
	}
	await waitForReceiverWindow(options.getFlowState, sent, 0, maxAhead, options.signal)
	await abortable(transport.waitUntilDataDrained(low, LAN_LIMITS.bufferDrainTimeoutMs), options.signal)
	throwIfAborted(options.signal)
	if (!transport.sendControl(encodeControl(options.completeMessage))) throw new Error('连接已断开，请重新连接后再发送')
}

export function downloadUrl(name: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = name || 'received-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
}
