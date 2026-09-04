import { describe, expect, it } from 'vitest'
import { parseEnglishReadingArticle, parseEnglishReadingIndex, type EnglishReadingItem } from '../../src/lib/english-reading'

const item: EnglishReadingItem = {
  key: '2026-09-03',
  title: 'When Artificial Intelligence Moves Into the Browser',
  hasAudio: false
}

describe('English reading parsing', () => {
  it('keeps index metadata as the article source of truth', () => {
    const result = parseEnglishReadingIndex(JSON.stringify({ items: [item, { ...item, key: '..' }] }))
    expect(result.items).toEqual([item])
  })

  it('removes a leading plain-text title only when it matches the index title', () => {
    const article = parseEnglishReadingArticle(`${item.title}\n\nFirst paragraph.`, item, 'https://example.com/article.md')
    expect(article.title).toBe(item.title)
    expect(article.hasAudio).toBe(false)
    expect(article.markdown).toBe('First paragraph.')
  })

  it('removes a Markdown heading while preserving an ordinary opening paragraph', () => {
    const headed = parseEnglishReadingArticle(`# Different source heading\n\nBody.`, item, 'https://example.com/article.md')
    const unheaded = parseEnglishReadingArticle(`Opening paragraph.\n\nSecond paragraph.`, item, 'https://example.com/article.md')

    expect(headed.markdown).toBe('Body.')
    expect(unheaded.markdown).toBe('Opening paragraph.\n\nSecond paragraph.')
  })
})
