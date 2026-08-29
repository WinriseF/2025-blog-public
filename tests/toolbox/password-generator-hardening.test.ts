import { describe, expect, it } from 'vitest'
import {
  CHARACTER_GROUPS,
  DEFAULT_RANDOM_OPTIONS,
  estimatePinEntropy,
  estimateRandomPasswordEntropy,
  generatePin,
  generateRandomPassword,
  getPasswordStrength
} from '../../src/lib/password-generator'

describe('password generator hardening', () => {
  it('guarantees every enabled group appears in every generated password', () => {
    for (let run = 0; run < 100; run += 1) {
      const value = generateRandomPassword({ ...DEFAULT_RANDOM_OPTIONS, length: 24, excludeSimilar: false })
      expect(value).toMatch(/[A-Z]/)
      expect(value).toMatch(/[a-z]/)
      expect(value).toMatch(/[0-9]/)
      expect([...value].some(char => CHARACTER_GROUPS.symbols.includes(char))).toBe(true)
    }
  })

  it('never emits excluded characters', () => {
    const excluded = 'ABCabc123!@#'
    for (let run = 0; run < 100; run += 1) {
      const value = generateRandomPassword({
        ...DEFAULT_RANDOM_OPTIONS,
        length: 64,
        excludeSimilar: false,
        excludedCharacters: excluded
      })
      for (const char of excluded) expect(value).not.toContain(char)
    }
  })

  it('never emits adjacent repeated characters when avoidance is enabled', () => {
    for (let run = 0; run < 100; run += 1) {
      const value = generateRandomPassword({ ...DEFAULT_RANDOM_OPTIONS, length: 64 })
      expect(/(.)\1/.test(value)).toBe(false)
    }
  })

  it('PIN generation follows the same adjacent-repeat guarantee', () => {
    for (let run = 0; run < 100; run += 1) {
      const value = generatePin({ length: 32, avoidConsecutiveRepeat: true })
      expect(value).toMatch(/^\d{32}$/)
      expect(/(.)\1/.test(value)).toBe(false)
    }
  })

  it('rejects impossible random-password configurations instead of silently weakening them', () => {
    expect(() => generateRandomPassword({
      ...DEFAULT_RANDOM_OPTIONS,
      length: 2,
      groups: { uppercase: true, lowercase: true, digits: true, symbols: false }
    })).toThrow()
  })

  it('entropy estimates grow monotonically with length', () => {
    const short = estimateRandomPasswordEntropy({ ...DEFAULT_RANDOM_OPTIONS, length: 12 })
    const long = estimateRandomPasswordEntropy({ ...DEFAULT_RANDOM_OPTIONS, length: 24 })
    expect(long).toBeGreaterThan(short)
    expect(estimatePinEntropy({ length: 12, avoidConsecutiveRepeat: true })).toBeGreaterThan(estimatePinEntropy({ length: 6, avoidConsecutiveRepeat: true }))
  })

  it('strength boundaries are stable', () => {
    expect(getPasswordStrength(39.9).label).toBe('弱')
    expect(getPasswordStrength(40).label).toBe('中等')
    expect(getPasswordStrength(60).label).toBe('强')
    expect(getPasswordStrength(80).label).toBe('极强')
  })
})
