import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './types'
import { addRange, type ChunkRange } from './ranges'
import { LAN_LIMITS } from '../types'

export const LAN_INDEXEDDB_NAME = 'winrisef-lan-transfer-v3'
const DB_VERSION = 1
const MANIFESTS = 'manifests'
const CHUNKS = 'chunks'

type ChunkRecord = {
	key: string
	fileId: string
	chunkIndex: number
	data: ArrayBuffer
}

function chunkKey(fileId: string, chunkIndex: number) {
	return `${fileId}:${chunkIndex}`
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
		updatedAt: now
	}
}

function requestToPromise<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error || new Error('文件写入失败'))
	})
}

function transactionDone(tx: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error || new Error('文件写入失败'))
		tx.onabort = () => reject(tx.error || new Error('文件写入已取消'))
	})
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
	if (dbPromise) return dbPromise
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(LAN_INDEXEDDB_NAME, DB_VERSION)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(MANIFESTS)) db.createObjectStore(MANIFESTS, { keyPath: 'id' })
			if (!db.objectStoreNames.contains(CHUNKS)) {
				const store = db.createObjectStore(CHUNKS, { keyPath: 'key' })
				store.createIndex('fileId', 'fileId', { unique: false })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error || new Error('无法准备接收文件'))
	})
	return dbPromise
}

export async function closeLanIndexedDb() {
	if (!dbPromise) return
	const db = await dbPromise.catch(() => null)
	db?.close()
	dbPromise = null
}

export class IndexedDbStorageEngine implements LanStorageEngine {
	kind = 'indexeddb' as const

	async prepare(meta: TransferFileMeta) {
		const db = await openDb()
		const existing = await this.getManifest(meta.id)
		if (existing) return
		const tx = db.transaction(MANIFESTS, 'readwrite')
		tx.objectStore(MANIFESTS).put(manifestFor(meta))
		await transactionDone(tx)
	}

	async writeChunk(meta: TransferFileMeta, chunkIndex: number, data: Uint8Array) {
		const db = await openDb()
		let manifest = (await this.getManifest(meta.id)) || manifestFor(meta)
		const key = chunkKey(meta.id, chunkIndex)
		const exists = await requestToPromise(db.transaction(CHUNKS, 'readonly').objectStore(CHUNKS).getKey(key))
		if (!exists) {
			const copied = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer.slice(0) : data.slice().buffer) as ArrayBuffer
			manifest = {
				...manifest,
				receivedBytes: manifest.receivedBytes + data.byteLength,
				receivedChunks: manifest.receivedChunks + 1,
				receivedRanges: addRange(manifest.receivedRanges, chunkIndex),
				status: manifest.receivedChunks + 1 >= meta.chunkCount ? 'complete' : 'receiving',
				updatedAt: Date.now()
			}
			const tx = db.transaction([MANIFESTS, CHUNKS], 'readwrite')
			tx.objectStore(CHUNKS).put({ key, fileId: meta.id, chunkIndex, data: copied } satisfies ChunkRecord)
			tx.objectStore(MANIFESTS).put(manifest)
			await transactionDone(tx)
		}
		return manifest
	}

	async getManifest(fileId: string) {
		const db = await openDb()
		return ((await requestToPromise(db.transaction(MANIFESTS, 'readonly').objectStore(MANIFESTS).get(fileId))) as TransferManifest | undefined) || null
	}

	async getReceivedRanges(fileId: string): Promise<ChunkRange[]> {
		return (await this.getManifest(fileId))?.receivedRanges || []
	}

	async finalize(meta: TransferFileMeta) {
		if (meta.size > LAN_LIMITS.indexedDbExperimentalBytes) throw new Error('当前浏览器不能接收这么大的文件。')
		const db = await openDb()
		const tx = db.transaction(CHUNKS, 'readonly')
		const store = tx.objectStore(CHUNKS)
		const parts: BlobPart[] = []
		for (let index = 0; index < meta.chunkCount; index += 1) {
			const record = (await requestToPromise(store.get(chunkKey(meta.id, index)))) as ChunkRecord | undefined
			if (!record) throw new Error(`缺少分片 ${index}`)
			parts.push(record.data)
		}
		const blob = new Blob(parts, { type: meta.mime || 'application/octet-stream' })
		const url = URL.createObjectURL(blob)
		return { url, revoke: () => URL.revokeObjectURL(url) }
	}

	async cleanup(fileId: string) {
		const db = await openDb()
		const manifestTx = db.transaction(MANIFESTS, 'readwrite')
		manifestTx.objectStore(MANIFESTS).delete(fileId)
		await transactionDone(manifestTx)
		const tx = db.transaction(CHUNKS, 'readwrite')
		const index = tx.objectStore(CHUNKS).index('fileId')
		const keys = await requestToPromise(index.getAllKeys(fileId))
		for (const key of keys) tx.objectStore(CHUNKS).delete(key)
		await transactionDone(tx)
	}
}
