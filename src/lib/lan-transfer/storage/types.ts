import type { LanStorageKind } from '../types'
import type { ChunkRange } from './ranges'

export type TransferFileMeta = {
	id: string
	name: string
	mime: string
	size: number
	lastModified: number
	chunkSize: number
	chunkCount: number
	storage: LanStorageKind
}

export type TransferManifest = TransferFileMeta & {
	version: 3
	receivedBytes: number
	receivedChunks: number
	receivedRanges: ChunkRange[]
	status: 'pending' | 'receiving' | 'complete' | 'failed'
	createdAt: number
	updatedAt: number
}

export type FinalizedFile = {
	url?: string
	revoke?: () => void
	directSave?: boolean
}

export interface LanStorageEngine {
	kind: LanStorageKind
	prepare(meta: TransferFileMeta): Promise<void>
	writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array): Promise<TransferManifest>
	checkpoint(meta: TransferFileMeta): Promise<TransferManifest | null>
	getManifest(fileId: string): Promise<TransferManifest | null>
	getReceivedRanges(fileId: string): Promise<ChunkRange[]>
	finalize(meta: TransferFileMeta): Promise<FinalizedFile>
	cleanup(fileId: string): Promise<void>
}
