import { describe, expect, it } from 'vitest'
import { clampRect, expandBox, moveRect, rectFromCenter, resizeRect } from '../../src/lib/face-mask/geometry'

describe('face-mask geometry', () => {
  it('keeps rectangles fully inside the image', () => {
    const rect = clampRect({ x: -50, y: 90, width: 80, height: 80 }, 100, 100, 10)
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(100); expect(rect.y + rect.height).toBeLessThanOrEqual(100)
  })

  it('clamps oversized masks to the image dimensions', () => {
    expect(clampRect({ x: 10, y: 10, width: 1000, height: 1000 }, 200, 100, 10)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('expands a box symmetrically when there is room', () => {
    expect(expandBox({ x: 40, y: 40, width: 20, height: 20 }, 100, 100, 1)).toEqual({ x: 30, y: 30, width: 40, height: 40 })
  })

})
