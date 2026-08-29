import { describe, expect, it } from 'vitest'
import {
  coordinatesToVector, formatCoordinate, formatSignedMinutes, getDaylightLabel, getEquationOfTimeMinutes,
  getJulianDate, getSubsolarPoint, getSunAltitude, getWorldClockReading, normalizeDegrees, normalizeLongitude, vectorToCoordinates
} from '../../src/lib/world-clock/solar'

describe('world clock solar math', () => {
  it('round-trips coordinates through the globe vector transform', () => {
    for (const point of [{ lat: 0, lon: 0 }, { lat: 31.23, lon: 121.47 }, { lat: -33.87, lon: 151.21 }, { lat: 89.9, lon: -179.9 }]) {
      const round = vectorToCoordinates(coordinatesToVector(point, 3))
      expect(round.lat).toBeCloseTo(point.lat, 8)
      expect(normalizeLongitude(round.lon - point.lon)).toBeCloseTo(0, 8)
    }
  })

  it('normalizes degree and longitude boundaries deterministically', () => {
    expect(normalizeDegrees(-1)).toBe(359)
    expect(normalizeDegrees(721)).toBe(1)
    expect(normalizeLongitude(181)).toBe(-179)
    expect(normalizeLongitude(-180)).toBe(180)
  })

  it('uses the canonical J2000 Julian date', () => {
    expect(getJulianDate(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545, 8)
  })

  it('places the subsolar latitude near the equator around equinox', () => {
    const point = getSubsolarPoint(new Date('2026-03-20T14:45:00Z'))
    expect(Math.abs(point.lat)).toBeLessThan(1)
    expect(point.lon).toBeGreaterThanOrEqual(-180)
    expect(point.lon).toBeLessThanOrEqual(180)
  })

  it('sun altitude at the subsolar point is approximately 90 degrees', () => {
    const date = new Date('2026-06-21T12:00:00Z')
    const subsolar = getSubsolarPoint(date)
    expect(getSunAltitude(date, subsolar)).toBeCloseTo(90, 6)
  })

  it('keeps the equation of time in its physically plausible range', () => {
    for (let month = 0; month < 12; month++) {
      expect(Math.abs(getEquationOfTimeMinutes(new Date(Date.UTC(2026, month, 15, 12))))).toBeLessThan(20)
    }
  })

  it('maps twilight thresholds without gaps', () => {
    expect(getDaylightLabel(6)).toBe('白昼')
    expect(getDaylightLabel(0)).toBe('低角度日照')
    expect(getDaylightLabel(-6)).toBe('民用晨昏')
    expect(getDaylightLabel(-12)).toBe('航海晨昏')
    expect(getDaylightLabel(-18)).toBe('天文晨昏')
    expect(getDaylightLabel(-18.01)).toBe('夜晚')
  })

  it('uses China standard time for Shanghai and normalizes out-of-range coordinates', () => {
    const reading = getWorldClockReading(new Date('2026-08-29T06:00:00Z'), { lat: 31.23, lon: 121.47 })
    expect(reading.timeZone).toBe('Asia/Shanghai')
    expect(reading.utcOffset).toBe('UTC+08:00')
    const clamped = getWorldClockReading(new Date('2026-08-29T06:00:00Z'), { lat: 100, lon: 540 })
    expect(clamped.coordinates).toEqual({ lat: 90, lon: 180 })
  })

  it('formats coordinates and signed minute offsets consistently', () => {
    expect(formatCoordinate(-12.345, 'E', 'W')).toBe('12.35°W')
    expect(formatSignedMinutes(1.25)).toBe('+1.3 min')
    expect(formatSignedMinutes(-1.25)).toBe('-1.3 min')
  })
})
