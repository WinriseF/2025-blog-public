import { beforeEach, describe, expect, it, vi } from 'vitest'

const pipeline = vi.hoisted(() => ({ compressImage: vi.fn() }))

vi.mock('../../src/lib/image-compress/pipeline', () => ({
	compressImage: pipeline.compressImage
}))

import { DEFAULT_IMAGE_COMPRESSION_OPTIONS } from '../../src/lib/image-compress/presets'
import { optimizeOfficeImage } from '../../src/lib/office-compress/image'

describe('Office image compression adapter', () => {
	beforeEach(() => {
		vi.spyOn(console, 'debug').mockImplementation(() => {})
		pipeline.compressImage.mockResolvedValue({
			usedOriginal: false,
			bytes: new ArrayBuffer(4),
			originalBytes: 100,
			outputBytes: 4,
			classification: 'flat-illustration',
			diagnostics: [{ reason: 'quantized-selected', originalBytes: 100, finalBytes: 4, classification: 'flat-illustration', paletteColors: 16, targetQuality: 45, dithering: 0, metrics: { ssim: 0.98, edgeError: 0.02, alphaMae: 0 } }],
			warnings: []
		})
	})

	it.each(['smart', 'higher', 'smaller'] as const)('uses the normal image pipeline for the %s preset', async preset => {
		const file = new File(['image'], 'image.png', { type: 'image/png' })
		await expect(optimizeOfficeImage(file, preset)).resolves.toEqual(new ArrayBuffer(4))
		expect(pipeline.compressImage).toHaveBeenCalledOnce()
		expect(pipeline.compressImage).toHaveBeenCalledWith({
			file,
			options: { ...DEFAULT_IMAGE_COMPRESSION_OPTIONS, preset },
			limits: { lowMemory: true },
			onProgress: expect.any(Function)
		})
	})

	it('returns replacement bytes for a compressed Office PNG and null for original fallback', async () => {
		const file = new File(['source-png'], 'word/media/image1.png', { type: 'image/png' })
		await expect(optimizeOfficeImage(file, 'smaller')).resolves.toEqual(new ArrayBuffer(4))
		expect(console.debug).toHaveBeenCalledWith('[office-image-compress]', expect.objectContaining({
			file: file.name,
			originalBytes: 100,
			finalBytes: 4,
			classification: 'flat-illustration',
			diagnostics: [expect.objectContaining({ reason: 'quantized-selected', paletteColors: 16, targetQuality: 45, dithering: 0, ssim: 0.98, edgeError: 0.02, alphaMae: 0 })]
		}))

		pipeline.compressImage.mockResolvedValueOnce({ usedOriginal: true, bytes: new ArrayBuffer(10), originalBytes: 10, outputBytes: 10, classification: 'mixed', diagnostics: [{ reason: 'quality-rejected', originalBytes: 10, finalBytes: 10, classification: 'mixed' }], warnings: [] })
		await expect(optimizeOfficeImage(file, 'smaller')).resolves.toBeNull()
	})
})
