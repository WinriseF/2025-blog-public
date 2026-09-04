import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/lan-transfer/connection-runtime.ts'), 'utf8')

describe('LAN connection runtime structural contracts', () => {
  it('uses a resume id and local transport identity without wire-level reconnect generations', () => {
    const text = source()
    expect(text).toMatch(/transportEpoch/)
    expect(text).toMatch(/message\.resumeId\s*!==\s*sync\.id/)
    expect(text).not.toMatch(/message\.transportGeneration/)
  })

  it('serializes incoming persistent writes through a queue', () => {
    const text = source()
    expect(text).toMatch(/chunkWriteQueue\s*=\s*this\.chunkWriteQueue\.then/)
    expect(text).toMatch(/await this\.chunkWriteQueue/)
  })

  it('clears timers and object URLs during reset', () => {
    const text = source()
    expect(text).toMatch(/clearTimeout\(pending\.timer\)/)
    expect(text).toMatch(/URL\.revokeObjectURL/)
  })

  it('hydrates persistent receiver state before processing resumed frames', () => {
    const text = source()
    expect(text).toMatch(/hydratePersistentState/)
    expect(text).toMatch(/loadIncomingTransfers/)
    expect(text).toMatch(/destroy\(cleanupPersistent = false\)/)
  })
})
