import { beforeEach, describe, expect, it, vi } from 'vitest'

const pipeline = vi.hoisted(() => ({ compressImage: vi.fn() }))

vi.mock('../../src/lib/image-compress/pipeline', () => ({
	compressImage: pipeline.compressImage
}))

import { DEFAULT_IMAGE_COMPRESSION_OPTIONS } from '../../src/lib/image-compress/presets'
import { optimizeOfficeImage } from '../../src/lib/office-compress/image'

describe('Office image compression adapter', () => {
	beforeEach(() => {
		pipeline.compressImage.mockResolvedValue({ usedOriginal: false, bytes: new ArrayBuffer(4), warnings: [] })
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
})
