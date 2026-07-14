import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, hasChunk, type ChunkRange } from './ranges'

type SaveFilePicker = (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>
type WritableFileStream = {
	write: (data: unknown) => Promise<void>
	close: () => Promise<void>
	abort: () => Promise<void>
}
type WritableFileHandle = FileSystemFileHandle & { createWritable: () => Promise<WritableFileStream> }
type ActiveDirectFile = {
	writable: WritableFileStream | null
	manifest: TransferManifest
	closed: boolean
	writePosition: number
}

function manifestFor(meta: TransferFileMeta): TransferManifest {
	const now = Date.now()
	return { ...meta, version: 3, receivedBytes: 0, receivedChunks: 0, receivedRanges: [], status: 'pending', createdAt: now, updatedAt: now }
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

	async prepare(meta: TransferFileMeta) {
		const handle = await saveFilePicker()({ suggestedName: meta.name || 'lan-transfer-file' })
		const writable = await (handle as WritableFileHandle).createWritable()
		const manifest = manifestFor(meta)
		this.activeFiles.set(meta.id, { writable, manifest, closed: false, writePosition: 0 })
		this.manifests.set(meta.id, manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		return this.writeChunks(meta, [{ chunkIndex, data }])
	}

	async writeChunks(meta: TransferFileMeta, chunks: Array<{ chunkIndex: number; data: Uint8Array }>) {
		const active = this.activeFiles.get(meta.id)
		if (!active?.writable || active.closed) throw new Error('文件保存失败，请重新接收')
		const pending = chunks.filter(item => !hasChunk(active.manifest.receivedRanges, item.chunkIndex))
		if (!pending.length) return active.manifest
		const first = pending[0].chunkIndex
		for (let index = 1; index < pending.length; index += 1) {
			if (pending[index].chunkIndex !== first + index) throw new Error('文件分块不连续，请重新接收')
		}
		const position = first * meta.chunkSize
		const data = combineBuffers(pending.map(item => item.data))
		if (position === active.writePosition) await active.writable.write(data)
		else await active.writable.write({ type: 'write', position, data })
		active.writePosition = position + data.byteLength
		let manifest = active.manifest
		for (const item of pending) manifest = {
			...manifest,
			receivedBytes: manifest.receivedBytes + item.data.byteLength,
			receivedChunks: manifest.receivedChunks + 1,
			receivedRanges: addRange(manifest.receivedRanges, item.chunkIndex),
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

	async checkpoint(meta: TransferFileMeta) {
		return this.getManifest(meta.id)
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		const active = this.activeFiles.get(meta.id)
		if (!active?.writable || active.closed) throw new Error('文件保存失败，请重新接收')
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
