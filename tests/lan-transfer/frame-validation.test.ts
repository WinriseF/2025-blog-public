import { describe, expect, it } from 'vitest'
import {
  decodeFrame,
  encodeChunk,
  encodeControl,
  nextMissingChunkIndex,
  receivedBytesFromRanges
} from '../../src/lib/lan-transfer/file-transfer'

const encoder = new TextEncoder()

function rawDataFrame(header: unknown, payload = new Uint8Array([1, 2, 3])) {
  const bytes = encoder.encode(JSON.stringify(header))
  const frame = new Uint8Array(3 + bytes.length + payload.length)
  frame[0] = 2
  frame[1] = (bytes.length >> 8) & 0xff
  frame[2] = bytes.length & 0xff
  frame.set(bytes, 3)
  frame.set(payload, 3 + bytes.length)
  return frame
}

describe('LAN frame codec', () => {
  it('round-trips a control frame', () => {
    const message = {
      type: 'chat-message',
      protocolVersion: 14,
      peerId: 'peer',
      seq: 1,
      createdAt: 1,
      id: 'message-id',
      text: 'hello'
    } as never
    const decoded = decodeFrame(encodeControl(message))
    expect(decoded).toEqual({ kind: 'control', message })
  })

  it('round-trips chunk bytes without copying semantics changing the payload', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const decoded = decodeFrame(encodeChunk('attachment-id', 7, bytes))
    expect(decoded?.kind).toBe('chunk')
    if (decoded?.kind !== 'chunk') throw new Error('chunk not decoded')
    expect(decoded.id).toBe('attachment-id')
    expect(decoded.index).toBe(7)
    expect(decoded.bytes).toEqual(bytes)
  })

  it('never throws on arbitrary malformed binary frames', () => {
    for (let length = 0; length < 512; length += 1) {
      const bytes = new Uint8Array(length)
      for (let index = 0; index < length; index += 1) bytes[index] = (index * 131 + length * 17) & 0xff
      expect(() => decodeFrame(bytes)).not.toThrow()
    }
  })

})

describe('LAN resume math', () => {
  const file = {
    size: 10,
    chunkSize: 4,
    chunkCount: 3
  } as never

  it('counts bytes represented by sparse received ranges', () => {
    expect(receivedBytesFromRanges(file, [[0, 0], [2, 2]])).toBe(6)
  })

  it('finds the first missing chunk from a requested offset', () => {
    expect(nextMissingChunkIndex(file, [[0, 0], [2, 2]], 0)).toBe(1)
    expect(nextMissingChunkIndex(file, [[0, 2]], 0)).toBe(-1)
  })
})
