import { describe, expect, it } from 'vitest'
import { joinPdfPages } from '../../src/lib/pdf-text-extractor'

describe('PDF text result joining', () => {
  it('returns one page without adding a synthetic page marker', () => {
    expect(joinPdfPages([{ pageNumber: 1, text: 'hello' }])).toBe('hello')
  })

  it('preserves page boundaries for multi-page documents', () => {
    expect(joinPdfPages([
      { pageNumber: 1, text: 'one' },
      { pageNumber: 2, text: 'two' }
    ])).toBe('===== 第 1 页 =====\none\n\n===== 第 2 页 =====\ntwo')
  })

  it('returns empty output for an entirely empty document', () => {
    expect(joinPdfPages([{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '' }])).toBe('')
  })
})
