import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'

type DirectoryHandle = FileSystemDirectoryHandle

type FileHandle = FileSystemFileHandle

const MANIFEST_FLUSH_CHUNKS = 64
const MANIFEST_FLUSH_BYTES = 32 * 1024 * 1024

type ActiveOpfsFile = {
	dir: DirectoryHandle
	dataHandle: FileHandle
	writable: FileSystemWritableFileStream | null
	manifest: TransferManifest
	pendingChunks: number
	pendingBytes: number
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

async function rootDirectory() {
	if (!navigator.storage || !('getDirectory' in navigator.storage)) throw new Error('当前浏览器不支持 OPFS')
	const root = await navigator.storage.getDirectory()
	return await root.getDirectoryHandle('winrisef-lan-transfer-v3', {
		create: true,
	})
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

async function openWritable(handle: FileHandle, keepExistingData: boolean) {
	const createWritable = (
		handle as FileHandle & {
			createWritable?: (options?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>
		}
	).createWritable
	if (typeof createWritable !== 'function') throw new Error('当前浏览器 OPFS 不支持可写文件流，请改用 Chrome / Edge 或降级 IndexedDB。')
	return await createWritable.call(handle, { keepExistingData })
}

export class OpfsStorageEngine implements LanStorageEngine {
	kind = 'opfs' as const
	private manifests = new Map<string, TransferManifest>()
	private activeFiles = new Map<string, ActiveOpfsFile>()

	private async getDir(fileId: string) {
		return fileDirectory(await rootDirectory(), fileId)
	}

	private async getDataHandle(fileId: string): Promise<FileHandle> {
		const dir = await this.getDir(fileId)
		return await dir.getFileHandle('data.part', { create: true })
	}

	private async flushManifest(fileId: string) {
		const active = this.activeFiles.get(fileId)
		const manifest = active?.manifest || this.manifests.get(fileId)
		if (!manifest) return
		const dir = active?.dir || (await this.getDir(fileId))
		await writeJsonFile(dir, 'manifest.json', manifest)
		if (active) {
			active.pendingChunks = 0
			active.pendingBytes = 0
		}
	}

	private async ensureActive(meta: TransferFileMeta) {
		const existing = this.activeFiles.get(meta.id)
		if (existing && existing.writable && !existing.closed) return existing
		const dir = await this.getDir(meta.id)
		const dataHandle = await dir.getFileHandle('data.part', { create: true })
		const manifest = this.manifests.get(meta.id) || (await readJsonFile<TransferManifest>(dir, 'manifest.json')) || manifestFor(meta)
		const writable = await openWritable(dataHandle, manifest.receivedBytes > 0)
		const active: ActiveOpfsFile = {
			dir,
			dataHandle,
			writable,
			manifest,
			pendingChunks: 0,
			pendingBytes: 0,
			closed: false,
		}
		this.manifests.set(meta.id, manifest)
		this.activeFiles.set(meta.id, active)
		return active
	}

	async prepare(meta: TransferFileMeta) {
		const root = await rootDirectory()
		await root.removeEntry(meta.id, { recursive: true }).catch(() => {})
		const dir = await fileDirectory(root, meta.id)
		const dataHandle = await dir.getFileHandle('data.part', { create: true })
		const manifest = manifestFor(meta)
		const writable = await openWritable(dataHandle, false)
		const active: ActiveOpfsFile = {
			dir,
			dataHandle,
			writable,
			manifest,
			pendingChunks: 0,
			pendingBytes: 0,
			closed: false,
		}
		this.manifests.set(meta.id, manifest)
		this.activeFiles.set(meta.id, active)
		await writeJsonFile(dir, 'manifest.json', manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const active = await this.ensureActive(meta)
		let manifest = active.manifest
		if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		if (!active.writable || active.closed) throw new Error('OPFS 写入器已经关闭，无法继续写入')
		await active.writable.write({
			type: 'write',
			position: chunkIndex * meta.chunkSize,
			data,
		})
		manifest = {
			...manifest,
			receivedBytes: manifest.receivedBytes + data.byteLength,
			receivedChunks: manifest.receivedChunks + 1,
			receivedRanges: addRange(manifest.receivedRanges, chunkIndex),
			status: manifest.receivedChunks + 1 >= meta.chunkCount ? 'complete' : 'receiving',
			updatedAt: Date.now(),
		}
		active.manifest = manifest
		active.pendingChunks += 1
		active.pendingBytes += data.byteLength
		this.manifests.set(meta.id, manifest)
		if (manifest.status === 'complete' || active.pendingChunks >= MANIFEST_FLUSH_CHUNKS || active.pendingBytes >= MANIFEST_FLUSH_BYTES) await this.flushManifest(meta.id)
		return manifest
	}

	async getManifest(fileId: string) {
		const active = this.activeFiles.get(fileId)
		if (active) return active.manifest
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
		const active = await this.ensureActive(meta)
		await this.flushManifest(meta.id)
		if (active.writable && !active.closed) {
			await active.writable.close()
			active.closed = true
			active.writable = null
		}
		await this.flushManifest(meta.id)
		const file = await active.dataHandle.getFile()
		if (file.size !== meta.size) throw new Error(`OPFS 文件大小异常：${file.size} / ${meta.size}`)
		const blob = new Blob([file], {
			type: meta.mime || 'application/octet-stream',
		})
		const url = URL.createObjectURL(blob)
		return { url, revoke: () => URL.revokeObjectURL(url) }
	}

	async cleanup(fileId: string) {
		const active = this.activeFiles.get(fileId)
		this.activeFiles.delete(fileId)
		this.manifests.delete(fileId)
		try {
			if (active?.writable && !active.closed) {
				await active.writable.abort().catch(() => active.writable?.close().catch(() => {}))
			}
		} catch {
			// ignore writer cleanup errors
		}
		try {
			const root = await rootDirectory()
			await root.removeEntry(fileId, { recursive: true })
		} catch {
			// ignore cleanup errors
		}
	}
}
