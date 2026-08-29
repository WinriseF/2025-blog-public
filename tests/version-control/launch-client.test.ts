import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeVersionControlCallback, createVersionControlLaunchRequest } from '../../src/lib/version-control/launch-client'

function fakeWindow(hash = '') {
  const replaced: string[] = []
  return {
    value: {
      location: {
        origin: 'https://blog.example.test',
        pathname: '/toolbox/version-control/agent-return',
        search: '?from=test',
        hash
      },
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, url: string) {
          replaced.push(url)
        }
      }
    },
    replaced
  }
}

function callbackHash(bridge: string, expires = Date.now() + 60_000) {
  const params = new URLSearchParams({
    'winrisef-version-control': '1',
    nonce: 'a'.repeat(32),
    bridge,
    certificate: 'b'.repeat(64),
    token: 'c'.repeat(32),
    expires: String(expires)
  })
  return `#${params}`
}

afterEach(() => vi.unstubAllGlobals())

describe('version-control launch callback validation', () => {
  it('creates a 128-bit nonce and preserves the exact return origin', () => {
    const { value } = fakeWindow()
    vi.stubGlobal('window', value)
    const request = createVersionControlLaunchRequest()
    expect(request.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(request.uri).toContain('winrisef://launch?')
    expect(decodeURIComponent(request.uri)).toContain('https://blog.example.test/toolbox/version-control/agent-return')
  })

  it('accepts only the pinned localhost bridge path with an explicit port', () => {
    const { value } = fakeWindow(callbackHash('https://127.0.0.1:43123/winrisef/version-control/v2'))
    vi.stubGlobal('window', value)
    expect(consumeVersionControlCallback()?.bridgeEndpoint).toBe('https://127.0.0.1:43123/winrisef/version-control/v2')
  })

  it.each([
    'https://evil.example:43123/winrisef/version-control/v2',
    'https://localhost.evil.example:43123/winrisef/version-control/v2',
    'http://127.0.0.1:43123/winrisef/version-control/v2',
    'https://127.0.0.1/winrisef/version-control/v2',
    'https://127.0.0.1:43123/wrong',
    'https://user:pass@127.0.0.1:43123/winrisef/version-control/v2',
    'https://127.0.0.1:43123/winrisef/version-control/v2?x=1'
  ])('rejects unsafe bridge endpoint %s', bridge => {
    const { value } = fakeWindow(callbackHash(bridge))
    vi.stubGlobal('window', value)
    expect(consumeVersionControlCallback()).toBeNull()
  })

  it('rejects expired credentials', () => {
    const { value } = fakeWindow(callbackHash('https://localhost:43123/winrisef/version-control/v2', Date.now() - 1))
    vi.stubGlobal('window', value)
    expect(consumeVersionControlCallback()).toBeNull()
  })
})
