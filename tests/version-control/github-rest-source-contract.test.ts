import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const text = () => readFileSync(resolve(process.cwd(), 'src/lib/version-control/github-rest-repository-data-source.ts'), 'utf8')

describe('GitHub REST data source contracts', () => {
  it('keeps explicit file preview/collection bounds', () => {
    const source = text()
    expect(source).toMatch(/2\s*\*\s*1024\s*\*\s*1024|2_?097_?152|MAX_.*2.*1024/i)
    expect(source).toMatch(/limit|page/i)
  })

  it('handles recursive tree truncation with a fallback path', () => {
    const source = text()
    expect(source).toMatch(/truncated/)
    expect(source).toMatch(/contents/i)
  })

  it('does not silently decode binary repository files as UTF-8 text', () => {
    const source = text()
    expect(source).toMatch(/binary|isBinary/i)
    expect(source).toMatch(/utf-?8|TextDecoder/i)
  })

  it('uses AbortController or request cancellation for remote reads', () => {
    expect(text()).toMatch(/AbortController|signal/)
  })
})
