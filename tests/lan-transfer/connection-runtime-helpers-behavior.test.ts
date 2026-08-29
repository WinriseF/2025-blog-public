import { describe, expect, it } from 'vitest'
import {
  attachmentFromOffer,
  attachmentFromPrepared,
  chooseReceiveStorage,
  clampBytes,
  historyMessageForSync,
  historyMessageFromRemote,
  isInlineMediaKind,
  isMobileCapability,
  isUserCancel,
  messageBase,
  receiveStorageCandidates,
  transferMeta
} from '../../src/lib/lan-transfer/connection-runtime-helpers'
import { LAN_LIMITS, type LanCapability, type LanChatMessage } from '../../src/lib/lan-transfer/types'

function capability(overrides: Partial<LanCapability> = {}): LanCapability {
  return {
    type: 'capability',
    protocolVersion: 13,
    peerId: 'peer',
    platform: 'desktop',
    browser: 'chrome',
    isEmbeddedBrowser: false,
    webTransport: true,
    storage: { memory: true, opfs: true, indexedDB: true, fileSystemAccess: true },
    limits: {
      maxRecommendedFileSize: Number.MAX_SAFE_INTEGER,
      maxExperimentalFileSize: Number.MAX_SAFE_INTEGER,
      recommendedChunkSize: 256 * 1024,
      recommendedStorage: 'file'
    },
    notes: [],
    ...overrides
  } as LanCapability
}

const manifest = {
  id: 'file-1', messageId: 'msg-1', kind: 'file', name: 'a.bin', mime: 'application/octet-stream',
  size: 1024, lastModified: 1, chunkSize: 512, chunkCount: 2, suggestedStorage: 'opfs', dataPlane: 'webrtc',
  file: new File([new Uint8Array(1024)], 'a.bin')
} as const

const offer = {
  type: 'attachment-offer', protocolVersion: 13, peerId: 'p', createdAt: 1, messageId: 'msg-1',
  attachment: { ...manifest, file: undefined, messageId: undefined }
} as any

describe('connection runtime helpers', () => {
  it('maps prepared and offered attachments without leaking transient state', () => {
    expect(attachmentFromPrepared(manifest as any, 'opfs', 'blob:preview')).toMatchObject({ direction: 'out', status: 'queued', progress: 0, storage: 'opfs', previewUrl: 'blob:preview' })
    expect(attachmentFromOffer(offer, 'indexeddb', 123)).toMatchObject({ direction: 'in', status: 'receiving', progress: 123, storage: 'indexeddb' })
    expect(transferMeta(offer, 'opfs')).toMatchObject({ id: 'file-1', storage: 'opfs' })
  })

  it('strips local-only history fields before syncing and inverts direction on receipt', () => {
    const message: LanChatMessage = {
      id: 'm', direction: 'out', kind: 'attachments', status: 'sent', createdAt: 1,
      attachments: [{ ...attachmentFromPrepared(manifest as any, 'memory', 'blob:x'), url: 'blob:y', speedBps: 100, etaSeconds: 2, phase: 'transferring' }]
    }
    const synced = historyMessageForSync(message)
    expect(synced.attachments[0]).not.toHaveProperty('url')
    expect(synced.attachments[0]).not.toHaveProperty('previewUrl')
    expect(synced.attachments[0]).not.toHaveProperty('speedBps')
    const remote = historyMessageFromRemote(synced)
    expect(remote.direction).toBe('in')
    expect(remote.status).toBe('received')
    expect(remote.attachments[0].direction).toBe('in')
  })

  it('prefers direct file storage on desktop, but can explicitly exclude it', () => {
    const cap = capability()
    expect(receiveStorageCandidates(100 * 1024 * 1024, 'opfs', cap, true)[0]).toBe('file')
    const withoutDirect = receiveStorageCandidates(100 * 1024 * 1024, 'opfs', cap, false)
    expect(withoutDirect[0]).toBe('opfs')
    expect(withoutDirect).not.toContain('file')
  })

  it('does not offer memory as a large-file fallback when no persistent storage exists', () => {
    const cap = capability({ storage: { memory: true, opfs: false, indexedDB: false, fileSystemAccess: false } as any })
    const large = LAN_LIMITS.memoryMaxBytes + 1
    expect(receiveStorageCandidates(large, 'memory', cap)).toEqual([])
    expect(chooseReceiveStorage(large, 'memory', cap)).toBe('memory')
  })

  it('classifies cancellation, mobile and inline-media helpers consistently', () => {
    expect(isUserCancel(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isUserCancel({ name: 'NotAllowedError' })).toBe(true)
    expect(isUserCancel(new Error('x'))).toBe(false)
    expect(isInlineMediaKind('image')).toBe(true)
    expect(isInlineMediaKind('voice')).toBe(true)
    expect(isInlineMediaKind('file')).toBe(false)
    expect(isMobileCapability(capability({ platform: 'ios' }))).toBe(true)
    expect(isMobileCapability(capability({ platform: 'desktop' }))).toBe(false)
  })

  it('clamps byte counts and initializes message status by direction', () => {
    expect(clampBytes(-1, 10)).toBe(0)
    expect(clampBytes(99, 10)).toBe(10)
    expect(messageBase('a', 'out', 1)).toMatchObject({ status: 'queued', kind: 'attachments' })
    expect(messageBase('a', 'in', 1)).toMatchObject({ status: 'received', kind: 'attachments' })
  })
})
