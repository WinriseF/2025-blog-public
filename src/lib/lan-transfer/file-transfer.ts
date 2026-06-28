import type SimplePeer from 'simple-peer'
import { zipSync } from 'fflate'
import { LAN_LIMITS, type LanControlMessage, type LanStorageKind, type PreparedLanFile } from './types'

const CONTROL_FRAME = 1
const CHUNK_FRAME = 2
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function transferId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function uniqueName(name: string, used: Set<string>) {
	const fallback = name || 'file'
	if (!used.has(fallback)) {
		used.add(fallback)
		return fallback
	}
	const dot = fallback.lastIndexOf('.')
	const base = dot > 0 ? fallback.slice(0, dot) : fallback
	const ext = dot > 0 ? fallback.slice(dot) : ''
	for (let index = 2; ; index += 1) {
		const next = `${base}-${index}${ext}`
		if (!used.has(next)) {
			used.add(next)
			return next
		}
	}
}

function timestampName() {
	const value = new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\..+$/, '')
		.replace('T', '-')
	return `winrisef-lan-${value}.zip`
}

export function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes)) return '未知'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`
	return `${(bytes / 1024 / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 * 1024 ? 2 : 1)} GB`
}

function safeBlobPart(bytes: Uint8Array) {
	return bytes as unknown as BlobPart
}

export type PrepareLanFileOptions = {
	chunkSize?: number
	suggestedStorage?: LanStorageKind
	maxBytes?: number
}

export async function prepareLanFiles(files: File[], options: PrepareLanFileOptions = {}) {
	if (!files.length) throw new Error('请先选择文件')
	const totalSize = files.reduce((sum, file) => sum + file.size, 0)
	const maxBytes = options.maxBytes || LAN_LIMITS.experimentalMaxBytes
	if (totalSize > maxBytes) throw new Error(`当前接收设备最多建议 ${formatBytes(maxBytes)}`)
	const chunkSize = options.chunkSize || LAN_LIMITS.defaultChunkSize
	const suggestedStorage = options.suggestedStorage || (totalSize <= LAN_LIMITS.memoryMaxBytes ? 'memory' : 'opfs')

	if (files.length === 1) {
		const file = files[0]
		return {
			id: transferId(),
			name: file.name || 'lan-transfer-file',
			mime: file.type || 'application/octet-stream',
			size: file.size,
			fileCount: 1,
			lastModified: file.lastModified || Date.now(),
			chunkSize,
			chunkCount: Math.ceil(file.size / chunkSize),
			file,
			suggestedStorage
		} satisfies PreparedLanFile
	}

	if (totalSize > LAN_LIMITS.multiFileZipMaxBytes) throw new Error(`多文件浏览器端 ZIP 打包最多 ${formatBytes(LAN_LIMITS.multiFileZipMaxBytes)}。超大多文件请先在系统文件管理器打包后再发送。`)
	const used = new Set<string>()
	const entries: Record<string, Uint8Array> = {}
	for (const file of files) entries[uniqueName(file.name, used)] = new Uint8Array(await file.arrayBuffer())
	const bytes = zipSync(entries, { level: 0 })
	const zipFile = new File([safeBlobPart(bytes)], timestampName(), { type: 'application/zip', lastModified: Date.now() })
	return {
		id: transferId(),
		name: zipFile.name,
		mime: 'application/zip',
		size: zipFile.size,
		fileCount: files.length,
		lastModified: zipFile.lastModified,
		chunkSize,
		chunkCount: Math.ceil(zipFile.size / chunkSize),
		file: zipFile,
		suggestedStorage: zipFile.size <= LAN_LIMITS.memoryMaxBytes ? 'memory' : suggestedStorage
	} satisfies PreparedLanFile
}

export function encodeControl(message: LanControlMessage) {
	const body = encoder.encode(JSON.stringify(message))
	const frame = new Uint8Array(body.length + 1)
	frame[0] = CONTROL_FRAME
	frame.set(body, 1)
	return frame
}

export function encodeChunk(fileId: string, chunkIndex: number, bytes: Uint8Array) {
	const header = encoder.encode(JSON.stringify({ id: fileId, index: chunkIndex }))
	if (header.byteLength > 0xffff) throw new Error('分片头过大')
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
	if (bytes[0] === CONTROL_FRAME) return { kind: 'control' as const, message: JSON.parse(decoder.decode(bytes.slice(1))) as LanControlMessage }
	if (bytes[0] === CHUNK_FRAME) {
		if (bytes.byteLength < 3) return null
		const headerLength = (bytes[1] << 8) | bytes[2]
		const headerEnd = 3 + headerLength
		if (bytes.byteLength < headerEnd) return null
		const header = JSON.parse(decoder.decode(bytes.slice(3, headerEnd))) as { id: string; index: number }
		return { kind: 'chunk' as const, id: header.id, index: header.index, bytes: bytes.slice(headerEnd) }
	}
	return null
}

function getDataChannel(peer: SimplePeer.Instance) {
	return (peer as unknown as { _channel?: RTCDataChannel })._channel
}

function getOpenDataChannel(peer: SimplePeer.Instance) {
	const channel = getDataChannel(peer)
	if (!channel || channel.readyState !== 'open') throw new Error('点对点通道已断开，请重新连接后再发送')
	return channel
}

async function waitForChannelBelow(peer: SimplePeer.Instance, highWatermark: number, lowWatermark: number) {
	const startedAt = Date.now()
	let channel = getOpenDataChannel(peer)
	channel.bufferedAmountLowThreshold = lowWatermark
	while (channel.bufferedAmount > highWatermark) {
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error('发送缓冲区长时间未释放，可能是对方页面已断开、锁屏或切到后台')
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
				reject(new Error('点对点通道已断开，请重新连接后再发送'))
			}
			const onLow = () => finish()
			const onClose = () => fail()
			timer = window.setTimeout(finish, 250)
			channel.addEventListener('bufferedamountlow', onLow)
			channel.addEventListener('close', onClose, { once: true })
			channel.addEventListener('error', onClose, { once: true })
		})
		channel = getOpenDataChannel(peer)
	}
}

async function waitForLowWatermark(peer: SimplePeer.Instance, lowWatermark: number) {
	const startedAt = Date.now()
	let channel = getOpenDataChannel(peer)
	channel.bufferedAmountLowThreshold = lowWatermark
	while (channel.bufferedAmount > lowWatermark) {
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error('发送队列没有及时清空，请确认对方设备页面仍在前台')
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
				reject(new Error('点对点通道已断开，请重新连接后再发送'))
			}
			const onLow = () => finish()
			const onClose = () => fail()
			timer = window.setTimeout(finish, 250)
			channel.addEventListener('bufferedamountlow', onLow)
			channel.addEventListener('close', onClose, { once: true })
			channel.addEventListener('error', onClose, { once: true })
		})
		channel = getOpenDataChannel(peer)
	}
}

export async function sendPreparedFile(
	peer: SimplePeer.Instance,
	file: PreparedLanFile,
	onProgress: (sent: number) => void,
	options: { mobile?: boolean } = {}
) {
	const highWatermark = options.mobile ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark
	const lowWatermark = options.mobile ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark
	let sent = 0
	for (let chunkIndex = 0; chunkIndex < file.chunkCount; chunkIndex += 1) {
		await waitForChannelBelow(peer, highWatermark, lowWatermark)
		const offset = chunkIndex * file.chunkSize
		if (offset >= file.size) continue
		const blob = file.file.slice(offset, Math.min(offset + file.chunkSize, file.size))
		const chunk = new Uint8Array(await blob.arrayBuffer())
		getOpenDataChannel(peer)
		peer.send(encodeChunk(file.id, chunkIndex, chunk))
		sent += chunk.byteLength
		onProgress(Math.min(file.size, sent))
	}
	await waitForLowWatermark(peer, lowWatermark)
	peer.send(
		encodeControl({
			type: 'transfer-complete',
			id: file.id,
			sent: file.size,
			chunkCount: file.chunkCount
		})
	)
}

export function downloadUrl(name: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = name || 'lan-transfer-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
}
