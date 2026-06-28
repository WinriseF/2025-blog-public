import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'

type DirectoryHandle = FileSystemDirectoryHandle

type FileHandle = FileSystemFileHandle

const MANIFEST_FLUSH_CHUNKS = 64
const MANIFEST_FLUSH_BYTES = 16 * 1024 * 1024

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

async function rootDirectory() {
	if (!navigator.storage || !('getDirectory' in navigator.storage)) throw new Error('当前浏览器不支持 OPFS')
	const root = await navigator.storage.getDirectory()
	return await root.getDirectoryHandle('winrisef-lan-transfer-v3', { create: true })
}

async function fileDirectory(root: DirectoryHandle, fileId: string) {
	return await root.getDirectoryHandle(fileId, { create: true })
}

async function readJsonFile<T>(directory: DirectoryHandle, name: string) {
	try {
		const handle = await directory.getFileHandle(name)
		const file = await handle.getFile()
		if (!file.size) return null
		return JSON.parse(await file.text()) as T
	} catch {
		return null
	}
}

async function writeJsonFile(directory: DirectoryHandle, name: string, data: unknown) {
	const handle = await directory.getFileHandle(name, { create: true })
	const writable = await handle.createWritable()
	await writable.write(JSON.stringify(data))
	await writable.close()
}

export class OpfsStorageEngine implements LanStorageEngine {
	kind = 'opfs' as const
	private manifests = new Map<string, TransferManifest>()
	private pendingFlush = new Map<string, { chunks: number; bytes: number }>()

	private async getDir(fileId: string) {
		return fileDirectory(await rootDirectory(), fileId)
	}

	private async getDataHandle(fileId: string): Promise<FileHandle> {
		const dir = await this.getDir(fileId)
		return await dir.getFileHandle('data.part', { create: true })
	}

	private async flushManifest(fileId: string) {
		const manifest = this.manifests.get(fileId)
		if (!manifest) return
		await writeJsonFile(await this.getDir(fileId), 'manifest.json', manifest)
		this.pendingFlush.set(fileId, { chunks: 0, bytes: 0 })
	}

	async prepare(meta: TransferFileMeta) {
		const dir = await this.getDir(meta.id)
		const manifest = (await readJsonFile<TransferManifest>(dir, 'manifest.json')) || manifestFor(meta)
		await dir.getFileHandle('data.part', { create: true })
		this.manifests.set(meta.id, manifest)
		this.pendingFlush.set(meta.id, { chunks: 0, bytes: 0 })
		if (manifest.status === 'pending') await writeJsonFile(dir, 'manifest.json', manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		let manifest = this.manifests.get(meta.id) || (await this.getManifest(meta.id)) || manifestFor(meta)
		this.manifests.set(meta.id, manifest)
		if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		const handle = await this.getDataHandle(meta.id)
		const writable = await handle.createWritable({ keepExistingData: true })
		await writable.seek(chunkIndex * meta.chunkSize)
		await writable.write(data)
		await writable.close()
		manifest = {
			...manifest,
			receivedBytes: manifest.receivedBytes + data.byteLength,
			receivedChunks: manifest.receivedChunks + 1,
			receivedRanges: addRange(manifest.receivedRanges, chunkIndex),
			status: manifest.receivedChunks + 1 >= meta.chunkCount ? 'complete' : 'receiving',
			updatedAt: Date.now()
		}
		this.manifests.set(meta.id, manifest)
		const pending = this.pendingFlush.get(meta.id) || { chunks: 0, bytes: 0 }
		pending.chunks += 1
		pending.bytes += data.byteLength
		this.pendingFlush.set(meta.id, pending)
		if (manifest.status === 'complete' || pending.chunks >= MANIFEST_FLUSH_CHUNKS || pending.bytes >= MANIFEST_FLUSH_BYTES) await this.flushManifest(meta.id)
		return manifest
	}

	async getManifest(fileId: string) {
		const cached = this.manifests.get(fileId)
		if (cached) return cached
		const manifest = await readJsonFile<TransferManifest>(await this.getDir(fileId), 'manifest.json')
		if (manifest) this.manifests.set(fileId, manifest)
		return manifest
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		await this.flushManifest(meta.id)
		const handle = await this.getDataHandle(meta.id)
		const file = await handle.getFile()
		if (file.size !== meta.size) throw new Error(`OPFS 文件大小异常：${file.size} / ${meta.size}`)
		const blob = new Blob([file], { type: meta.mime || 'application/octet-stream' })
		const url = URL.createObjectURL(blob)
		return { url, revoke: () => URL.revokeObjectURL(url) }
	}

	async cleanup(fileId: string) {
		this.manifests.delete(fileId)
		this.pendingFlush.delete(fileId)
		try {
			const root = await rootDirectory()
			await root.removeEntry(fileId, { recursive: true })
		} catch {
			// ignore cleanup errors
		}
	}
}
