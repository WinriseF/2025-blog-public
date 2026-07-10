import { hasChunk, type ChunkRange } from './storage/ranges'
import { LAN_LIMITS, type LanAttachmentKind, type LanControlMessage, type LanStorageKind, type PreparedLanAttachment } from './types'

const CONTROL_FRAME = 1
const CHUNK_FRAME = 2
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const crc32Table = Array.from({ length: 256 }, (_, index) => {
	let value = index
	for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
	return value >>> 0
})

function transferId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function receivedBytesFromRanges(file: PreparedLanAttachment, ranges: ChunkRange[]) {
	let total = 0
	for (const [start, end] of ranges) {
		for (let index = start; index <= end; index += 1) {
			const offset = index * file.chunkSize
			if (offset >= file.size) continue
			total += Math.min(file.chunkSize, file.size - offset)
		}
	}
	return total
}

function crc32Hex(bytes: Uint8Array) {
	let crc = 0xffffffff
	for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
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
	if (file.type.startsWith('image/')) return 'image'
	return 'file'
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

export interface LanConnectionTransport {
	isOpen(): boolean
	send(data: Uint8Array): boolean
	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number): Promise<void>
	waitUntilDrained(lowWatermark: number, timeoutMs: number): Promise<void>
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
	const chunkSize = Math.min(options.chunkSize || LAN_LIMITS.defaultChunkSize, LAN_LIMITS.dataChannelSafeChunkSize)
	const suggestedStorage = options.suggestedStorage || (file.size <= LAN_LIMITS.memoryMaxBytes ? 'memory' : 'opfs')
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
		suggestedStorage,
		file,
	} satisfies PreparedLanAttachment
}

export function encodeControl(message: LanControlMessage) {
	const body = encoder.encode(JSON.stringify(message))
	const frame = new Uint8Array(body.length + 1)
	frame[0] = CONTROL_FRAME
	frame.set(body, 1)
	return frame
}

export function encodeChunk(attachmentId: string, chunkIndex: number, bytes: Uint8Array) {
	const header = encoder.encode(JSON.stringify({ id: attachmentId, index: chunkIndex, checksum: crc32Hex(bytes) }))
	if (header.byteLength > 0xffff) throw new Error('文件发送失败，请重新发送')
	const frame = new Uint8Array(1 + 2 + header.byteLength + bytes.byteLength)
	frame[0] = CHUNK_FRAME
	frame[1] = (header.byteLength >> 8) & 0xff
	frame[2] = header.byteLength & 0xff
	frame.set(header, 3)
	frame.set(bytes, 3 + header.byteLength)
	return frame
}

function toBytes(data: unknown) {
	if (data instanceof ArrayBuffer) return new Uint8Array(data)
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	if (typeof data === 'string') return encoder.encode(data)
	return new Uint8Array()
}

export function decodeFrame(data: unknown) {
	const bytes = toBytes(data)
	if (!bytes.length) return null
	if (bytes[0] === CONTROL_FRAME) {
		try {
			return { kind: 'control' as const, message: JSON.parse(decoder.decode(bytes.slice(1))) as LanControlMessage }
		} catch {
			return null
		}
	}
	if (bytes[0] !== CHUNK_FRAME || bytes.byteLength < 3) return null
	const headerLength = (bytes[1] << 8) | bytes[2]
	const headerEnd = 3 + headerLength
	if (bytes.byteLength < headerEnd) return null
	let header: { id: string; index: number; checksum?: string }
	try {
		header = JSON.parse(decoder.decode(bytes.slice(3, headerEnd))) as { id: string; index: number; checksum?: string }
	} catch {
		return null
	}
	const chunk = bytes.slice(headerEnd)
	if (header.checksum && crc32Hex(chunk) !== header.checksum) return { kind: 'corrupt' as const, id: header.id }
	return { kind: 'chunk' as const, id: header.id, index: header.index, bytes: chunk }
}

async function waitForReceiverWindow(getAckedBytes: (() => number) | undefined, sent: number, maxAheadBytes: number) {
	if (!getAckedBytes) return
	const startedAt = Date.now()
	while (sent - getAckedBytes() > maxAheadBytes) {
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error('对方接收太慢，请保持页面打开并确认空间充足')
		await new Promise(resolve => window.setTimeout(resolve, 100))
	}
}

export async function sendPreparedAttachment(
	transport: LanConnectionTransport,
	file: PreparedLanAttachment,
	onProgress: (sent: number) => void,
	options: { mobile?: boolean; getAckedBytes?: () => number; maxAheadBytes?: number; receivedRanges?: ChunkRange[]; completeMessage: LanControlMessage },
) {
	const highWatermark = options.mobile ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark
	const lowWatermark = options.mobile ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark
	const maxAheadBytes = options.maxAheadBytes || (options.mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes)
	const receivedRanges = options.receivedRanges || []
	let sent = receivedBytesFromRanges(file, receivedRanges)
	onProgress(Math.min(file.size, sent))
	for (let chunkIndex = 0; chunkIndex < file.chunkCount; chunkIndex += 1) {
		if (hasChunk(receivedRanges, chunkIndex)) continue
		await waitForReceiverWindow(options.getAckedBytes, sent, maxAheadBytes)
		await transport.waitUntilWritable(highWatermark, lowWatermark, LAN_LIMITS.bufferDrainTimeoutMs)
		const offset = chunkIndex * file.chunkSize
		if (offset >= file.size) continue
		const blob = file.file.slice(offset, Math.min(offset + file.chunkSize, file.size))
		const chunk = new Uint8Array(await blob.arrayBuffer())
		const frame = encodeChunk(file.id, chunkIndex, chunk)
		if (frame.byteLength > 64 * 1024) throw new Error('文件发送失败，请重新发送')
		if (!transport.isOpen() || !transport.send(frame)) throw new Error('连接已断开，请重新连接后再发送')
		sent += chunk.byteLength
		onProgress(Math.min(file.size, sent))
	}
	await waitForReceiverWindow(options.getAckedBytes, sent, maxAheadBytes)
	await transport.waitUntilDrained(lowWatermark, LAN_LIMITS.bufferDrainTimeoutMs)
	if (!transport.isOpen() || !transport.send(encodeControl(options.completeMessage))) throw new Error('连接已断开，请重新连接后再发送')
}

export function downloadUrl(name: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = name || 'received-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
}
