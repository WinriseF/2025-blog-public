import { describe, expect, it } from 'vitest'
import { getAlmanacDay } from '../../src/lib/calendar/almanac'
import { getCalendarFestival } from '../../src/lib/calendar/festivals'

describe('calendar integration', () => {
  it('recognizes fixed solar festivals', () => {
    expect(getCalendarFestival(new Date(2026, 9, 1))?.label).toBe('国庆节')
    expect(getCalendarFestival(new Date(2026, 11, 25))?.label).toBe('圣诞节')
  })

  it('returns compact lunar/almanac fields without unbounded activity lists', () => {
    const value = getAlmanacDay(new Date(2026, 7, 28))
    expect(value.lunarDate.length).toBeGreaterThan(0)
    expect(value.ganzhiDay.length).toBeGreaterThan(0)
    expect(value.yi.length).toBeLessThanOrEqual(5)
    expect(value.ji.length).toBeLessThanOrEqual(4)
    expect(Number.isFinite(value.nextJieQi.daysAway)).toBe(true)
    expect(Number.isFinite(value.prevJieQi.daysAway)).toBe(true)
  })
})
