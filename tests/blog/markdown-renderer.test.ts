import { beforeEach, describe, expect, it, vi } from 'vitest'

const shiki = vi.hoisted(() => ({ codeToHtml: vi.fn() }))
vi.mock('shiki', () => ({ codeToHtml: shiki.codeToHtml }))

import { renderMarkdown, slugify } from '../../src/lib/markdown-renderer'

beforeEach(() => {
  shiki.codeToHtml.mockReset()
  shiki.codeToHtml.mockImplementation(async (code: string) => `<pre class="shiki"><code>${code}</code></pre>`)
})

describe('markdown renderer', () => {
  it('creates stable slugs for Chinese and ASCII headings', () => {
    expect(slugify('MySQL 底层原理！')).toBe('mysql-底层原理')
  })

  it('highlights normal fenced code but leaves Mermaid to its dedicated renderer', async () => {
    const result = await renderMarkdown('```ts\nconst x = 1\n```\n\n```mermaid\ngraph TD; A-->B\n```')
    expect(shiki.codeToHtml).toHaveBeenCalledTimes(1)
    expect(result.html).toContain('data-code=')
    expect(result.html).toContain('data-mermaid-code=')
  })

})
