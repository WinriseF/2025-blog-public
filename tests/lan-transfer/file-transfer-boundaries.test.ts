import { describe, expect, it } from 'vitest'
import { encodeChunk, decodeFrame, prepareLanAttachment, receivedBytesFromRanges } from '../../src/lib/lan-transfer/file-transfer'
import { LAN_LIMITS } from '../../src/lib/lan-transfer/types'

describe('LAN file-transfer boundaries', () => {
  it('rejects a file above the peer maximum', () => {
    const file = new File([new Uint8Array(2)], 'x.bin')
    expect(() => prepareLanAttachment(file, { messageId: 'm', maxBytes: 1 })).toThrow(/最多可接收/)
  })

  it('never chooses a chunk larger than the data-channel maximum', () => {
    const file = new File([new Uint8Array(10)], 'x.bin')
    const prepared = prepareLanAttachment(file, { messageId: 'm', chunkSize: Number.MAX_SAFE_INTEGER })
    expect(prepared.chunkSize).toBeLessThanOrEqual(LAN_LIMITS.dataChannelMaxChunkSize)
    expect(prepared.chunkCount).toBe(Math.ceil(file.size / prepared.chunkSize))
  })

  it('handles the short final chunk when converting ranges into bytes', () => {
    const file = { size: 9, chunkSize: 4, chunkCount: 3 } as never
    expect(receivedBytesFromRanges(file, [[2, 2]])).toBe(1)
    expect(receivedBytesFromRanges(file, [[0, 2]])).toBe(9)
  })

  it('decodes ArrayBuffer views with byte offsets correctly', () => {
    const frame = encodeChunk('id', 2, new Uint8Array([7, 8, 9]))
    const padded = new Uint8Array(frame.length + 4)
    padded.set(frame, 2)
    const decoded = decodeFrame(padded.subarray(2, 2 + frame.length))
    expect(decoded?.kind).toBe('chunk')
    if (decoded?.kind === 'chunk') expect(Array.from(decoded.bytes)).toEqual([7, 8, 9])
  })
})
