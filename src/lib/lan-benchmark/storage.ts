import { DirectFileStorageEngine } from '@/lib/lan-transfer/storage/direct-file-storage'
import { closeIndexedDb, IndexedDbStorageEngine } from '@/lib/lan-transfer/storage/indexeddb-storage'
import { MemoryStorageEngine } from '@/lib/lan-transfer/storage/memory-storage'
import { OpfsStorageEngine } from '@/lib/lan-transfer/storage/opfs-storage'
import type { LanStorageEngine } from '@/lib/lan-transfer/storage/types'
import { LAN_BENCHMARK_DB_NAME, LAN_BENCHMARK_OPFS_DIRECTORY_NAME, type BenchmarkStorageKind } from './types'

export function createBenchmarkStorageEngine(kind: BenchmarkStorageKind): LanStorageEngine {
	if (kind === 'file') return new DirectFileStorageEngine()
	if (kind === 'opfs') return new OpfsStorageEngine(LAN_BENCHMARK_OPFS_DIRECTORY_NAME)
	if (kind === 'indexeddb') return new IndexedDbStorageEngine(LAN_BENCHMARK_DB_NAME)
	return new MemoryStorageEngine()
}

export async function cleanupBenchmarkStorage() {
	if (typeof navigator === 'undefined') return
	await closeIndexedDb(LAN_BENCHMARK_DB_NAME)
	const tasks: Promise<unknown>[] = [
		new Promise<void>(resolve => {
			if (typeof indexedDB === 'undefined') return resolve()
			const request = indexedDB.deleteDatabase(LAN_BENCHMARK_DB_NAME)
			request.onsuccess = () => resolve()
			request.onerror = () => resolve()
			request.onblocked = () => resolve()
		}),
	]
	if (navigator.storage && 'getDirectory' in navigator.storage) {
		tasks.push(navigator.storage.getDirectory().then(root => root.removeEntry(LAN_BENCHMARK_OPFS_DIRECTORY_NAME, { recursive: true })).catch(() => {}))
	}
	await Promise.all(tasks)
}
