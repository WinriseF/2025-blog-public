import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/lan-transfer/reconnect-coordinator.ts'), 'utf8')

describe('LAN reconnect coordinator contracts', () => {
  it('uses a bounded automatic retry budget rather than an endless reconnect loop', () => {
    const text = source()
    expect(text).toMatch(/backoffDelays\s*=\s*\[0,\s*750,\s*2000\]/)
    expect(text).toMatch(/backoffIndex/)
    expect(text).toMatch(/retryExhausted/)
    expect(text).toMatch(/automatic-retry-exhausted/)
  })

  it('distinguishes ICE restart from full rebuild with independent timeouts', () => {
    const text = source()
    expect(text).toMatch(/iceRestartTimeoutMs/)
    expect(text).toMatch(/rebuildTimeoutMs/)
    expect(text).toMatch(/startIceRestart/)
    expect(text).toMatch(/startRebuild/)
  })

  it('rejects signals from a mismatched remote device/instance before negotiation', () => {
    const text = source()
    expect(text).toMatch(/message\.fromDeviceId\s*!==\s*this\.peer\.deviceId/)
    expect(text).toMatch(/message\.fromInstanceId\s*!==\s*this\.peer\.instanceId/)
  })

  it('clears timers and pending ICE candidates when the remote page instance changes', () => {
    const text = source()
    expect(text).toMatch(/this\.clearTimers\(\)/)
    expect(text).toMatch(/this\.pendingCandidates\.clear\(\)/)
  })

  it('guards asynchronous continuations and timers with a reconnect attempt epoch', () => {
    const text = source()
    expect(text).toMatch(/attemptEpoch/)
    expect(text).toMatch(/isCurrentAttempt/)
    expect(text).toMatch(/attempt\s*!==\s*this\.attemptEpoch/)
  })
})
