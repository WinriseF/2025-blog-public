import type { LanAttachmentOffer, LanStorageKind } from './types'

const databaseName = 'winrisef-lan-runtime-v14'
const databaseVersion = 1
const incomingStore = 'incoming'

export type LanRuntimeIdentity = {
	roomId: string
	localDeviceId: string
	remoteDeviceId: string
}

export type LanPersistentIncomingTransfer = LanRuntimeIdentity & {
	key: string
	id: string
	offer: LanAttachmentOffer
	storage: LanStorageKind
	state: 'receiving' | 'complete'
	updatedAt: number
}

let databasePromise: Promise<IDBDatabase> | null = null

function runtimeKey(identity: LanRuntimeIdentity) {
	return `${identity.roomId}:${identity.localDeviceId}:${identity.remoteDeviceId}`
}

function transferKey(identity: LanRuntimeIdentity, id: string) {
	return `${runtimeKey(identity)}:${id}`
}

function openDatabase() {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null)
	if (databasePromise) return databasePromise
	databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(databaseName, databaseVersion)
		request.onupgradeneeded = () => {
			const database = request.result
			if (database.objectStoreNames.contains(incomingStore)) return
			const store = database.createObjectStore(incomingStore, { keyPath: 'key' })
			store.createIndex('runtime', 'runtime', { unique: false })
			store.createIndex('updatedAt', 'updatedAt', { unique: false })
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error || new Error('无法读取传输恢复状态'))
	})
	return databasePromise
}

function requestValue<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error || new Error('无法保存传输恢复状态'))
	})
}

function transactionDone(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error || new Error('无法保存传输恢复状态'))
		transaction.onabort = () => reject(transaction.error || new Error('传输恢复状态写入已取消'))
	})
}

export async function saveIncomingTransfer(identity: LanRuntimeIdentity, offer: LanAttachmentOffer, storage: LanStorageKind, state: LanPersistentIncomingTransfer['state'] = 'receiving') {
	const database = await openDatabase()
	if (!database) return
	const record: LanPersistentIncomingTransfer & { runtime: string } = {
		...identity,
		key: transferKey(identity, offer.attachment.id),
		runtime: runtimeKey(identity),
		id: offer.attachment.id,
		offer,
		storage,
		state,
		updatedAt: Date.now(),
	}
	const transaction = database.transaction(incomingStore, 'readwrite')
	transaction.objectStore(incomingStore).put(record)
	await transactionDone(transaction)
}

export async function loadIncomingTransfers(identity: LanRuntimeIdentity) {
	const database = await openDatabase()
	if (!database) return []
	const transaction = database.transaction(incomingStore, 'readonly')
	const records = await requestValue(transaction.objectStore(incomingStore).index('runtime').getAll(runtimeKey(identity)))
	return records as LanPersistentIncomingTransfer[]
}

export async function removeIncomingTransfer(identity: LanRuntimeIdentity, id: string) {
	const database = await openDatabase()
	if (!database) return
	const transaction = database.transaction(incomingStore, 'readwrite')
	transaction.objectStore(incomingStore).delete(transferKey(identity, id))
	await transactionDone(transaction)
}

export async function removeRuntimeTransfers(identity: LanRuntimeIdentity) {
	const records = await loadIncomingTransfers(identity)
	const database = await openDatabase()
	if (!database || !records.length) return records
	const transaction = database.transaction(incomingStore, 'readwrite')
	for (const record of records) transaction.objectStore(incomingStore).delete(record.key)
	await transactionDone(transaction)
	return records
}

export async function removeRoomTransfers(roomId: string, localDeviceId: string) {
	const database = await openDatabase()
	if (!database) return []
	const readTransaction = database.transaction(incomingStore, 'readonly')
	const all = await requestValue(readTransaction.objectStore(incomingStore).getAll()) as LanPersistentIncomingTransfer[]
	const records = all.filter(record => record.roomId === roomId && record.localDeviceId === localDeviceId)
	if (!records.length) return records
	const writeTransaction = database.transaction(incomingStore, 'readwrite')
	for (const record of records) writeTransaction.objectStore(incomingStore).delete(record.key)
	await transactionDone(writeTransaction)
	return records
}

export async function loadAbandonedIncomingTransfers(updatedBefore: number) {
	const database = await openDatabase()
	if (!database) return []
	const transaction = database.transaction(incomingStore, 'readonly')
	const range = IDBKeyRange.upperBound(updatedBefore)
	const records = await requestValue(transaction.objectStore(incomingStore).index('updatedAt').getAll(range))
	return records as LanPersistentIncomingTransfer[]
}

export async function removePersistentIncomingRecord(record: LanPersistentIncomingTransfer) {
	const database = await openDatabase()
	if (!database) return
	const transaction = database.transaction(incomingStore, 'readwrite')
	transaction.objectStore(incomingStore).delete(record.key)
	await transactionDone(transaction)
}
