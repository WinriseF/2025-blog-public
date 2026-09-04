import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const edgeTransfer = 'edge-functions/api/transfer/[[default]].js'

describe('API/route contracts', () => {
  it('keeps a cheap health endpoint', () => {
    expect(existsSync(resolve(root, 'src/app/healthz/route.ts'))).toBe(true)
    expect(read('src/app/healthz/route.ts')).toMatch(/Response|NextResponse/)
  })
  it('news detail loads through the shared server-side news module without an internal API loop', () => {
    const page = read('src/app/news/[date]/page.tsx')
    expect(page).toMatch(/getNewsArticle/)
    expect(page).not.toMatch(/fetch\(\s*[`'"]\/api\/news/)
  })
  it.skipIf(!existsSync(resolve(root, edgeTransfer)))('public transfer endpoints do not accept state-changing GET methods when EdgeOne source is present', () => {
    const text = read(edgeTransfer)
    expect(text).toMatch(/request\.method === 'POST' && action === 'create'/)
    expect(text).toMatch(/request\.method === 'POST' && action === 'open'/)
    expect(text).toMatch(/request\.method === 'POST' && action === 'cleanup'/)
  })
  it('EdgeOne cleanup schedule remains explicit and reviewable even if deployment source is packaged separately', () => {
    const config = read('edgeone.json')
    expect(config).toMatch(/transfer-cleanup/)
    expect(config).toMatch(/\/api\/transfer\/cleanup/)
  })
})
