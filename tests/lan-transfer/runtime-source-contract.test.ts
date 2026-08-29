import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/lan-transfer/connection-runtime.ts'), 'utf8')

describe('LAN connection runtime structural contracts', () => {
  it('keeps transport epochs/generations in reconnect resume validation', () => {
    const text = source()
    expect(text).toMatch(/transportEpoch/)
    expect(text).toMatch(/transportGeneration/)
    expect(text).toMatch(/message\.resumeId\s*!==\s*sync\.id/)
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
})
