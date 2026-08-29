import { describe, expect, it } from 'vitest'
import { buildSolarTermPoints, formatSolarTermDate } from '../../src/lib/world-clock/solar-terms'

describe('24 solar terms', () => {
  it('builds exactly 24 ordered and unique terms for a normal year', () => {
    const points = buildSolarTermPoints(2026, new Date('2026-01-01T12:34:00Z'))
    expect(points).toHaveLength(24)
    expect(new Set(points.map(point => point.name)).size).toBe(24)
    expect(points.map(point => point.index)).toEqual([...Array(24).keys()])
  })

  it('classifies four cardinals and four season-start terms', () => {
    const points = buildSolarTermPoints(2026, new Date('2026-01-01T12:00:00Z'))
    expect(points.filter(point => point.kind === 'cardinal').map(point => point.name)).toEqual(['春分', '夏至', '秋分', '冬至'])
    expect(points.filter(point => point.kind === 'season-start').map(point => point.name)).toEqual(['立春', '立夏', '立秋', '立冬'])
  })

  it('preserves the requested UTC sample clock time for globe marker calculations', () => {
    const points = buildSolarTermPoints(2026, new Date('2026-01-01T07:23:59Z'))
    expect(points.every(point => point.sampleDate.getUTCHours() === 7 && point.sampleDate.getUTCMinutes() === 23 && point.sampleDate.getUTCSeconds() === 0)).toBe(true)
  })

  it('formats term dates in China standard time', () => {
    expect(formatSolarTermDate(new Date('2026-03-20T16:30:00Z'))).toBe('3月21日')
  })
})
