import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAnimationLoop } from '../../src/lib/animation-loop'

afterEach(() => vi.unstubAllGlobals())

function harness(hidden = false) {
  let raf: ((ts: number) => void) | undefined
  const listeners = new Map<string, Function>()
  const document = { hidden, addEventListener: vi.fn((name: string, fn: Function) => listeners.set(name, fn)), removeEventListener: vi.fn() }
  const window = { requestAnimationFrame: vi.fn((fn: (ts: number) => void) => { raf = fn; return 1 }), cancelAnimationFrame: vi.fn(), setTimeout: vi.fn(() => 2), clearTimeout: vi.fn() }
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('performance', { now: () => 0 })
  return { document, window, listeners, run: (ts: number) => raf?.(ts) }
}

describe('animation loop lifecycle', () => {
  it('does not schedule frames while the document is hidden', () => {
    const h = harness(true)
    const loop = startAnimationLoop(() => {})
    expect(h.window.requestAnimationFrame).not.toHaveBeenCalled()
    loop.destroy()
  })

  it('draws a bounded first delta and removes listeners on destroy', () => {
    const h = harness(false); const draw = vi.fn()
    const loop = startAnimationLoop(draw, { targetFps: 50, maxDeltaMs: 100 })
    h.run(1000)
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ deltaMs: 20, elapsedMs: 20, timestamp: 1000 }))
    loop.destroy()
    expect(h.document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
