import { describe, expect, it } from 'vitest'
import { chooseStorageKind, createStorageEngine } from '../../src/lib/lan-transfer/storage/storage-manager'
import { LAN_LIMITS } from '../../src/lib/lan-transfer/types'

function capability(storage: { fileSystemAccess?: boolean; opfs?: boolean; indexedDB?: boolean }) {
  return { storage: { memory: true, fileSystemAccess: false, opfs: false, indexedDB: false, ...storage } } as never
}

describe('LAN storage manager', () => {
  it('always keeps small payloads in memory', () => {
    expect(chooseStorageKind(LAN_LIMITS.memoryMaxBytes, 'file', capability({ fileSystemAccess: true }))).toBe('memory')
  })

  it('honors an available requested persistent backend', () => {
    const size = LAN_LIMITS.memoryMaxBytes + 1
    expect(chooseStorageKind(size, 'file', capability({ fileSystemAccess: true }))).toBe('file')
    expect(chooseStorageKind(size, 'opfs', capability({ opfs: true }))).toBe('opfs')
    expect(chooseStorageKind(size, 'indexeddb', capability({ indexedDB: true }))).toBe('indexeddb')
  })

  it('falls back by capability priority when requested storage is unavailable', () => {
    const size = LAN_LIMITS.memoryMaxBytes + 1
    expect(chooseStorageKind(size, 'opfs', capability({ fileSystemAccess: true, indexedDB: true }))).toBe('file')
    expect(chooseStorageKind(size, 'file', capability({ opfs: true, indexedDB: true }))).toBe('opfs')
    expect(chooseStorageKind(size, 'opfs', capability({ indexedDB: true }))).toBe('indexeddb')
  })

  it('constructs an engine with the requested kind', () => {
    for (const kind of ['memory', 'file', 'opfs', 'indexeddb'] as const) expect(createStorageEngine(kind).kind).toBe(kind)
  })
})
