import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/ocr/ocr.worker.ts'), 'utf8')

describe('OCR worker contracts', () => {
  it('keeps OCR inference off the main thread', () => {
    const text = source()
    expect(text).toMatch(/self\.onmessage|addEventListener\(['"]message|onmessage/)
    expect(text).toMatch(/postMessage/)
  })

  it('reports initialization/recognition states or structured errors', () => {
    const text = source()
    expect(text).toMatch(/initializ|recogniz|status/i)
    expect(text).toMatch(/error|message/i)
  })

  it('does not fetch a model from an unpinned latest URL', () => {
    const urls = [...source().matchAll(/https?:\/\/[^'"`\s)]+/g)].map(m => m[0])
    for (const url of urls) expect(url).not.toMatch(/\/latest(?:\/|$)|@latest/i)
  })
})
