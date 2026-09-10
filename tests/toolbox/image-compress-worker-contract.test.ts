import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'src/lib/image-compress/image-compress.worker.ts'), 'utf8')
const cdn = () => readFileSync(resolve(process.cwd(), 'src/lib/image-compress/cdn.ts'), 'utf8')

describe('image compression worker contract', () => {
	it('keeps image processing in a module worker with transferable output', () => {
		expect(source()).toMatch(/compressImage/)
		expect(source()).toMatch(/\[result\.bytes\]/)
	})

	it('loads every heavy codec from pinned CDN URLs at runtime', () => {
		const text = cdn()
		for (const version of ['jpeg@1.6.0', 'png@3.1.1', 'oxipng@2.3.0', 'webp@1.5.0', 'avif@2.1.1', 'exifr@7.1.3', 'libimagequant-wasm@0.3.0']) expect(text).toContain(version)
		expect(text).toMatch(/webpackIgnore: true/)
	})
})
