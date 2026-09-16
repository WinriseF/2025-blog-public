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
    expect(h.window.cancelAnimationFrame).toHaveBeenCalled()

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

// Model timers and display refreshes on one clock, including early timer wakeups.
function displayClock(hz: number) {
  let now = 0
  let nextId = 0
  const jobs = new Map<number, { at: number; run: () => void }>()
  const listeners = new Map<string, () => void>()
  const period = 1000 / hz
  const enqueue = (at: number, run: () => void) => {
    const id = ++nextId
    jobs.set(id, { at, run })
    return id
  }
  const document = {
    hidden: false,
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name)
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('window', {
    requestAnimationFrame: (fn: (timestamp: number) => void) => enqueue((Math.floor(now / period + 1e-7) + 1) * period, () => fn(now)),
    cancelAnimationFrame: (id: number) => jobs.delete(id),
    setTimeout: (fn: () => void, delay: number) => enqueue(now + delay, fn),
    clearTimeout: (id: number) => jobs.delete(id)
  })
  return {
    advance(end: number) {
      while (jobs.size) {
        const [id, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0]
        if (job.at > end + 1e-7) break
        jobs.delete(id)
        now = job.at
        job.run()
      }
      now = end
    },
    visibility(hidden: boolean) {
      document.hidden = hidden
      listeners.get('visibilitychange')?.()
    },
    pending: () => jobs.size
  }
}

describe('animation loop frame pacing', () => {
  it.each([60, 120, 144, 165])('keeps a 60 FPS budget on a %i Hz display', hz => {
    const clock = displayClock(hz)
    const timestamps: number[] = []
    const loop = startAnimationLoop(({ timestamp }) => timestamps.push(timestamp), { targetFps: 60 })
    clock.advance(5000)
    expect(timestamps.length).toBeGreaterThanOrEqual(299)
    expect(timestamps.length).toBeLessThanOrEqual(301)
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index] - timestamps[index - 1]).toBeLessThanOrEqual(1000 / 60 + 1000 / hz + 0.5)
    }
    loop.destroy()
    expect(clock.pending()).toBe(0)
  })

  it.each([5, 6, 8, 24, 30, 50])('honors a %i FPS budget without timer drift', fps => {
    const clock = displayClock(144)
    const draw = vi.fn()
    const loop = startAnimationLoop(draw, { targetFps: fps })
    clock.advance(10000)
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(fps * 10 - 1)
    expect(draw.mock.calls.length).toBeLessThanOrEqual(fps * 10 + 1)
    loop.destroy()
  })

  it('rebases a changing target and resets timing after hidden time', () => {
    const clock = displayClock(120)
    const draw = vi.fn()
    let fps = 50
    const loop = startAnimationLoop(draw, { targetFps: () => fps })
    clock.advance(2000)
    const beforeChange = draw.mock.calls.length
    fps = 60
    clock.advance(4000)
    expect(draw.mock.calls.length - beforeChange).toBeGreaterThanOrEqual(119)
    expect(draw.mock.calls.length - beforeChange).toBeLessThanOrEqual(121)
    clock.visibility(true)
    expect(clock.pending()).toBe(0)
    clock.advance(10000)
    const beforeResume = draw.mock.calls.length
    clock.visibility(false)
    clock.advance(10010)
    expect(draw.mock.calls.length).toBe(beforeResume + 1)
    expect(draw.mock.calls.at(-1)?.[0].deltaMs).toBeCloseTo(1000 / 60)
    loop.destroy()
  })

  it('does not reset a pending deadline when repeatedly woken', () => {
    const clock = displayClock(144)
    const draw = vi.fn()
    const loop = startAnimationLoop(draw, { targetFps: 6 })
    for (let time = 10; time <= 2000; time += 10) {
      clock.advance(time)
      loop.wake()
    }
    expect(draw.mock.calls.length).toBe(12)
    loop.destroy()
  })
})
