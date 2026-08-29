import { describe, expect, it } from 'vitest'
import { formatNewsDate, isValidNewsDate, parseNewsIndexMarkdown } from '../../src/lib/news'

describe('news parsing', () => {
  it.each(['2026-02-28', '2024-02-29', '2000-02-29'])('accepts valid date %s', date => expect(isValidNewsDate(date)).toBe(true))
  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-08-28', '2026-8-28'])('rejects invalid date %s', date => expect(isValidNewsDate(date)).toBe(false))

  it('parses day headings and valid Bilibili table rows while ignoring headers/dividers', () => {
    const markdown = `# 每日内容与热点精选\n> 更新时间：2026-08-28 12:00\n\n## 2026-08-28（共 2 个视频）\n| UP 主 | 标题 | 链接 |\n| --- | --- | --- |\n| Alice | 标题 A | [查看](https://example.com/a) |\n| Bob | 标题 B | [查看](https://example.com/b) |`
    const result = parseNewsIndexMarkdown(markdown)
    expect(result.updatedAt).toBe('2026-08-28 12:00')
    expect(result.days).toHaveLength(1)
    expect(result.days[0].count).toBe(2)
    expect(result.days[0].videos.map(v => v.up)).toEqual(['Alice', 'Bob'])
  })

  it('derives count from rows when the heading has no explicit count', () => {
    const result = parseNewsIndexMarkdown('## 2026-08-28\n| A | T | [x](https://e.test) |')
    expect(result.days[0].count).toBe(1)
  })

  it('formats dates without leading-zero month/day', () => {
    expect(formatNewsDate('2026-08-08')).toBe('2026年 8月 8日')
    expect(formatNewsDate('bad')).toBe('bad')
  })
})
