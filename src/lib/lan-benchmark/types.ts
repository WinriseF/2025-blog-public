import type { LanConnectionRoute } from '@/lib/lan-transfer/transport-types'

export const LAN_BENCHMARK_PROTOCOL_VERSION = 1
export const LAN_BENCHMARK_DB_NAME = 'winrisef-lan-benchmark-v1'
export const LAN_BENCHMARK_OPFS_DIRECTORY_NAME = 'winrisef-lan-benchmark-v1'

export type BenchmarkStorageKind = 'memory' | 'file' | 'opfs' | 'indexeddb'
export type BenchmarkPeerStorage = BenchmarkStorageKind | 'sink'
export type BenchmarkRole = 'host' | 'guest'

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
