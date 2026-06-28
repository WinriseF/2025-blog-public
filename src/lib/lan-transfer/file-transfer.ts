import type SimplePeer from 'simple-peer'
import { zipSync } from 'fflate'
import { LAN_LIMITS, type LanControlMessage, type PreparedLanFile } from './types'

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
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`
}

export async function prepareLanFiles(files: File[]) {
	if (!files.length) throw new Error('请先选择文件')
	const totalSize = files.reduce((sum, file) => sum + file.size, 0)
	if (totalSize > LAN_LIMITS.maxBytes) throw new Error(`局域网互传单次最多 ${formatBytes(LAN_LIMITS.maxBytes)}`)

	if (files.length === 1) {
		const file = files[0]
		const bytes = new Uint8Array(await file.arrayBuffer())
		return {
			id: transferId(),
			name: file.name || 'lan-transfer-file',
			mime: file.type || 'application/octet-stream',
			size: bytes.byteLength,
			fileCount: 1,
			chunkCount: Math.ceil(bytes.byteLength / LAN_LIMITS.chunkSize),
			bytes
		} satisfies PreparedLanFile
	}

	const used = new Set<string>()
	const entries: Record<string, Uint8Array> = {}
	for (const file of files) entries[uniqueName(file.name, used)] = new Uint8Array(await file.arrayBuffer())
	const bytes = zipSync(entries, { level: 0 })
	return {
		id: transferId(),
		name: timestampName(),
		mime: 'application/zip',
		size: bytes.byteLength,
		fileCount: files.length,
		chunkCount: Math.ceil(bytes.byteLength / LAN_LIMITS.chunkSize),
		bytes
	} satisfies PreparedLanFile
}

export function encodeControl(message: LanControlMessage) {
	const body = encoder.encode(JSON.stringify(message))
	const frame = new Uint8Array(body.length + 1)
	frame[0] = CONTROL_FRAME
	frame.set(body, 1)
	return frame
}

export function encodeChunk(bytes: Uint8Array) {
	const frame = new Uint8Array(bytes.byteLength + 1)
	frame[0] = CHUNK_FRAME
	frame.set(bytes, 1)
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
	if (bytes[0] === CHUNK_FRAME) return { kind: 'chunk' as const, bytes: bytes.slice(1) }
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

async function waitForBufferedAmount(peer: SimplePeer.Instance) {
	const startedAt = Date.now()
	let channel = getOpenDataChannel(peer)
	channel.bufferedAmountLowThreshold = LAN_LIMITS.bufferLowWatermark
	while (channel.bufferedAmount > LAN_LIMITS.bufferHighWatermark) {
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error('发送缓冲区长时间未释放，可能是对方页面已断开或手机浏览器被系统暂停')
		await new Promise<void>((resolve, reject) => {
			let done = false
			const cleanup = () => {
				channel.removeEventListener('bufferedamountlow', onLow)
				channel.removeEventListener('close', onClose)
				channel.removeEventListener('error', onClose)
				window.clearTimeout(timer)
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
			const timer = window.setTimeout(finish, 120)
			channel.addEventListener('bufferedamountlow', onLow)
			channel.addEventListener('close', onClose, { once: true })
			channel.addEventListener('error', onClose, { once: true })
		})
		channel = getOpenDataChannel(peer)
	}
}

async function waitForLowWatermark(peer: SimplePeer.Instance) {
	const startedAt = Date.now()
	let channel = getOpenDataChannel(peer)
	channel.bufferedAmountLowThreshold = LAN_LIMITS.bufferLowWatermark
	while (channel.bufferedAmount > LAN_LIMITS.bufferLowWatermark) {
		if (Date.now() - startedAt > LAN_LIMITS.bufferDrainTimeoutMs) throw new Error('发送队列没有及时清空，请确认对方设备页面仍在前台')
		await new Promise<void>((resolve, reject) => {
			let done = false
			const cleanup = () => {
				channel.removeEventListener('bufferedamountlow', onLow)
				channel.removeEventListener('close', onClose)
				channel.removeEventListener('error', onClose)
				window.clearTimeout(timer)
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
			const timer = window.setTimeout(finish, 120)
			channel.addEventListener('bufferedamountlow', onLow)
			channel.addEventListener('close', onClose, { once: true })
			channel.addEventListener('error', onClose, { once: true })
		})
		channel = getOpenDataChannel(peer)
	}
}

export async function sendPreparedFile(peer: SimplePeer.Instance, file: PreparedLanFile, onProgress: (sent: number) => void) {
	for (let offset = 0; offset < file.bytes.byteLength; offset += LAN_LIMITS.chunkSize) {
		await waitForBufferedAmount(peer)
		const chunk = file.bytes.subarray(offset, Math.min(offset + LAN_LIMITS.chunkSize, file.bytes.byteLength))
		getOpenDataChannel(peer)
		peer.send(encodeChunk(chunk))
		onProgress(Math.min(offset + chunk.byteLength, file.bytes.byteLength))
	}
	await waitForLowWatermark(peer)
	peer.send(
		encodeControl({
			type: 'transfer-complete',
			id: file.id,
			sent: file.bytes.byteLength,
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
