import { describe, expect, it } from 'vitest'
import { estimateVideoOutputBytes, resolveVideoCompressionConfig, VIDEO_PRESETS } from '../../src/lib/video-compress/presets'

function inspection(overrides: Record<string, unknown> = {}) {
  return { width: 3840, height: 2160, duration: 60, size: 600 * 1024 * 1024, frameRate: 60, videoBitrate: 70_000_000, audioBitrate: 192_000, audioCodec: 'aac', ...overrides } as never
}

const custom = { maxHeight: 900, frameRate: 24, videoBitrateMbps: 3.5 }

describe('video compression presets', () => {
  it('keeps preset ids unique and includes custom mode', () => {
    expect(new Set(VIDEO_PRESETS.map(p => p.id)).size).toBe(VIDEO_PRESETS.length)
    expect(VIDEO_PRESETS.some(p => p.id === 'custom')).toBe(true)
  })

  it('caps balanced at 1080p and compact at 720p while preserving aspect ratio approximately', () => {
    const balanced = resolveVideoCompressionConfig(inspection(), 'balanced', custom)
    const compact = resolveVideoCompressionConfig(inspection(), 'compact', custom)
    expect(balanced.height).toBe(1080); expect(compact.height).toBe(720)
    expect(balanced.width / balanced.height).toBeCloseTo(16 / 9, 2)
    expect(compact.width % 2).toBe(0); expect(compact.height % 2).toBe(0)
  })

  it('never raises source frame rate', () => {
    expect(resolveVideoCompressionConfig(inspection({ frameRate: 23.976 }), 'clarity', custom).frameRate).toBeCloseTo(23.976)
    expect(resolveVideoCompressionConfig(inspection({ frameRate: 120 }), 'balanced', custom).frameRate).toBe(30)
  })

  it('does not request a bitrate above the preset cap or below 250kbps', () => {
    for (const preset of ['clarity', 'balanced', 'compact'] as const) {
      const config = resolveVideoCompressionConfig(inspection({ size: 1_000_000, duration: 600 }), preset, custom)
      expect(config.videoBitrate).toBeGreaterThanOrEqual(250_000)
    }
  })

  it('returns null estimate without a finite duration and positive bytes otherwise', () => {
    const config = resolveVideoCompressionConfig(inspection(), 'balanced', custom)
    expect(estimateVideoOutputBytes(inspection({ duration: undefined }), config)).toBeNull()
    expect(estimateVideoOutputBytes(inspection(), config)).toBeGreaterThan(0)
  })
})
