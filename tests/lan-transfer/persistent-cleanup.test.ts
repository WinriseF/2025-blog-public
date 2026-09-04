import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(), remove: vi.fn(), removeRoom: vi.fn(), cleanup: vi.fn(),
}))

vi.mock('../../src/lib/lan-transfer/runtime-store', () => ({
  loadAbandonedIncomingTransfers: mocks.load,
  removePersistentIncomingRecord: mocks.remove,
  removeRoomTransfers: mocks.removeRoom,
}))
vi.mock('../../src/lib/lan-transfer/storage/storage-manager', () => ({
  createStorageEngine: () => ({ cleanup: mocks.cleanup }),
}))

import { cleanupLanTransferPersistentStorage, LAN_COMPLETED_TRANSFER_TTL_MS, LAN_RECEIVING_TRANSFER_TTL_MS } from '../../src/lib/lan-transfer/storage/persistent-cleanup'

const base = {
  key: 'key', id: 'file', roomId: 'room', localDeviceId: 'local', remoteDeviceId: 'remote',
  offer: {}, storage: 'opfs',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue([])
  mocks.remove.mockResolvedValue(undefined)
  mocks.removeRoom.mockResolvedValue([])
  mocks.cleanup.mockResolvedValue(undefined)
})

describe('LAN abandoned transfer cleanup', () => {
  it('does not delete active or recently updated transfers', async () => {
    const now = 10 * LAN_RECEIVING_TRANSFER_TTL_MS
    mocks.load.mockResolvedValue([{ ...base, state: 'receiving', updatedAt: now - LAN_RECEIVING_TRANSFER_TTL_MS + 1 }])
    await cleanupLanTransferPersistentStorage({ now })
    expect(mocks.cleanup).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('expires completed data sooner than an interrupted transfer', async () => {
    const now = 10 * LAN_RECEIVING_TRANSFER_TTL_MS
    const completed = { ...base, state: 'complete', updatedAt: now - LAN_COMPLETED_TRANSFER_TTL_MS }
    const receiving = { ...base, key: 'receiving', id: 'receiving', state: 'receiving', updatedAt: now - LAN_RECEIVING_TRANSFER_TTL_MS }
    mocks.load.mockResolvedValue([completed, receiving])
    await cleanupLanTransferPersistentStorage({ now })
    expect(mocks.cleanup).toHaveBeenCalledTimes(2)
    expect(mocks.remove).toHaveBeenCalledTimes(2)
  })

  it('never collects records belonging to the active room', async () => {
    const now = 10 * LAN_RECEIVING_TRANSFER_TTL_MS
    mocks.load.mockResolvedValue([{ ...base, state: 'receiving', updatedAt: 1 }])
    await cleanupLanTransferPersistentStorage({ now, activeRoomId: 'room' })
    expect(mocks.cleanup).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
