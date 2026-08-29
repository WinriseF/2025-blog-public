import { describe, expect, it } from 'vitest'
import { DEFAULT_STICKER, STICKERS } from '../../src/lib/face-mask/stickers'

describe('face-mask sticker catalog', () => {
  it('has unique stable ids and non-empty labels/emoji', () => {
    expect(new Set(STICKERS.map(item => item.id)).size).toBe(STICKERS.length)
    expect(STICKERS.every(item => item.id && item.label && item.emoji)).toBe(true)
  })

  it('keeps the default sticker inside the catalog', () => {
    expect(STICKERS).toContain(DEFAULT_STICKER)
    expect(DEFAULT_STICKER).toBe(STICKERS[0])
  })
})
