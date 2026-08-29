import { describe, expect, it } from 'vitest'
import { addRange, countRanges, hasChunk, mergeRanges } from '../../src/lib/lan-transfer/storage/ranges'

describe('LAN chunk ranges', () => {
  it('merges overlapping, adjacent, and unsorted ranges', () => {
    expect(mergeRanges([[8, 10], [1, 2], [3, 5], [9, 12], [20, 20]])).toEqual([[1, 5], [8, 12], [20, 20]])
  })

  it('keeps addRange idempotent for already received chunks', () => {
    expect(addRange([[0, 3]], 2)).toEqual([[0, 3]])
  })

  it('reports membership and exact chunk counts', () => {
    const ranges: [number, number][] = [[0, 2], [5, 7]]
    expect(hasChunk(ranges, 1)).toBe(true)
    expect(hasChunk(ranges, 4)).toBe(false)
    expect(countRanges(ranges)).toBe(6)
  })
})
