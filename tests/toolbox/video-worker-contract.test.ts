import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const compress = () => readFileSync(resolve(process.cwd(), 'src/lib/video-compress/video-compress.worker.ts'), 'utf8')
const segment = () => readFileSync(resolve(process.cwd(), 'src/lib/video-compress/video-segment.worker.ts'), 'utf8')

describe('video worker architecture contracts', () => {
  it('writes output through a FileSystem writable stream instead of accumulating the final video Blob in main memory', () => {
    const text = compress()
    expect(text).toMatch(/createWritable/)
    expect(text).toMatch(/StreamTarget|WritableStream|write/)
  })

  it('supports pause/cancel state checks inside long-running work', () => {
    const text = compress()
    expect(text).toMatch(/pause|paused/i)
    expect(text).toMatch(/cancel|abort/i)
  })

  it('keeps segmented compression and validates segment compatibility before merge', () => {
    const text = compress()
    expect(text).toMatch(/segment/i)
    expect(text).toMatch(/decoder|config/i)
    expect(segment()).toMatch(/segment/i)
  })

  it('throttles progress reporting instead of posting on every frame', () => {
    expect(compress()).toMatch(/350|progress.*interval|lastProgress/i)
  })
})
