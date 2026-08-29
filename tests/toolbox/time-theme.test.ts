import { describe, expect, it } from 'vitest'
import { getMsUntilNextTimeTheme, getTimeThemeName, timeThemes } from '../../src/lib/time-theme'

describe('time theme boundaries', () => {
  const local = (hour: number, minute = 0) => new Date(2026, 7, 28, hour, minute, 0, 0)
  it.each([[4, 'night'], [5, 'dawn'], [8, 'dawn'], [9, 'noon'], [15, 'noon'], [16, 'sunset'], [18, 'sunset'], [19, 'night'], [23, 'night']] as const)(
    '%s:00 -> %s', (hour, expected) => expect(getTimeThemeName(local(hour))).toBe(expected)
  )

  it('returns a positive delay and points to the next boundary', () => {
    const date = local(8, 30)
    const ms = getMsUntilNextTimeTheme(date)
    expect(ms).toBe(30 * 60 * 1000 + 1000)
  })

  it('keeps every theme internally named and rendering parameters sane', () => {
    for (const [name, theme] of Object.entries(timeThemes)) {
      expect(theme.name).toBe(name)
      expect(theme.atmosphere.targetFps).toBeGreaterThan(0)
      expect(theme.atmosphere.minRadius).toBeLessThanOrEqual(theme.atmosphere.maxRadius)
      expect(theme.atmosphere.bottomBandStart).toBeGreaterThanOrEqual(0)
      expect(theme.atmosphere.bottomBandStart).toBeLessThanOrEqual(1)
    }
  })
})
