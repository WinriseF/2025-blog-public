import { MemoryStorageEngine } from './memory-storage'
import { OpfsStorageEngine } from './opfs-storage'
import { IndexedDbStorageEngine } from './indexeddb-storage'
import { LAN_LIMITS, type LanCapability, type LanStorageKind } from '../types'
import type { LanStorageEngine } from './types'

export function chooseStorageKind(size: number, requested: LanStorageKind, capability: LanCapability | null): LanStorageKind {
	if (size <= LAN_LIMITS.memoryMaxBytes) return 'memory'
	if (requested === 'opfs' && capability?.storage.opfs) return 'opfs'
	if (requested === 'indexeddb' && capability?.storage.indexedDB) return 'indexeddb'
	if (capability?.storage.opfs) return 'opfs'
	if (capability?.storage.indexedDB) return 'indexeddb'
	return 'memory'
}

export function createStorageEngine(kind: LanStorageKind): LanStorageEngine {
	if (kind === 'opfs') return new OpfsStorageEngine()
	if (kind === 'indexeddb') return new IndexedDbStorageEngine()
	return new MemoryStorageEngine()
}
