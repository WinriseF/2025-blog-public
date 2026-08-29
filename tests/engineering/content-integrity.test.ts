import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('blog content integrity', () => {
  it('every blog index entry points to a directory with config.json and index.md', () => {
    const indexPath = resolve(root, 'public/blogs/index.json')
    expect(existsSync(indexPath)).toBe(true)
    const data = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
    const rows: any[] = Array.isArray(data) ? data : Array.isArray((data as any)?.blogs) ? (data as any).blogs : []
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const slug = row.slug || row.id || row.name
      expect(typeof slug).toBe('string')
      expect(existsSync(resolve(root, 'public/blogs', slug, 'config.json'))).toBe(true)
      expect(existsSync(resolve(root, 'public/blogs', slug, 'index.md'))).toBe(true)
    }
  })

  it('all content directories with config.json have valid required metadata', () => {
    const blogsDir = resolve(root, 'public/blogs')
    for (const name of readdirSync(blogsDir)) {
      const path = resolve(blogsDir, name, 'config.json')
      if (!existsSync(path)) continue
      const config = JSON.parse(readFileSync(path, 'utf8')) as any
      expect(typeof config.title, `${name}: title`).toBe('string')
      expect(config.title.trim().length, `${name}: title`).toBeGreaterThan(0)
      expect(Array.isArray(config.tags), `${name}: tags`).toBe(true)
      expect(/^\d{4}-\d{2}-\d{2}/.test(String(config.date)), `${name}: date`).toBe(true)
      expect(typeof config.summary, `${name}: summary`).toBe('string')
    }
  })

  it('does not expose duplicate slugs in the public index', () => {
    const data = JSON.parse(readFileSync(resolve(root, 'public/blogs/index.json'), 'utf8')) as any
    const rows: any[] = Array.isArray(data) ? data : data.blogs || []
    const slugs = rows.map(row => row.slug || row.id || row.name).filter(Boolean)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
