import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinPdfPages } from '../../src/lib/pdf-text-extractor'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/pdf-text-extractor.ts'), 'utf8')

describe('PDF extraction hardening', () => {
  it('preserves an empty page marker when other pages contain text', () => {
    expect(joinPdfPages([{ pageNumber: 1, text: 'one' }, { pageNumber: 2, text: '' }])).toContain('===== 第 2 页 =====')
  })

  it('keeps render scale and maximum canvas side bounded', () => {
    const text = source()
    expect(text).toMatch(/MAX_RENDER_SCALE\s*=\s*2\.5/)
    expect(text).toMatch(/MAX_RENDER_SIDE\s*=\s*2600/)
  })

  it('terminates OCR worker and cancels active rendering on abort', () => {
    const text = source()
    expect(text).toMatch(/active\.renderTask\?\.cancel\(\)/)
    expect(text).toMatch(/ocrWorker\?\.terminate\(\)/)
  })

})
