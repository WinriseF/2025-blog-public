import { hasChunk, type ChunkRange } from './storage/ranges'
import { LAN_CHUNK_TIERS, LAN_FILE_IO_BATCH_BYTES, LAN_LIMITS, type LanAttachmentKind, type LanControlMessage, type LanStorageKind, type PreparedLanAttachment } from './types'

const CONTROL_FRAME = 1
const CHUNK_FRAME = 2
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function transferId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function receivedBytesFromRanges(file: PreparedLanAttachment, ranges: ChunkRange[]) {
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
	const requestedChunkSize = Math.min(options.chunkSize || LAN_LIMITS.defaultChunkSize, LAN_LIMITS.dataChannelMaxChunkSize)
	const chunkSize = LAN_CHUNK_TIERS.find(tier => tier.chunkSize <= requestedChunkSize)?.chunkSize || LAN_LIMITS.dataChannelFallbackChunkSize
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
	const header = encoder.encode(JSON.stringify({ id: attachmentId, index: chunkIndex }))
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
	let header: { id: string; index: number }
	try {
		header = JSON.parse(decoder.decode(bytes.slice(3, headerEnd))) as { id: string; index: number }
	} catch {
		return null
	}
	const chunk = bytes.subarray(headerEnd)
	return { kind: 'chunk' as const, id: header.id, index: header.index, bytes: chunk }
}

export function nextMissingChunkIndex(file: PreparedLanAttachment, receivedRanges: ChunkRange[], fromIndex: number) {
	for (let index = Math.max(0, fromIndex); index < file.chunkCount; index += 1) {
		if (!hasChunk(receivedRanges, index)) return index
	}
	return -1
}

export class LanAttachmentChunkReader {
	private batchOffset = -1
	private batch = new Uint8Array()

	constructor(private readonly file: PreparedLanAttachment) {}

	async read(chunkIndex: number, signal?: AbortSignal) {
		if (signal?.aborted) throw new DOMException('发送已暂停', 'AbortError')
		const offset = chunkIndex * this.file.chunkSize
		if (offset >= this.file.size) return new Uint8Array()
		const chunkEnd = Math.min(offset + this.file.chunkSize, this.file.size)
		if (this.batchOffset < 0 || offset < this.batchOffset || chunkEnd > this.batchOffset + this.batch.byteLength) {
			this.batchOffset = offset
			this.batch = new Uint8Array(await this.file.file.slice(offset, Math.min(offset + LAN_FILE_IO_BATCH_BYTES, this.file.size)).arrayBuffer())
			if (signal?.aborted) throw new DOMException('发送已暂停', 'AbortError')
		}
		const chunkOffset = offset - this.batchOffset
		return this.batch.subarray(chunkOffset, chunkOffset + chunkEnd - offset)
	}

	clear() {
		this.batchOffset = -1
		this.batch = new Uint8Array()
	}
}

export function downloadUrl(name: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = name || 'received-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
}
