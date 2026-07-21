import type { LanNativePeerBulkPort } from './ports'
import type { LanNativeFileDirection, LanNativeTransferGrant } from './types'
import { NATIVE_AGENT_FILE_VERSION } from './types'
import { selectLocalNetworkAccessFileEndpoint } from './peer-lna-http'
import { NativeFileStorageWriter, NATIVE_FILE_IO_BLOCK_BYTES } from './native-storage-writer'
import { validLanFileWebTransportEndpoint } from './endpoint-validation'
import { createPinnedWebTransport, ExactStreamReader, invalidatePinnedWebTransportEndpoint, readU64, selectPinnedWebTransportEndpoint, withTimeout, writeU64, type WebTransportLike } from './webtransport'

const LNA_SEGMENT_BYTES = 30 * 1024 * 1024
const LNA_WORKERS = 6
const WT_CONNECTIONS = 6
const WT_LANES = 4
const WT_EXTENT_BYTES = 64 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000
const END_OFFSET_HIGH = 0xffff_ffff
const END_OFFSET_LOW = 0xffff_ffff
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type DownloadOptions = Parameters<LanNativePeerBulkPort['download']>[0]
type UploadOptions = Parameters<LanNativePeerBulkPort['upload']>[0]
type NativeFileOptions = DownloadOptions | UploadOptions
type FileWtConnection = {
	transport: WebTransportLike
	controlWriter: WritableStreamDefaultWriter<Uint8Array>
	controlReader: ExactStreamReader
	index: number
}

export class LanNativePeerBulkAdapter implements LanNativePeerBulkPort {
	async download(options: DownloadOptions) {
		if (options.grant.authorization.kind === 'lna-http') return downloadLna(options)
		return downloadWebTransport(options)
	}

	async upload(options: UploadOptions) {
		if (options.grant.authorization.kind === 'lna-http') return uploadLna(options)
		return uploadWebTransport(options)
	}
}

async function downloadLna(options: DownloadOptions) {
	const grant = options.grant
	if (grant.authorization.kind !== 'lna-http') throw new Error('极速 TCP 文件授权不完整')
	const token = grant.authorization.token
	const decision = await selectLocalNetworkAccessFileEndpoint(grant.fileHttpEndpoints)
	if (decision.state !== 'available') throw new Error(decision.state === 'denied' ? '本地网络访问权限已被拒绝' : '浏览器不支持本地网络访问')
	const segments = fileSegments(options.meta.size)
	const progress = progressReporter(segments.length, options.onProgress)
	const writer = new NativeFileStorageWriter(options.storage, options.meta)
	await runLnaDownloadRounds(segments, segment =>
		xhrDownload(decision.endpoint, grant.transferId, token, segment, options.signal, bytes => progress(segment.index, bytes)).then(async response => {
			await writer.write(segment.offset, response)
			progress(segment.index, segment.bytes)
		})
	)
	await writer.finish()
}

async function uploadLna(options: UploadOptions) {
	const grant = options.grant
	if (grant.authorization.kind !== 'lna-http') throw new Error('极速 TCP 文件授权不完整')
	const token = grant.authorization.token
	const decision = await selectLocalNetworkAccessFileEndpoint(grant.fileHttpEndpoints)
	if (decision.state !== 'available') throw new Error(decision.state === 'denied' ? '本地网络访问权限已被拒绝' : '浏览器不支持本地网络访问')
	const segments = fileSegments(options.file.size)
	const progress = progressReporter(segments.length, options.onProgress)
	await Promise.all(Array.from({ length: LNA_WORKERS }, (_, worker) => runLnaWorker(segments.filter(segment => segment.index % LNA_WORKERS === worker), segment =>
		xhrUpload(decision.endpoint, grant.transferId, token, options.file, segment, options.signal, bytes => progress(segment.index, bytes)).then(() => progress(segment.index, segment.bytes))
	)))
	await completeLnaUpload(decision.endpoint, grant.transferId, token, options.signal)
}

async function runLnaWorker(segments: FileSegment[], run: (segment: FileSegment) => Promise<void>) {
	for (const segment of segments) await run(segment)
}

async function runLnaDownloadRounds(segments: FileSegment[], run: (segment: FileSegment) => Promise<void>) {
	for (let first = 0; first < segments.length; first += LNA_WORKERS) {
		await Promise.all(segments.slice(first, first + LNA_WORKERS).map(run))
	}
}

type FileSegment = { index: number; offset: number; bytes: number }

function fileSegments(total: number) {
	const segments: FileSegment[] = []
	for (let offset = 0, index = 0; offset < total; offset += LNA_SEGMENT_BYTES, index += 1) segments.push({ index, offset, bytes: Math.min(LNA_SEGMENT_BYTES, total - offset) })
	return segments
}

function xhrDownload(endpoint: string, transferId: string, token: string, segment: FileSegment, signal: AbortSignal, onProgress: (bytes: number) => void) {
	return new Promise<ArrayBuffer>((resolve, reject) => {
		const url = segmentUrl(endpoint, transferId, segment.offset, segment.bytes)
		const xhr = new XMLHttpRequest()
		xhr.open('GET', url)
		if (signal.aborted) return reject(new Error('极速文件传输已取消'))
		xhr.responseType = 'arraybuffer'
		xhr.timeout = REQUEST_TIMEOUT_MS
		xhr.setRequestHeader('X-WinriseF-Transfer-Token', token)
		const cleanup = bindXhrAbort(xhr, signal, reject)
		xhr.onprogress = event => onProgress(Math.min(segment.bytes, event.loaded))
		xhr.onerror = () => { cleanup(); reject(new Error('极速 TCP 文件下载连接失败')) }
		xhr.ontimeout = () => { cleanup(); reject(new Error('极速 TCP 文件下载超时')) }
		xhr.onload = () => {
			cleanup()
			if (xhr.status !== 200) return reject(httpFileError(xhr))
			if (!(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength !== segment.bytes) return reject(new Error('Agent 返回的文件 segment 长度不一致'))
			resolve(xhr.response)
		}
		xhr.send()
	})
}

function xhrUpload(endpoint: string, transferId: string, token: string, file: File, segment: FileSegment, signal: AbortSignal, onProgress: (bytes: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', segmentUrl(endpoint, transferId, segment.offset))
		if (signal.aborted) return reject(new Error('极速文件传输已取消'))
		xhr.responseType = 'json'
		xhr.timeout = REQUEST_TIMEOUT_MS
		xhr.setRequestHeader('X-WinriseF-Transfer-Token', token)
		const cleanup = bindXhrAbort(xhr, signal, reject)
		xhr.upload.onprogress = event => onProgress(Math.min(segment.bytes, event.loaded))
		xhr.onerror = () => { cleanup(); reject(new Error('极速 TCP 文件上传连接失败')) }
		xhr.ontimeout = () => { cleanup(); reject(new Error('极速 TCP 文件上传超时')) }
		xhr.onload = () => {
			cleanup()
			if (xhr.status !== 200) return reject(httpFileError(xhr))
			resolve()
		}
		xhr.send(file.slice(segment.offset, segment.offset + segment.bytes))
	})
}

async function completeLnaUpload(endpoint: string, transferId: string, token: string, signal: AbortSignal) {
	const url = new URL(endpoint)
	url.pathname = `${url.pathname}/transfers/${transferId}/complete`
	const response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', signal, headers: { 'X-WinriseF-Transfer-Token': token } })
	if (response.status !== 204) throw new Error(`Agent 无法完成极速 TCP 文件（${response.status}）`)
}

async function downloadWebTransport(options: DownloadOptions) {
	const totalBytes = options.meta.size
	const connections = await openWtConnections(options, 'agent-to-browser', totalBytes)
	const abort = () => connections.forEach(connection => connection.transport.close({ closeCode: 1, reason: 'cancelled' }))
	options.signal.addEventListener('abort', abort, { once: true })
	const writer = new NativeFileStorageWriter(options.storage, options.meta)
	let transferred = 0
	try {
		await Promise.all(connections.map(async connection => {
			const incoming = connection.transport.incomingUnidirectionalStreams.getReader()
			const seenLanes = new Set<number>()
			try {
				await Promise.all(Array.from({ length: WT_LANES }, async () => {
					const next = await incoming.read()
					if (next.done) throw new Error('极速 QUIC 文件 lane 不完整')
					const reader = new ExactStreamReader(next.value)
					const laneHeader = await reader.readExact(2)
					const laneIndex = new DataView(laneHeader.buffer, laneHeader.byteOffset, laneHeader.byteLength).getUint16(0)
					if (seenLanes.has(laneIndex)) throw new Error('极速 QUIC 文件 lane 重复')
					seenLanes.add(laneIndex)
					await receiveWtLane(reader, connection.index, laneIndex, totalBytes, async (offset, bytes) => {
						await writer.write(offset, bytes)
						transferred += bytes.byteLength
						options.onProgress(transferred)
					})
				}))
			} finally {
				incoming.releaseLock()
			}
			await expectControl(connection.controlReader, 'payload-complete')
		}))
		await writer.finish()
	} finally {
		options.signal.removeEventListener('abort', abort)
		connections.forEach(connection => connection.transport.close({ closeCode: 0, reason: 'file complete' }))
	}
}

async function uploadWebTransport(options: UploadOptions) {
	const totalBytes = options.file.size
	const connections = await openWtConnections(options, 'browser-to-agent', totalBytes)
	const abort = () => connections.forEach(connection => connection.transport.close({ closeCode: 1, reason: 'cancelled' }))
	options.signal.addEventListener('abort', abort, { once: true })
	let transferred = 0
	try {
		await Promise.all(connections.map(async connection => {
			await Promise.all(Array.from({ length: WT_LANES }, async (_, laneIndex) => {
				const stream = await connection.transport.createUnidirectionalStream()
				const writer = stream.getWriter()
				await writer.write(u16Bytes(laneIndex))
				for (const segment of assignedWtExtents(totalBytes, connection.index, laneIndex)) {
					await writer.write(extentHeader(segment.offset, segment.bytes))
					for (let blockOffset = 0; blockOffset < segment.bytes; blockOffset += NATIVE_FILE_IO_BLOCK_BYTES) {
						const bytes = Math.min(NATIVE_FILE_IO_BLOCK_BYTES, segment.bytes - blockOffset)
						const block = new Uint8Array(await options.file.slice(segment.offset + blockOffset, segment.offset + blockOffset + bytes).arrayBuffer())
						await writer.write(block)
						transferred += bytes
						options.onProgress(transferred)
					}
				}
				await writer.write(endExtentHeader())
				await writer.close()
			}))
			await expectControl(connection.controlReader, 'payload-complete')
		}))
		const primary = connections[0]!
		await writeControl(primary.controlWriter, { type: 'complete' })
		await expectControl(primary.controlReader, 'transfer-complete')
	} finally {
		options.signal.removeEventListener('abort', abort)
		connections.forEach(connection => connection.transport.close({ closeCode: 0, reason: 'file complete' }))
	}
}

async function openWtConnections(options: NativeFileOptions, direction: LanNativeFileDirection, totalBytes: number) {
	const grant = options.grant
	if (grant.authorization.kind !== 'web-transport' || grant.authorization.tokens.length !== WT_CONNECTIONS) throw new Error('极速 QUIC 文件授权不完整')
	const endpoint = await selectPinnedWebTransportEndpoint({
		endpoints: grant.fileWebTransportEndpoints,
		certificateSha256: grant.certificateSha256,
		networkEpoch: grant.networkEpoch,
		validate: validLanFileWebTransportEndpoint,
		signal: options.signal,
	})
	const attempts = await Promise.allSettled(grant.authorization.tokens.map(async (token, index): Promise<FileWtConnection> => {
		if (options.signal.aborted) throw new Error('极速文件传输已取消')
		const transport = createPinnedWebTransport(endpoint, grant.certificateSha256)
		try {
			await withTimeout(transport.ready, 4_000, '连接极速 QUIC 文件通道超时')
			const control = await transport.createBidirectionalStream()
			const controlWriter = control.writable.getWriter()
			const controlReader = new ExactStreamReader(control.readable)
			await writeControl(controlWriter, {
				type: 'hello',
				version: NATIVE_AGENT_FILE_VERSION,
				transferId: grant.transferId,
				token,
				connectionIndex: index,
				direction,
				peerDeviceId: options.peerDeviceId,
				lanes: WT_LANES,
				blockBytes: NATIVE_FILE_IO_BLOCK_BYTES,
				extentBytes: WT_EXTENT_BYTES,
				totalBytes,
			})
			const ack = await withTimeout(readControl(controlReader), 5_000, '极速 QUIC 文件授权握手超时') as { type?: string; accepted?: boolean; error?: string; connectionIndex?: number }
			if (ack.type !== 'hello-ack' || !ack.accepted || ack.connectionIndex !== index) throw new Error(ack.error || 'Agent 拒绝了极速 QUIC 文件连接')
			return { transport, controlWriter, controlReader, index }
		} catch (error) {
			transport.close({ closeCode: 1, reason: 'file connection failed' })
			throw error
		}
	}))
	const connections = attempts.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
	const failed = attempts.find(result => result.status === 'rejected')
	if (failed?.status === 'rejected') {
		invalidatePinnedWebTransportEndpoint(grant.certificateSha256, grant.networkEpoch)
		connections.forEach(connection => connection.transport.close({ closeCode: 1, reason: 'file connection group failed' }))
		throw failed.reason
	}
	return connections
}

async function receiveWtLane(reader: ExactStreamReader, connectionIndex: number, laneIndex: number, totalBytes: number, write: (offset: number, bytes: Uint8Array) => Promise<void>) {
	if (laneIndex >= WT_LANES) throw new Error('极速 QUIC lane 编号无效')
	const expected = assignedWtExtents(totalBytes, connectionIndex, laneIndex)
	for (const segment of expected) {
		const header = await reader.readExact(16)
		const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
		if (readU64(view, 0) !== segment.offset || readU64(view, 8) !== segment.bytes) throw new Error('极速 QUIC extent 覆盖不一致')
		for (let blockOffset = 0; blockOffset < segment.bytes; blockOffset += NATIVE_FILE_IO_BLOCK_BYTES) {
			const bytes = await reader.readExact(Math.min(NATIVE_FILE_IO_BLOCK_BYTES, segment.bytes - blockOffset))
			await write(segment.offset + blockOffset, bytes)
		}
	}
	const end = await reader.readExact(16)
	const endView = new DataView(end.buffer, end.byteOffset, end.byteLength)
	if (endView.getUint32(0) !== END_OFFSET_HIGH || endView.getUint32(4) !== END_OFFSET_LOW || readU64(endView, 8) !== 0) throw new Error('极速 QUIC lane 结束标记无效')
	reader.release()
}

function assignedWtExtents(totalBytes: number, connectionIndex: number, laneIndex: number) {
	const result: Array<{ offset: number; bytes: number }> = []
	const first = connectionIndex * WT_LANES + laneIndex
	const stride = WT_CONNECTIONS * WT_LANES
	for (let extent = first; extent * WT_EXTENT_BYTES < totalBytes; extent += stride) {
		const offset = extent * WT_EXTENT_BYTES
		result.push({ offset, bytes: Math.min(WT_EXTENT_BYTES, totalBytes - offset) })
	}
	return result
}

function extentHeader(offset: number, bytes: number) {
	const header = new Uint8Array(16)
	const view = new DataView(header.buffer)
	writeU64(view, 0, offset)
	writeU64(view, 8, bytes)
	return header
}

function endExtentHeader() {
	const header = new Uint8Array(16)
	const view = new DataView(header.buffer)
	view.setUint32(0, END_OFFSET_HIGH)
	view.setUint32(4, END_OFFSET_LOW)
	return header
}

function u16Bytes(value: number) {
	const bytes = new Uint8Array(2)
	new DataView(bytes.buffer).setUint16(0, value)
	return bytes
}

async function writeControl(writer: WritableStreamDefaultWriter<Uint8Array>, value: unknown) {
	const body = encoder.encode(JSON.stringify(value))
	const frame = new Uint8Array(body.byteLength + 4)
	new DataView(frame.buffer).setUint32(0, body.byteLength)
	frame.set(body, 4)
	await writer.write(frame)
}

async function readControl(reader: ExactStreamReader) {
	const prefix = await reader.readExact(4)
	const length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0)
	if (!length || length > 64 * 1024) throw new Error('极速 QUIC 控制帧无效')
	return JSON.parse(decoder.decode(await reader.readExact(length))) as unknown
}

async function expectControl(reader: ExactStreamReader, type: string) {
	const message = await readControl(reader) as { type?: string }
	if (message.type !== type) throw new Error('极速 QUIC 文件状态不一致')
}

function segmentUrl(endpoint: string, transferId: string, offset: number, bytes?: number) {
	const url = new URL(endpoint)
	url.pathname = `${url.pathname}/transfers/${transferId}/segments`
	url.searchParams.set('offset', String(offset))
	if (bytes !== undefined) url.searchParams.set('bytes', String(bytes))
	return url.toString()
}

function progressReporter(segmentCount: number, onProgress: (bytes: number) => void) {
	const current = new Array<number>(segmentCount).fill(0)
	let total = 0
	return (index: number, bytes: number) => {
		const next = Math.max(current[index] || 0, bytes)
		total += next - (current[index] || 0)
		current[index] = next
		onProgress(total)
	}
}

function bindXhrAbort(xhr: XMLHttpRequest, signal: AbortSignal, reject: (error: Error) => void) {
	const abort = () => {
		xhr.abort()
		reject(new Error('极速文件传输已取消'))
	}
	signal.addEventListener('abort', abort, { once: true })
	return () => signal.removeEventListener('abort', abort)
}

function httpFileError(xhr: XMLHttpRequest) {
	let message = ''
	try {
		const parsed = JSON.parse(xhr.responseText) as { error?: { message?: string } }
		message = parsed.error?.message || ''
	} catch {}
	return new Error(message || `Agent 拒绝了极速文件请求（${xhr.status || '网络错误'}）`)
}
