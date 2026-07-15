import type { TransferFileMeta } from '@/lib/lan-transfer/storage/types'
import { createBenchmarkStorageEngine } from './storage'
import { appendBenchmarkSample, bytesToMiBps, randomBenchmarkId, type BenchmarkResult, type BenchmarkSample, type BenchmarkStorageKind } from './types'

export type LocalStorageBenchmarkOptions = {
	storage: BenchmarkStorageKind
	totalBytes: number
	chunkSize: number
	onProgress?: (bytes: number, samples: BenchmarkSample[]) => void
}

function createSeed(size: number) {
	const seed = new Uint8Array(size)
	for (let offset = 0; offset < seed.byteLength; offset += 65_536) crypto.getRandomValues(seed.subarray(offset, Math.min(seed.byteLength, offset + 65_536)))
	return seed
}

function nextChunk(seed: Uint8Array, index: number, size: number) {
	const bytes = seed.slice(0, size)
	new DataView(bytes.buffer).setUint32(0, index)
	return bytes
}

export async function runLocalStorageBenchmark({ storage, totalBytes, chunkSize, onProgress }: LocalStorageBenchmarkOptions): Promise<BenchmarkResult> {
	const id = randomBenchmarkId('local')
	const chunkCount = Math.ceil(totalBytes / chunkSize)
	const meta: TransferFileMeta = {
		id,
		name: `lan-benchmark-${Date.now()}.bin`,
		mime: 'application/octet-stream',
		size: totalBytes,
		lastModified: Date.now(),
		chunkSize,
		chunkCount,
		storage,
	}
	const engine = createBenchmarkStorageEngine(storage)
	const samples: BenchmarkSample[] = []
	const startedAt = Date.now()
	const startedPerf = performance.now()
	let bytes = 0
	let writeMs = 0
	let prepareMs = 0
	let checkpointMs = 0
	let finalizeMs = 0
	const seed = createSeed(chunkSize)

	try {
		const prepareStarted = performance.now()
		await engine.prepare(meta)
		prepareMs = performance.now() - prepareStarted
		for (let index = 0; index < chunkCount; index += 1) {
			const size = Math.min(chunkSize, totalBytes - bytes)
			const data = nextChunk(seed, index, size)
			const writeStarted = performance.now()
			await engine.writeChunk(meta, index, data)
			writeMs += performance.now() - writeStarted
			bytes += size
			if (appendBenchmarkSample(samples, startedPerf, bytes, undefined, bytes === totalBytes)) onProgress?.(bytes, samples)
		}
		const checkpointStarted = performance.now()
		await engine.checkpoint(meta)
		checkpointMs = performance.now() - checkpointStarted
		const finalizeStarted = performance.now()
		const finalized = await engine.finalize(meta)
		finalizeMs = performance.now() - finalizeStarted
		finalized.revoke?.()
		const finishedPerf = performance.now()
		return {
			id,
			label: `本机 ${storage} 顺序写`,
			category: 'local-storage',
			scope: 'local',
			storage,
			totalBytes,
			chunkSize,
			bytes,
			throughputMiBps: bytesToMiBps(bytes, writeMs),
			startedAt,
			finishedAt: Date.now(),
			timings: { prepareMs, writeMs, checkpointMs, finalizeMs, endToEndMs: finishedPerf - startedPerf },
			samples,
			status: 'complete',
		}
	} catch (error) {
		const finishedPerf = performance.now()
		return {
			id,
			label: `本机 ${storage} 顺序写`,
			category: 'local-storage',
			scope: 'local',
			storage,
			totalBytes,
			chunkSize,
			bytes,
			throughputMiBps: bytesToMiBps(bytes, writeMs),
			startedAt,
			finishedAt: Date.now(),
			timings: { prepareMs, writeMs, checkpointMs, finalizeMs, endToEndMs: finishedPerf - startedPerf },
			samples,
			status: 'failed',
			error: error instanceof Error ? error.message : '存储测试失败',
		}
	} finally {
		await engine.cleanup(id).catch(() => {})
	}
}
