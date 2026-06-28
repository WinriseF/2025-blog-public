import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'

function manifestFor(meta: TransferFileMeta): TransferManifest {
	const now = Date.now()
	return {
		...meta,
		version: 3,
		receivedBytes: 0,
		receivedChunks: 0,
		receivedRanges: [],
		status: 'pending',
		createdAt: now,
		updatedAt: now
	}
}

export class MemoryStorageEngine implements LanStorageEngine {
	kind = 'memory' as const
	private chunks = new Map<string, Uint8Array[]>()
	private manifests = new Map<string, TransferManifest>()

	async prepare(meta: TransferFileMeta) {
		this.chunks.set(meta.id, new Array(meta.chunkCount))
		this.manifests.set(meta.id, manifestFor(meta))
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const chunks = this.chunks.get(meta.id) || new Array(meta.chunkCount)
		const manifest = this.manifests.get(meta.id) || manifestFor(meta)
		if (!chunks[chunkIndex]) {
			chunks[chunkIndex] = data
			manifest.receivedBytes += data.byteLength
			manifest.receivedChunks += 1
			manifest.receivedRanges = addRange(manifest.receivedRanges, chunkIndex)
		}
		manifest.status = manifest.receivedChunks >= meta.chunkCount ? 'complete' : 'receiving'
		manifest.updatedAt = Date.now()
		this.chunks.set(meta.id, chunks)
		this.manifests.set(meta.id, manifest)
		return manifest
	}

	async getManifest(fileId: string) {
		return this.manifests.get(fileId) || null
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return this.manifests.get(fileId)?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		const chunks = this.chunks.get(meta.id) || []
		const blob = new Blob(chunks as unknown as BlobPart[], { type: meta.mime || 'application/octet-stream' })
		const url = URL.createObjectURL(blob)
		return { url, revoke: () => URL.revokeObjectURL(url) }
	}

	async cleanup(fileId: string) {
		this.chunks.delete(fileId)
		this.manifests.delete(fileId)
	}
}
