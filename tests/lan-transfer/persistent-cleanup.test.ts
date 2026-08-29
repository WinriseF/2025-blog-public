import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/lan-transfer/storage/indexeddb-storage', () => ({
  closeLanIndexedDb: vi.fn().mockResolvedValue(undefined),
  LAN_INDEXEDDB_NAME: 'lan-test-db'
}))
vi.mock('../../src/lib/lan-transfer/storage/opfs-storage', () => ({ LAN_OPFS_DIRECTORY_NAME: 'lan-opfs' }))

import { cleanupLanTransferPersistentStorage } from '../../src/lib/lan-transfer/storage/persistent-cleanup'

afterEach(() => vi.unstubAllGlobals())

describe('LAN persistent cleanup', () => {
  it('is safe when browser persistence APIs are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('navigator', {})
    await expect(cleanupLanTransferPersistentStorage()).resolves.toBeUndefined()
  })

  it('attempts both IndexedDB and OPFS cleanup without failing if one side errors', async () => {
    const deleteDatabase = vi.fn(() => {
      const req: any = {}
      queueMicrotask(() => req.onerror?.())
      return req
    })
    const removeEntry = vi.fn().mockRejectedValue(new Error('gone'))
    vi.stubGlobal('indexedDB', { deleteDatabase })
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn().mockResolvedValue({ removeEntry }) } })
    await expect(cleanupLanTransferPersistentStorage()).resolves.toBeUndefined()
    expect(deleteDatabase).toHaveBeenCalledWith('lan-test-db')
    expect(removeEntry).toHaveBeenCalledWith('lan-opfs', { recursive: true })
  })
})
