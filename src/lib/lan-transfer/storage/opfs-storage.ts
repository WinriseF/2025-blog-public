import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'
import { LAN_FILE_IO_BATCH_BYTES } from '../types'

type DirectoryHandle = FileSystemDirectoryHandle

type FileHandle = FileSystemFileHandle
type WritableFileStream = {
	write: (data: unknown) => Promise<void>
	close: () => Promise<void>
	abort: () => Promise<void>
}

const MANIFEST_FLUSH_CHUNKS = 64
const MANIFEST_FLUSH_BYTES = 32 * 1024 * 1024
export const LAN_OPFS_DIRECTORY_NAME = 'winrisef-lan-transfer-v3'

type PendingWrite = {
	chunkIndex: number
	data: Uint8Array
}

type ActiveOpfsFile = {
	dir: DirectoryHandle
	dataHandle: FileHandle
	writable: WritableFileStream | null
	manifest: TransferManifest
	pendingChunks: number
	pendingBytes: number
	closed: boolean
	writeBuffer: PendingWrite[]
	writeBufferBytes: number
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

async function rootDirectory(directoryName = LAN_OPFS_DIRECTORY_NAME) {
	if (!navigator.storage || !('getDirectory' in navigator.storage)) throw new Error('当前设备不支持接收大文件')
	const root = await navigator.storage.getDirectory()
	return await root.getDirectoryHandle(directoryName, {
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
	const writable = await (handle as FileHandle & { createWritable: () => Promise<WritableFileStream> }).createWritable()
	await writable.write(JSON.stringify(data))
	await writable.close()
}

async function openWritable(handle: FileHandle, keepExistingData: boolean) {
	const createWritable = (
		handle as FileHandle & {
			createWritable?: (options?: { keepExistingData?: boolean }) => Promise<WritableFileStream>
		}
	).createWritable
	if (typeof createWritable !== 'function') throw new Error('当前设备不支持接收大文件')
	return await createWritable.call(handle, { keepExistingData })
}

function combineBuffers(parts: Uint8Array[]) {
	if (parts.length === 1) return parts[0]
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
	const merged = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		merged.set(part, offset)
		offset += part.byteLength
	}
	return merged
}

export class OpfsStorageEngine implements LanStorageEngine {
	kind = 'opfs' as const
	private manifests = new Map<string, TransferManifest>()
	private activeFiles = new Map<string, ActiveOpfsFile>()

	constructor(private readonly directoryName = LAN_OPFS_DIRECTORY_NAME) {}

	private async getDir(fileId: string) {
		return fileDirectory(await rootDirectory(this.directoryName), fileId)
	}

	private async flushBufferedData(active: ActiveOpfsFile, meta: TransferFileMeta) {
		if (!active.writeBuffer.length) return active.manifest
		if (!active.writable || active.closed) throw new Error('文件保存中断，请重新接收')
		const first = active.writeBuffer[0]
		const combined = combineBuffers(active.writeBuffer.map(item => item.data))
		await active.writable.write({
			type: 'write',
			position: first.chunkIndex * meta.chunkSize,
			data: combined,
		})
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
			active.pendingChunks += 1
			active.pendingBytes += item.data.byteLength
		}
		active.writeBuffer = []
		active.writeBufferBytes = 0
		active.manifest = manifest
		this.manifests.set(meta.id, manifest)
		if (manifest.status === 'complete' || active.pendingChunks >= MANIFEST_FLUSH_CHUNKS || active.pendingBytes >= MANIFEST_FLUSH_BYTES) await this.flushManifest(meta.id)
		return manifest
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
			writeBuffer: [],
			writeBufferBytes: 0,
		}
		this.manifests.set(meta.id, manifest)
		this.activeFiles.set(meta.id, active)
		return active
	}

	async prepare(meta: TransferFileMeta) {
		const root = await rootDirectory(this.directoryName)
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
			writeBuffer: [],
			writeBufferBytes: 0,
		}
		this.manifests.set(meta.id, manifest)
		this.activeFiles.set(meta.id, active)
		await writeJsonFile(dir, 'manifest.json', manifest)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const active = await this.ensureActive(meta)
		let manifest = active.manifest
		if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		const expectedNextIndex = active.writeBuffer.length ? active.writeBuffer[0].chunkIndex + active.writeBuffer.length : chunkIndex
		if (chunkIndex !== expectedNextIndex) {
			manifest = await this.flushBufferedData(active, meta)
			if (manifest.receivedRanges.some(([start, end]) => chunkIndex >= start && chunkIndex <= end)) return manifest
		}
		active.writeBuffer.push({ chunkIndex, data })
		active.writeBufferBytes += data.byteLength
		const isFinalChunk = chunkIndex + 1 >= meta.chunkCount
		if (active.writeBufferBytes >= LAN_FILE_IO_BATCH_BYTES || isFinalChunk) manifest = await this.flushBufferedData(active, meta)
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

	async checkpoint(meta: TransferFileMeta) {
		const active = this.activeFiles.get(meta.id)
		if (active) {
			await this.flushBufferedData(active, meta)
			await this.flushManifest(meta.id)
		}
		return this.getManifest(meta.id)
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		const active = await this.ensureActive(meta)
		await this.flushBufferedData(active, meta)
		await this.flushManifest(meta.id)
		if (active.writable && !active.closed) {
			await active.writable.close()
			active.closed = true
			active.writable = null
		}
		await this.flushManifest(meta.id)
		const file = await active.dataHandle.getFile()
		if (file.size !== meta.size) throw new Error('文件保存失败，请重新发送')
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
			const root = await rootDirectory(this.directoryName)
			await root.removeEntry(fileId, { recursive: true })
		} catch {
			// ignore cleanup errors
		}
	}
}
