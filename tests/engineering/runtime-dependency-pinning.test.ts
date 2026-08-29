import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('runtime dependency contracts', () => {
  it('keeps executable CDN dependencies version-pinned rather than latest/unversioned', () => {
    const files = ['src/lib/zip-packer.ts', 'src/lib/pdf-text-extractor.ts', 'src/lib/password-generator.ts']
    for (const file of files) {
      const text = read(file)
      for (const match of text.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^'"`\s]+/g)) {
        const url = match[0]
        expect(url, `${file}: ${url}`).not.toMatch(/\/latest\//)
        expect(url, `${file}: ${url}`).not.toMatch(/npm\/[^@/]+\//)
      }
    }
  })

  it('password wordlists retain explicit SHA-256 integrity hashes', () => {
    const text = read('src/lib/password-generator.ts')
    expect((text.match(/sha256:\s*'[0-9a-f]{64}'/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(text).toMatch(/crypto\.subtle\.digest\('SHA-256'/)
  })

  it('ONNX runtime keeps the external-WASM alias that avoids the 25MiB bundled asset', () => {
    const text = read('next.config.ts')
    expect(text).toMatch(/onnxruntime-web\/dist\/ort\.min\.mjs/)
  })
})
