import { describe, expect, it } from 'vitest'
import { DEFAULT_RANDOM_OPTIONS, estimatePassphraseEntropy, estimatePinEntropy, estimateRandomPasswordEntropy, getPasswordStrength } from '../../src/lib/password-generator'

describe('password entropy estimators', () => {
  it('increases random password entropy with length', () => {
    const short = estimateRandomPasswordEntropy({ ...DEFAULT_RANDOM_OPTIONS, length: 12 })
    const long = estimateRandomPasswordEntropy({ ...DEFAULT_RANDOM_OPTIONS, length: 24 })
    expect(long).toBeGreaterThan(short)
  })

  it('uses 9 choices after the first PIN digit when consecutive repeats are forbidden', () => {
    expect(estimatePinEntropy({ length: 2, avoidConsecutiveRepeat: true })).toBeCloseTo(Math.log2(10) + Math.log2(9))
  })

  it('adds one decimal digit worth of entropy to passphrases when enabled', () => {
    const base = estimatePassphraseEntropy({ language: 'english', wordCount: 6, separator: '-', capitalize: false, appendDigit: false })
    const digit = estimatePassphraseEntropy({ language: 'english', wordCount: 6, separator: '-', capitalize: false, appendDigit: true })
    expect(digit - base).toBeCloseTo(Math.log2(10))
  })

  it('keeps strength thresholds stable at 40/60/80 bits', () => {
    expect(getPasswordStrength(39.9).label).toBe('弱')
    expect(getPasswordStrength(40).label).toBe('中等')
    expect(getPasswordStrength(60).label).toBe('强')
    expect(getPasswordStrength(80).label).toBe('极强')
  })
})
