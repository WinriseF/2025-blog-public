import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'

type SaveFilePicker = (options?: { suggestedName?: string; types?: Array<{ description?: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>

type ActiveDirectFile = {
	fileHandle: FileSystemFileHandle
	writable: FileSystemWritableFileStream | null
	manifest: TransferManifest
	closed: boolean
}

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
		updatedAt: now,
	}
}

function saveFilePicker(): SaveFilePicker {
	const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
	if (typeof picker !== 'function') throw new Error('当前浏览器不支持直接保存文件流，请改用 Chrome / Edge 桌面版或使用 OPFS 模式。')
	return picker.bind(window)
}

export class DirectFileStorageEngine implements LanStorageEngine {
	kind = 'file' as const
	private activeFiles = new Map<string, ActiveDirectFile>()
	private manifests = new Map<string, TransferManifest>()

	async prepare(meta: TransferFileMeta) {
		const picker = saveFilePicker()
		const fileHandle = await picker({
			suggestedName: meta.name || 'lan-transfer-file',
		})
		const writable = await fileHandle.createWritable()
		const manifest = manifestFor(meta)
		this.activeFiles.set(meta.id, { fileHandle, writable, manifest, closed: false })
		this.manifests.set(meta.id, manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const active = this.activeFiles.get(meta.id)
		if (!active || !active.writable || active.closed) throw new Error('直接保存写入器不可用，请重新接收文件。')
		let manifest = active.manifest
		if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		await active.writable.write({ type: 'write', position: chunkIndex * meta.chunkSize, data })
		manifest = {
			...manifest,
			receivedBytes: manifest.receivedBytes + data.byteLength,
			receivedChunks: manifest.receivedChunks + 1,
			receivedRanges: addRange(manifest.receivedRanges, chunkIndex),
			status: manifest.receivedChunks + 1 >= meta.chunkCount ? 'complete' : 'receiving',
			updatedAt: Date.now(),
		}
		active.manifest = manifest
		this.manifests.set(meta.id, manifest)
		return manifest
	}

	async getManifest(fileId: string) {
		return this.activeFiles.get(fileId)?.manifest || this.manifests.get(fileId) || null
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		const active = this.activeFiles.get(meta.id)
		if (!active || !active.writable || active.closed) throw new Error('直接保存写入器不可用，无法完成文件保存。')
		await active.writable.close()
		active.closed = true
		active.writable = null
		return { directSave: true }
	}

	async cleanup(fileId: string) {
		const active = this.activeFiles.get(fileId)
		this.activeFiles.delete(fileId)
		this.manifests.delete(fileId)
		if (active?.writable && !active.closed) await active.writable.abort().catch(() => active.writable?.close().catch(() => {}))
	}
}
