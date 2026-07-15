import type { LanConnectionRoute } from '@/lib/lan-transfer/transport-types'

export const LAN_BENCHMARK_PROTOCOL_VERSION = 1
export const LAN_BENCHMARK_DB_NAME = 'winrisef-lan-benchmark-v1'
export const LAN_BENCHMARK_OPFS_DIRECTORY_NAME = 'winrisef-lan-benchmark-v1'

export type BenchmarkStorageKind = 'memory' | 'file' | 'opfs' | 'indexeddb'
export type BenchmarkPeerStorage = BenchmarkStorageKind | 'sink'
export type BenchmarkRole = 'host' | 'guest'
export type BenchmarkCategory = 'local-storage' | 'raw-rtc' | 'framed-rtc' | 'production-e2e'

export type BenchmarkSession = {
	roomId: string
	token: string
	tokenHash: string
	instanceId: string
	role: BenchmarkRole
}

export type BenchmarkSample = {
	elapsedMs: number
	bytes: number
	mibPerSecond: number
	bufferedAmount?: number
}

export type BenchmarkRunConfig = {
	id: string
	label: string
	storage: BenchmarkPeerStorage
	totalBytes: number
	chunkSize: number
	highWatermark: number
	lowWatermark: number
}

export type RawRtcRunConfig = {
	id: string
	messageSize: number
	warmupMs: number
	testMs: number
	highWatermark: number
	lowWatermark: number
}

export type RawRtcStatsSnapshot = {
	capturedAt: number
	dataChannelBytesSent: number
	dataChannelBytesReceived: number
	transportBytesSent: number
	transportBytesReceived: number
	rttMs?: number
	availableOutgoingBps?: number
}

export type RawRtcMetrics = {
	messageSize: number
	warmupMs: number
	testMs: number
	warmupBytes: number
	receiverElapsedMs: number
	startStats: RawRtcStatsSnapshot
	endStats: RawRtcStatsSnapshot
	configuredHighWatermark: number
	configuredLowWatermark: number
	effectiveHighWatermark?: number
	effectiveLowWatermark?: number
	maxBufferedAmount: number
	backpressureWaitMs: number
	backpressureCount: number
	adaptiveBackpressureCount: number
}

export type RawRtcFailureDetails = {
	phase: 'preparing' | 'warmup' | 'measuring' | 'finishing'
	elapsedMs: number
	warmupBytes: number
	measurementBytes: number
	exceptionName?: string
	exceptionMessage?: string
	readyState?: RTCDataChannelState
	connectionState?: RTCPeerConnectionState
	iceConnectionState?: RTCIceConnectionState
	bufferedAmount?: number
	maxMessageSize?: number
	configuredHighWatermark: number
	configuredLowWatermark: number
	effectiveHighWatermark?: number
	effectiveLowWatermark?: number
	backpressureCount: number
	adaptiveBackpressureCount: number
}

export type BenchmarkStageTimings = {
	prepareMs?: number
	writeMs?: number
	checkpointMs?: number
	finalizeMs?: number
	sendMs?: number
	endToEndMs?: number
}

export type BenchmarkResult = {
	id: string
	label: string
	category: BenchmarkCategory
	scope: 'local' | 'peer-send' | 'peer-receive'
	storage: BenchmarkPeerStorage
	totalBytes: number
	chunkSize: number
	bytes: number
	throughputMiBps: number
	startedAt: number
	finishedAt: number
	timings: BenchmarkStageTimings
	samples: BenchmarkSample[]
	route?: LanConnectionRoute | null
	raw?: RawRtcMetrics
	rawFailure?: RawRtcFailureDetails
	status: 'complete' | 'failed' | 'cancelled'
	error?: string
}

export type BenchmarkCapabilities = {
	opfs: boolean
	indexedDb: boolean
	fileSystemAccess: boolean
	quota?: number
	usage?: number
	available?: number
}

export function randomBenchmarkId(prefix = 'bench') {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function bytesToMib(bytes: number) {
	return bytes / 1024 / 1024
}

export function bytesToMiBps(bytes: number, elapsedMs: number) {
	if (!elapsedMs) return 0
	return bytesToMib(bytes) / (elapsedMs / 1000)
}

export const BENCHMARK_SAMPLE_INTERVAL_MS = 250

export function appendBenchmarkSample(samples: BenchmarkSample[], startedPerf: number, bytes: number, bufferedAmount?: number, force = false) {
	const elapsedMs = performance.now() - startedPerf
	const previous = samples.at(-1)
	if (!previous) {
		if (elapsedMs < BENCHMARK_SAMPLE_INTERVAL_MS) return false
		samples.push({ elapsedMs, bytes, mibPerSecond: bytesToMiBps(bytes, elapsedMs), bufferedAmount })
		return true
	}
	if (elapsedMs - previous.elapsedMs < BENCHMARK_SAMPLE_INTERVAL_MS) {
		if (!force) return false
		const before = samples.at(-2)
		previous.elapsedMs = elapsedMs
		previous.bytes = bytes
		previous.mibPerSecond = bytesToMiBps(bytes - (before?.bytes || 0), elapsedMs - (before?.elapsedMs || 0))
		if (bufferedAmount !== undefined) previous.bufferedAmount = bufferedAmount
		return true
	}
	samples.push({ elapsedMs, bytes, mibPerSecond: bytesToMiBps(bytes - previous.bytes, elapsedMs - previous.elapsedMs), bufferedAmount })
	return true
}
