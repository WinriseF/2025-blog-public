import { describe, expect, it } from 'vitest'
import { clamp, hexToHsva, hexToRgb, hexToRgba, hslToRgb, hsvaToHex, rgbToHex, rgbToHsl } from '../../src/lib/color'

describe('color conversion utilities', () => {
  it('round-trips representative opaque RGB colors', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#35bfab', '#f06c8f']) {
      const { r, g, b } = hexToRgb(hex)
      expect(rgbToHex(r, g, b).toLowerCase()).toBe(hex.toLowerCase())
      const hsva = hexToHsva(hex)
      expect(hsvaToHex(hsva.h, hsva.s, hsva.v, hsva.a).toLowerCase()).toBe(hex.toLowerCase())
    }
  })

  it('preserves 8-digit alpha within one quantization step', () => {
    const rgba = hexToRgba('#33669980')
    expect(rgba.a).toBeCloseTo(128 / 255, 8)
    const hsva = hexToHsva('#33669980')
    expect(hsvaToHex(hsva.h, hsva.s, hsva.v, hsva.a).toLowerCase()).toBe('#33669980')
  })

  it('maps HSL primary colors correctly', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 })
    expect(rgbToHsl(0, 0, 255).h).toBeCloseTo(240)
  })

  it('clamps numeric values to the closed interval', () => {
    expect(clamp(-1, 0, 1)).toBe(0); expect(clamp(2, 0, 1)).toBe(1); expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
