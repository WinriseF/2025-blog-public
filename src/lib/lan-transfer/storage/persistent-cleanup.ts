import { loadAbandonedIncomingTransfers, removePersistentIncomingRecord, removeRoomTransfers } from '../runtime-store'
import { createStorageEngine } from './storage-manager'

export const LAN_RECEIVING_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const LAN_COMPLETED_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000

export async function cleanupLanTransferPersistentStorage({ now = Date.now(), activeRoomId = '' }: { now?: number; activeRoomId?: string } = {}) {
	const records = await loadAbandonedIncomingTransfers(now - LAN_COMPLETED_TRANSFER_TTL_MS).catch(() => [])
	await Promise.allSettled(records.map(async record => {
		if (record.roomId === activeRoomId) return
		const ttl = record.state === 'complete' ? LAN_COMPLETED_TRANSFER_TTL_MS : LAN_RECEIVING_TRANSFER_TTL_MS
		if (now - record.updatedAt < ttl) return
		await createStorageEngine(record.storage).cleanup(record.id).catch(() => {})
		await removePersistentIncomingRecord(record).catch(() => {})
	}))
}

export async function cleanupLanRoomPersistentStorage(roomId: string, localDeviceId: string) {
	const records = await removeRoomTransfers(roomId, localDeviceId).catch(() => [])
	await Promise.allSettled(records.map(record => createStorageEngine(record.storage).cleanup(record.id)))
}
