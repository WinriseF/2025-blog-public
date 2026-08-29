import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanNativeAgentCapability } from '../../src/lib/lan-transfer/native-agent/capability'

afterEach(() => vi.unstubAllGlobals())

describe('native agent capability detection', () => {
  it('is disabled during SSR', () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined)
    expect(detectLanNativeAgentCapability()).toEqual({ device: 'desktop', webTransport: false, canHostAgent: false })
  })

  it('allows a secure desktop with WebTransport to host the agent', () => {
    vi.stubGlobal('window', { isSecureContext: true, WebTransport: function WebTransport() {} })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows Chrome/151', maxTouchPoints: 0, userAgentData: { mobile: false } })
    expect(detectLanNativeAgentCapability()).toEqual({ device: 'desktop', webTransport: true, canHostAgent: true })
  })

  it('treats iPad desktop UA and UA-data mobile hints as mobile', () => {
    vi.stubGlobal('window', { isSecureContext: true, WebTransport: function WebTransport() {} })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Macintosh Safari', maxTouchPoints: 5, userAgentData: { mobile: false } })
    expect(detectLanNativeAgentCapability().device).toBe('mobile')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows', maxTouchPoints: 0, userAgentData: { mobile: true } })
    expect(detectLanNativeAgentCapability().canHostAgent).toBe(false)
  })
})
