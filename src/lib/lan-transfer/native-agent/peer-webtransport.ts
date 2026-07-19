import type { LanNativeAgentTicket, LanNativeBenchmarkDirection, LanNativeBenchmarkProgress, LanNativeBenchmarkResult } from './types'
import { nativeAgentBenchmarkSessionCount, NATIVE_AGENT_BENCHMARK_VERSION } from './types'
import { createPinnedWebTransport, ExactStreamReader, hexBytes, readU64, withTimeout, writeU64, type WebTransportLike } from './webtransport'

const LANE_COUNT = 4
const BLOCK_SIZE = 4 * 1024 * 1024
const EXTENT_SIZE = 16 * 1024 * 1024
const HELLO_MAGIC = new TextEncoder().encode('WRNFHEL1')
const ACK_MAGIC = new TextEncoder().encode('WRNFACK1')
const LANE_MAGIC = new TextEncoder().encode('WRNFLAN1')
const RESULT_MAGIC = new TextEncoder().encode('WRNFDON1')
const WRITES_IN_FLIGHT_PER_LANE = 2
const ZERO_BLOCKS = Array.from({ length: LANE_COUNT }, () => new Uint8Array(BLOCK_SIZE))

export async function runLanNativeBenchmark(options: {
	tickets: LanNativeAgentTicket[]
	direction: LanNativeBenchmarkDirection
	totalBytes: number
	onProgress?: (progress: LanNativeBenchmarkProgress) => void
}): Promise<LanNativeBenchmarkResult> {
	if (!Number.isSafeInteger(options.totalBytes) || options.totalBytes <= 0) throw new Error('测速大小无效')
	const sessionCount = nativeAgentBenchmarkSessionCount(options.direction)
	if (options.tickets.length !== sessionCount) throw new Error('极速通道并行凭据数量不完整')
	const shardSizes = splitBytes(options.totalBytes, options.tickets.length)
	const preparedResults = await Promise.allSettled(
		options.tickets.map((ticket, index) => prepareBenchmarkSession(ticket, options.direction, shardSizes[index]!))
	)
	const sessions = preparedResults.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
	const rejected = preparedResults.find(result => result.status === 'rejected')
	if (rejected?.status === 'rejected') {
		for (const session of sessions) session.transport.close({ closeCode: 1, reason: 'parallel setup failed' })
		throw rejected.reason
	}

	const startedAt = performance.now()
	const shardProgress = new Array<number>(sessions.length).fill(0)
	let lastProgressAt = startedAt
	options.onProgress?.({ direction: options.direction, transport: 'webtransport', sessionCount, bytes: 0, totalBytes: options.totalBytes, startedAt })
	const report = (index: number, bytes: number) => {
		shardProgress[index] = bytes
		const transferred = shardProgress.reduce((sum, value) => sum + value, 0)
		const now = performance.now()
		if (now - lastProgressAt >= 100 || transferred === options.totalBytes) {
			lastProgressAt = now
			options.onProgress?.({
				direction: options.direction,
				transport: 'webtransport',
				sessionCount,
				bytes: transferred,
				totalBytes: options.totalBytes,
				startedAt
			})
		}
	}

	try {
		const results = await Promise.all(
			sessions.map((session, index) => runPreparedSession(session, options.direction, startedAt, bytes => report(index, bytes)))
		)
		const bytes = results.reduce((sum, result) => sum + result.bytes, 0)
		if (bytes !== options.totalBytes) throw new Error('并行测速字节数不一致')
		const clientElapsedMs = Math.max(...results.map(result => result.clientElapsedMs))
		const agentElapsedMs = Math.max(...results.map(result => result.agentElapsedMs))
		return {
			direction: options.direction,
			transport: 'webtransport',
			sessionCount,
			bytes,
			clientElapsedMs,
			agentElapsedMs,
			clientMbps: (bytes * 8) / Math.max(clientElapsedMs, 0.001) / 1_000,
			agentMbps: (bytes * 8) / Math.max(agentElapsedMs, 0.001) / 1_000
		}
	} finally {
		for (const session of sessions) session.transport.close({ closeCode: 0, reason: 'parallel benchmark complete' })
	}
}

type PreparedBenchmarkSession = {
	transport: WebTransportLike
	controlReader: ExactStreamReader
	totalBytes: number
}

async function prepareBenchmarkSession(
	ticket: LanNativeAgentTicket,
	direction: LanNativeBenchmarkDirection,
	totalBytes: number
): Promise<PreparedBenchmarkSession> {
	if (ticket.expiresAt <= Date.now()) throw new Error('极速通道凭据已过期，请重试')
	const endpoint = ticket.endpoints[0]
	if (!endpoint) throw new Error('加速电脑没有可用的局域网地址')
	const transport = createPinnedWebTransport(endpoint, ticket.certificateSha256)
	try {
		await withTimeout(transport.ready, 10_000, '连接加速电脑超时，请检查防火墙和局域网')
		const control = await transport.createBidirectionalStream()
		const controlWriter = control.writable.getWriter()
		const controlReader = new ExactStreamReader(control.readable)
		await controlWriter.write(encodeHello(direction, totalBytes, ticket.token))
		const ack = await withTimeout(controlReader.readExact(32), 10_000, '加速电脑握手超时')
		validateAck(ack, totalBytes)
		await controlWriter.close()
		controlWriter.releaseLock()
		return { transport, controlReader, totalBytes }
	} catch (error) {
		transport.close({ closeCode: 1, reason: 'benchmark setup failed' })
		throw error
	}
}

async function runPreparedSession(
	session: PreparedBenchmarkSession,
	direction: LanNativeBenchmarkDirection,
	startedAt: number,
	onProgress: (bytes: number) => void
) {
	let transferred = 0
	const report = (bytes: number) => {
		transferred += bytes
		onProgress(transferred)
	}
	if (direction === 'browser-to-agent') await sendBrowserMemory(session.transport, session.totalBytes, report)
	else await receiveAgentMemory(session.transport, session.totalBytes, report)

	const resultBytes = await withTimeout(session.controlReader.readExact(32), 30_000, '等待测速结果超时')
	const result = parseResult(resultBytes, session.totalBytes)
	session.controlReader.release()
	return {
		bytes: result.bytes,
		clientElapsedMs: performance.now() - startedAt,
		agentElapsedMs: result.elapsedNanos / 1_000_000
	}
}

function splitBytes(totalBytes: number, count: number) {
	const quotient = Math.floor(totalBytes / count)
	const remainder = totalBytes % count
	return Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1 : 0))
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
	const zeroBlock = ZERO_BLOCKS[laneId]
	if (!zeroBlock) throw new Error('测速数据通道编号无效')
	await writer.write(encodeLaneHeader(laneId, totalBytes))
	for (let offset = laneId * EXTENT_SIZE; offset < totalBytes; offset += LANE_COUNT * EXTENT_SIZE) {
		const length = Math.min(EXTENT_SIZE, totalBytes - offset)
		await writer.write(encodeExtent(offset, length))
		let pendingWrites: Promise<void>[] = []
		let pendingBytes = 0
		for (let sent = 0; sent < length;) {
			const count = Math.min(BLOCK_SIZE, length - sent)
			pendingWrites.push(writer.write(count === BLOCK_SIZE ? zeroBlock : zeroBlock.subarray(0, count)))
			pendingBytes += count
			sent += count
			if (pendingWrites.length === WRITES_IN_FLIGHT_PER_LANE) {
				await Promise.all(pendingWrites)
				onBytes(pendingBytes)
				pendingWrites = []
				pendingBytes = 0
			}
		}
		if (pendingWrites.length > 0) {
			await Promise.all(pendingWrites)
			onBytes(pendingBytes)
		}
	}
	await writer.write(new Uint8Array(16))
	await writer.close()
	writer.releaseLock()
}

async function receiveAgentMemory(transport: WebTransportLike, totalBytes: number, onBytes: (bytes: number) => void) {
	const incoming = transport.incomingUnidirectionalStreams.getReader()
	const receivers: Promise<void>[] = []
	const seenLanes = new Set<number>()
	const seenExtents = new Set<number>()
	for (let index = 0; index < LANE_COUNT; index += 1) {
		const next = await incoming.read()
		if (next.done) throw new Error('Agent 没有创建完整的数据通道')
		receivers.push(receiveLane(next.value, totalBytes, seenLanes, seenExtents, onBytes))
	}
	incoming.releaseLock()
	await Promise.all(receivers)
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
