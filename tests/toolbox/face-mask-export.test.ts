import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/face-mask/draw-mask', () => ({ drawImageWithMasks: vi.fn() }))

function setup(blobs: Array<Blob | null | Error>) {
  const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
    const next = blobs.shift()
    if (next instanceof Error) throw next
    callback(next ?? null)
  })
  const canvas = { width: 0, height: 0, toBlob }
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => tag === 'canvas' ? canvas : anchor),
    body: { appendChild: vi.fn() }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { toBlob, canvas, anchor }
}

function image(type: string, size = 100) {
  return { name: 'photo.original.jpg', type, width: 400, height: 300, bitmap: {} as ImageBitmap, file: { size } } as any
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('face mask export', () => {
  it('preserves JPEG as JPEG when the browser supports it', async () => {
    const { anchor, toBlob } = setup([new Blob([new Uint8Array(90)], { type: 'image/jpeg' })])
    const { downloadMaskedImage } = await import('../../src/lib/face-mask/export-image')
    await downloadMaskedImage(image('image/jpeg'), [])
    expect(toBlob.mock.calls[0][1]).toBe('image/jpeg')
    expect(anchor.download).toBe('photo.original-privacy.jpg')
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result')
  })

  it('falls back to PNG when the browser rejects a non-PNG encoder', async () => {
    const { anchor, toBlob } = setup([new Error('encoder'), new Blob([new Uint8Array(80)], { type: 'image/png' })])
    const { downloadMaskedImage } = await import('../../src/lib/face-mask/export-image')
    await downloadMaskedImage(image('image/jpeg'), [])
    expect(toBlob.mock.calls.map(call => call[1])).toEqual(['image/jpeg', 'image/png'])
    expect(anchor.download).toMatch(/\.png$/)
  })

  it('tries WebP when a primary export grows by more than 15 percent', async () => {
    const { anchor, toBlob } = setup([
      new Blob([new Uint8Array(120)], { type: 'image/png' }),
      new Blob([new Uint8Array(60)], { type: 'image/webp' })
    ])
    const { downloadMaskedImage } = await import('../../src/lib/face-mask/export-image')
    await downloadMaskedImage(image('image/png', 100), [])
    expect(toBlob.mock.calls.map(call => call[1])).toEqual(['image/png', 'image/webp'])
    expect(anchor.download).toMatch(/\.webp$/)
  })

  it('rejects when canvas returns a mismatched MIME type', async () => {
    setup([new Blob([new Uint8Array(10)], { type: 'image/gif' }), new Blob([new Uint8Array(10)], { type: 'image/gif' })])
    const { downloadMaskedImage } = await import('../../src/lib/face-mask/export-image')
    await expect(downloadMaskedImage(image('image/jpeg'), [])).rejects.toThrow(/不支持该导出格式/)
  })
})
