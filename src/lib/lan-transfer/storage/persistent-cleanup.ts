import { closeLanIndexedDb, LAN_INDEXEDDB_NAME } from './indexeddb-storage'
import { LAN_OPFS_DIRECTORY_NAME } from './opfs-storage'

function deleteIndexedDb(name: string) {
	if (typeof indexedDB === 'undefined') return Promise.resolve()
	return new Promise<void>((resolve) => {
		const request = indexedDB.deleteDatabase(name)
		request.onsuccess = () => resolve()
		request.onerror = () => resolve()
		request.onblocked = () => resolve()
	})
}

async function cleanupOpfsDirectory() {
	if (typeof navigator === 'undefined' || !navigator.storage || !('getDirectory' in navigator.storage)) return
	const root = await navigator.storage.getDirectory()
	await root.removeEntry(LAN_OPFS_DIRECTORY_NAME, { recursive: true }).catch(() => {})
}

export async function cleanupLanTransferPersistentStorage() {
	await Promise.allSettled([
		closeLanIndexedDb().then(() => deleteIndexedDb(LAN_INDEXEDDB_NAME)),
		cleanupOpfsDirectory(),
	])
}
