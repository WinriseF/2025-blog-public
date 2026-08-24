import { describe, expect, it } from 'vitest'
import { formatCompactNumber } from '../../src/app/toolbox/codex-session/format'

describe('Codex Session compact number formatting', () => {
	it('用 K/M 缩写总览中的大数', () => {
		expect(formatCompactNumber(999)).toBe('999')
		expect(formatCompactNumber(1000)).toBe('1K')
		expect(formatCompactNumber(12_400)).toBe('12.4K')
		expect(formatCompactNumber(999_499)).toBe('999K')
		expect(formatCompactNumber(999_500)).toBe('1M')
		expect(formatCompactNumber(1_754_380)).toBe('1.75M')
	})
})
