import { describe, expect, it, vi } from 'vitest'
import { CHARACTER_GROUPS, DEFAULT_RANDOM_OPTIONS, generateRandomPassword } from '../src/lib/password-generator'

const SAFE_SYMBOLS = '!#%&()*+,-./:;<=>?@[]^_{|}~'

describe('password generator symbols', () => {
	it('uses the configuration-safe 27-character symbol set', () => {
		expect(CHARACTER_GROUPS.symbols).toBe(SAFE_SYMBOLS)
		expect(new Set(CHARACTER_GROUPS.symbols).size).toBe(27)
		expect(CHARACTER_GROUPS.symbols).not.toMatch(/["'\\`$]/)
	})

	it('never generates an excluded configuration character', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (buffer: Uint32Array) => {
				buffer[0] = 0
				return buffer
			}
		})

		const password = generateRandomPassword({
			...DEFAULT_RANDOM_OPTIONS,
			length: 64,
			groups: { uppercase: false, lowercase: false, digits: false, symbols: true },
			avoidConsecutiveRepeat: false
		})

		expect(password).toMatch(new RegExp(`^[${SAFE_SYMBOLS.replace(/[\\\]^-]/g, '\\$&')}]+$`))
		expect(password).not.toMatch(/["'\\`$]/)
		vi.unstubAllGlobals()
	})
})
