import type { LanNativeAgentTicket, LanNativeBenchmarkDirection, LanNativeBenchmarkProgress, LanNativeBenchmarkResult } from './types'
import { NATIVE_AGENT_BENCHMARK_VERSION } from './types'
import { createPinnedWebTransport, ExactStreamReader, hexBytes, readU64, withTimeout, writeU64, type WebTransportLike } from './webtransport'

const LANE_COUNT = 4
const BLOCK_SIZE = 4 * 1024 * 1024
const EXTENT_SIZE = 64 * 1024 * 1024
const HELLO_MAGIC = new TextEncoder().encode('WRNFHEL1')
const ACK_MAGIC = new TextEncoder().encode('WRNFACK1')
const LANE_MAGIC = new TextEncoder().encode('WRNFLAN1')
const RESULT_MAGIC = new TextEncoder().encode('WRNFDON1')
const ZERO_BLOCK = new Uint8Array(BLOCK_SIZE)

export async function runLanNativeBenchmark(options: {
	ticket: LanNativeAgentTicket
	direction: LanNativeBenchmarkDirection
	totalBytes: number
	onProgress?: (progress: LanNativeBenchmarkProgress) => void
}): Promise<LanNativeBenchmarkResult> {
	if (!Number.isSafeInteger(options.totalBytes) || options.totalBytes <= 0) throw new Error('测速大小无效')
	if (options.ticket.expiresAt <= Date.now()) throw new Error('极速通道凭据已过期，请重试')
	const endpoint = options.ticket.endpoints[0]
	if (!endpoint) throw new Error('加速电脑没有可用的局域网地址')
	const transport = createPinnedWebTransport(endpoint, options.ticket.certificateSha256)
	const startedAt = performance.now()
	let transferred = 0
	let lastProgressAt = 0
	const report = (bytes: number) => {
		transferred += bytes
		const now = performance.now()
		if (now - lastProgressAt >= 100 || transferred === options.totalBytes) {
			lastProgressAt = now
			options.onProgress?.({ direction: options.direction, bytes: transferred, totalBytes: options.totalBytes, startedAt })
		}
	}
	try {
		await withTimeout(transport.ready, 10_000, '连接加速电脑超时，请检查防火墙和局域网')
		const control = await transport.createBidirectionalStream()
		const controlWriter = control.writable.getWriter()
		const controlReader = new ExactStreamReader(control.readable)
		await controlWriter.write(encodeHello(options.direction, options.totalBytes, options.ticket.token))
		const ack = await withTimeout(controlReader.readExact(32), 10_000, '加速电脑握手超时')
		validateAck(ack, options.totalBytes)
		await controlWriter.close()
		controlWriter.releaseLock()

		if (options.direction === 'browser-to-agent') await sendBrowserMemory(transport, options.totalBytes, report)
		else await receiveAgentMemory(transport, options.totalBytes, report)

		const resultBytes = await withTimeout(controlReader.readExact(32), 30_000, '等待测速结果超时')
		const result = parseResult(resultBytes, options.totalBytes)
		const clientElapsedMs = performance.now() - startedAt
		controlReader.release()
		return {
			direction: options.direction,
			bytes: result.bytes,
			clientElapsedMs,
			agentElapsedMs: result.elapsedNanos / 1_000_000,
			clientMbps: (result.bytes * 8) / Math.max(clientElapsedMs, 0.001) / 1_000,
			agentMbps: (result.bytes * 8_000) / Math.max(result.elapsedNanos, 1)
		}
	} finally {
		transport.close({ closeCode: 0, reason: 'benchmark complete' })
	}
}

function encodeHello(direction: LanNativeBenchmarkDirection, totalBytes: number, token: string) {
	const bytes = new Uint8Array(48)
	const view = new DataView(bytes.buffer)
	bytes.set(HELLO_MAGIC)
	view.setUint16(8, NATIVE_AGENT_BENCHMARK_VERSION)
	bytes[10] = direction === 'browser-to-agent' ? 1 : 2
	bytes[11] = LANE_COUNT
	view.setUint32(12, BLOCK_SIZE)
	writeU64(view, 16, EXTENT_SIZE)
	writeU64(view, 24, totalBytes)
	bytes.set(hexBytes(token, 16, '测试凭据'), 32)
	return bytes
}

function validateAck(bytes: Uint8Array, totalBytes: number) {
	assertMagic(bytes, ACK_MAGIC, 'Agent 握手')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.getUint16(8) !== NATIVE_AGENT_BENCHMARK_VERSION) throw new Error('Agent 测速协议版本不兼容')
	const status = bytes[10]
	if (status === 1) throw new Error('Agent 拒绝了已使用或过期的测试凭据')
	if (status === 2) throw new Error('Agent 拒绝了测速参数')
	if (status !== 0) throw new Error('Agent 当前无法开始测速')
	if (bytes[11] !== LANE_COUNT || view.getUint32(12) !== BLOCK_SIZE || readU64(view, 16) !== EXTENT_SIZE || readU64(view, 24) !== totalBytes)
		throw new Error('Agent 握手参数不一致')
}

async function sendBrowserMemory(transport: WebTransportLike, totalBytes: number, onBytes: (bytes: number) => void) {
	await Promise.all(Array.from({ length: LANE_COUNT }, (_, laneId) => sendLane(transport, laneId, totalBytes, onBytes)))
}

async function sendLane(transport: WebTransportLike, laneId: number, totalBytes: number, onBytes: (bytes: number) => void) {
	const stream = await transport.createUnidirectionalStream()
	const writer = stream.getWriter()
	await writer.write(encodeLaneHeader(laneId, totalBytes))
	for (let offset = laneId * EXTENT_SIZE; offset < totalBytes; offset += LANE_COUNT * EXTENT_SIZE) {
		const length = Math.min(EXTENT_SIZE, totalBytes - offset)
		await writer.write(encodeExtent(offset, length))
		for (let sent = 0; sent < length;) {
			const count = Math.min(BLOCK_SIZE, length - sent)
			await writer.write(count === BLOCK_SIZE ? ZERO_BLOCK : ZERO_BLOCK.subarray(0, count))
			sent += count
			onBytes(count)
		}
	}
	await writer.write(new Uint8Array(16))
	await writer.close()
	writer.releaseLock()
}

async function receiveAgentMemory(transport: WebTransportLike, totalBytes: number, onBytes: (bytes: number) => void) {
	const incoming = transport.incomingUnidirectionalStreams.getReader()
	const streams: ReadableStream<Uint8Array>[] = []
	for (let index = 0; index < LANE_COUNT; index += 1) {
		const next = await incoming.read()
		if (next.done) throw new Error('Agent 没有创建完整的数据通道')
		streams.push(next.value)
	}
	incoming.releaseLock()
	const seenLanes = new Set<number>()
	const seenExtents = new Set<number>()
	await Promise.all(streams.map(stream => receiveLane(stream, totalBytes, seenLanes, seenExtents, onBytes)))
	if (seenLanes.size !== LANE_COUNT || seenExtents.size !== Math.ceil(totalBytes / EXTENT_SIZE)) throw new Error('Agent 发送的数据范围不完整')
}

async function receiveLane(
	stream: ReadableStream<Uint8Array>,
	totalBytes: number,
	seenLanes: Set<number>,
	seenExtents: Set<number>,
	onBytes: (bytes: number) => void
) {
	const reader = new ExactStreamReader(stream)
	const header = await reader.readExact(32)
	assertMagic(header, LANE_MAGIC, '数据通道')
	const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength)
	if (headerView.getUint16(8) !== NATIVE_AGENT_BENCHMARK_VERSION) throw new Error('数据通道协议版本不兼容')
	const laneId = headerView.getUint16(10)
	if (
		laneId >= LANE_COUNT ||
		headerView.getUint16(12) !== LANE_COUNT ||
		readU64(headerView, 16) !== totalBytes ||
		readU64(headerView, 24) !== EXTENT_SIZE ||
		seenLanes.has(laneId)
	)
		throw new Error('数据通道标头无效')
	seenLanes.add(laneId)
	while (true) {
		const extent = await reader.readExact(16)
		const view = new DataView(extent.buffer, extent.byteOffset, extent.byteLength)
		const offset = readU64(view, 0)
		const length = readU64(view, 8)
		if (offset === 0 && length === 0) break
		if (offset % EXTENT_SIZE !== 0 || length !== Math.min(EXTENT_SIZE, totalBytes - offset) || offset + length > totalBytes || seenExtents.has(offset))
			throw new Error('Agent 发送的数据范围无效')
		seenExtents.add(offset)
		await reader.discard(length, onBytes)
	}
	reader.release()
}

function encodeLaneHeader(laneId: number, totalBytes: number) {
	const bytes = new Uint8Array(32)
	const view = new DataView(bytes.buffer)
	bytes.set(LANE_MAGIC)
	view.setUint16(8, NATIVE_AGENT_BENCHMARK_VERSION)
	view.setUint16(10, laneId)
	view.setUint16(12, LANE_COUNT)
	writeU64(view, 16, totalBytes)
	writeU64(view, 24, EXTENT_SIZE)
	return bytes
}

function encodeExtent(offset: number, length: number) {
	const bytes = new Uint8Array(16)
	const view = new DataView(bytes.buffer)
	writeU64(view, 0, offset)
	writeU64(view, 8, length)
	return bytes
}

function parseResult(bytes: Uint8Array, expectedBytes: number) {
	assertMagic(bytes, RESULT_MAGIC, '测速结果')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.getUint16(8) !== NATIVE_AGENT_BENCHMARK_VERSION || bytes[10] !== 0) throw new Error('Agent 报告测速失败')
	const result = { bytes: readU64(view, 12), elapsedNanos: readU64(view, 20) }
	if (result.bytes !== expectedBytes) throw new Error('Agent 报告的测速字节数不一致')
	return result
}

function assertMagic(actual: Uint8Array, expected: Uint8Array, label: string) {
	if (expected.some((byte, index) => actual[index] !== byte)) throw new Error(`${label}格式错误`)
}
