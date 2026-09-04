import { describe, expect, it } from 'vitest'
import { assertCanReceiveFile, selectStorageForFile } from '../../src/lib/lan-transfer/capability'
import type { LanCapability } from '../../src/lib/lan-transfer/types'

function capability(overrides: Partial<LanCapability> = {}): LanCapability {
  return {
    type: 'capability',
    protocolVersion: 14,
    peerId: 'peer',
    platform: 'desktop',
    browser: 'chrome',
    isEmbeddedBrowser: false,
    webTransport: false,
    storage: {
      memory: true,
      opfs: true,
      indexedDB: true,
      fileSystemAccess: false,
      available: 10 * 1024 * 1024 * 1024
    },
    limits: {
      maxRecommendedFileSize: 1024 * 1024 * 1024,
      maxExperimentalFileSize: 4 * 1024 * 1024 * 1024,
      recommendedChunkSize: 256 * 1024,
      recommendedStorage: 'opfs'
    },
    notes: [],
    ...overrides
  } as LanCapability
}

describe('LAN capability policy', () => {
  it('prefers memory for small files and persistent storage for larger files', () => {
    const c = capability()
    expect(selectStorageForFile(1024, c)).toBe('memory')
    expect(selectStorageForFile(512 * 1024 * 1024, c)).toBe('opfs')
  })

  it('prefers direct file output on desktop when File System Access exists', () => {
    const c = capability({
      storage: { ...capability().storage, fileSystemAccess: true },
      platform: 'desktop'
    })
    expect(selectStorageForFile(512 * 1024 * 1024, c)).toBe('file')
  })

  it('rejects large files in embedded browsers', () => {
    const c = capability({ isEmbeddedBrowser: true })
    expect(() => assertCanReceiveFile(512 * 1024 * 1024, c)).toThrow(/系统浏览器/)
  })

  it('rejects a transfer that exceeds available persistent storage', () => {
    const c = capability({
      storage: { ...capability().storage, available: 100 * 1024 * 1024 }
    })
    expect(() => assertCanReceiveFile(95 * 1024 * 1024, c)).toThrow(/空间不足/)
  })
})
