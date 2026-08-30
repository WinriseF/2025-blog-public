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

  it('cancels work while hidden and restarts with reset frame timing when visible again', () => {
    const h = harness(false); const draw = vi.fn()
    const loop = startAnimationLoop(draw, { targetFps: 50 })
    h.run(1000)
    h.document.hidden = true
    h.listeners.get('visibilitychange')?.()
    expect(h.window.clearTimeout).toHaveBeenCalled()

    h.document.hidden = false
    h.listeners.get('visibilitychange')?.()
    h.run(5000)
    expect(draw.mock.calls.map(([frame]) => frame.deltaMs)).toEqual([20, 20])
    loop.destroy()
  })

  it('observes an optional element and releases the observer on destroy', () => {
    const observe = vi.fn(); const disconnect = vi.fn()
    let notify: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    vi.stubGlobal('IntersectionObserver', vi.fn((callback: typeof notify) => {
      notify = callback
      return { observe, disconnect }
    }))
    const element = {} as Element
    const h = harness(false)

    const loop = startAnimationLoop(() => {}, { element })
    expect(observe).toHaveBeenCalledWith(element)
    notify?.([{ isIntersecting: false }])
    expect(h.window.cancelAnimationFrame).toHaveBeenCalled()
    loop.destroy()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
