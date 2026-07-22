import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'
import { LAN_FILE_IO_BATCH_BYTES } from '../types'

type SaveFilePicker = (options?: { suggestedName?: string; types?: Array<{ description?: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>
type WritableFileStream = {
	write: (data: unknown) => Promise<void>
	close: () => Promise<void>
	abort: () => Promise<void>
}
type WritableFileHandle = FileSystemFileHandle & {
	createWritable: () => Promise<WritableFileStream>
}

type ActiveDirectFile = {
	fileHandle: FileSystemFileHandle
	writable: WritableFileStream | null
	manifest: TransferManifest
	closed: boolean
	writeBuffer: Array<{ chunkIndex: number; data: Uint8Array }>
	writeBufferBytes: number
	writePosition: number
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
	if (typeof picker !== 'function') throw new Error('当前设备不支持直接保存文件')
	return picker.bind(window)
}

function combineBuffers(parts: Uint8Array[]) {
	if (parts.length === 1) return parts[0]
	const merged = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
	let offset = 0
	for (const part of parts) {
		merged.set(part, offset)
		offset += part.byteLength
	}
	return merged
}

export class DirectFileStorageEngine implements LanStorageEngine {
	kind = 'file' as const
	private activeFiles = new Map<string, ActiveDirectFile>()
	private manifests = new Map<string, TransferManifest>()

	private async flushBufferedData(active: ActiveDirectFile, meta: TransferFileMeta) {
		if (!active.writeBuffer.length) return active.manifest
		if (!active.writable || active.closed) throw new Error('文件保存失败，请重新接收')
		const firstChunkIndex = active.writeBuffer[0].chunkIndex
		const position = firstChunkIndex * meta.chunkSize
		const data = combineBuffers(active.writeBuffer.map(item => item.data))
		if (position === active.writePosition) await active.writable.write(data)
		else await active.writable.write({ type: 'write', position, data })
		active.writePosition = position + data.byteLength
		let manifest = active.manifest
		for (const item of active.writeBuffer) {
			manifest = {
				...manifest,
				receivedBytes: manifest.receivedBytes + item.data.byteLength,
				receivedChunks: manifest.receivedChunks + 1,
				receivedRanges: addRange(manifest.receivedRanges, item.chunkIndex),
				status: manifest.receivedChunks + 1 >= meta.chunkCount ? 'complete' : 'receiving',
				updatedAt: Date.now(),
			}
		}
		active.writeBuffer = []
		active.writeBufferBytes = 0
		active.manifest = manifest
		this.manifests.set(meta.id, manifest)
		return manifest
	}

	async prepare(meta: TransferFileMeta) {
		const picker = saveFilePicker()
		const fileHandle = await picker({
			suggestedName: meta.name || 'lan-transfer-file',
		})
		const writable = await (fileHandle as WritableFileHandle).createWritable()
		const manifest = manifestFor(meta)
		this.activeFiles.set(meta.id, { fileHandle, writable, manifest, closed: false, writeBuffer: [], writeBufferBytes: 0, writePosition: 0 })
		this.manifests.set(meta.id, manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const active = this.activeFiles.get(meta.id)
		if (!active || !active.writable || active.closed) throw new Error('文件保存失败，请重新接收')
		let manifest = active.manifest
		if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		const expectedNextIndex = active.writeBuffer.length ? active.writeBuffer[0].chunkIndex + active.writeBuffer.length : chunkIndex
		if (chunkIndex !== expectedNextIndex) {
			manifest = await this.flushBufferedData(active, meta)
			if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		}
		active.writeBuffer.push({ chunkIndex, data })
		active.writeBufferBytes += data.byteLength
		if (active.writeBufferBytes >= LAN_FILE_IO_BATCH_BYTES || chunkIndex + 1 >= meta.chunkCount) manifest = await this.flushBufferedData(active, meta)
		return manifest
	}

	async getManifest(fileId: string) {
		return this.activeFiles.get(fileId)?.manifest || this.manifests.get(fileId) || null
	}

	async checkpoint(meta: TransferFileMeta) {
		const active = this.activeFiles.get(meta.id)
		if (active) await this.flushBufferedData(active, meta)
		return this.getManifest(meta.id)
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		const active = this.activeFiles.get(meta.id)
		if (!active || !active.writable || active.closed) throw new Error('文件保存失败，请重新接收')
		await this.flushBufferedData(active, meta)
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
