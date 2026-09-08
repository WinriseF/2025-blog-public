import { describe, expect, it } from 'vitest'
import { inspectImageContainer, sniffImageFormat } from '../../src/lib/image-compress/sniff'

function ascii(value: string) {
	return Array.from(value, character => character.charCodeAt(0))
}

describe('image compression container inspection', () => {
	it('detects JPEG dimensions from a SOF marker', () => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9])
		expect(inspectImageContainer(bytes)).toMatchObject({ format: 'jpeg', width: 1920, height: 1080, animated: false })
	})

	it('detects APNG before decode', () => {
		const bytes = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 0, 32, 0, 0, 0, 16, 8, 6, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0, 8, ...ascii('acTL'), 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0
		])
		expect(inspectImageContainer(bytes)).toMatchObject({ format: 'png', width: 32, height: 16, animated: true })
	})

	it('detects animated WebP from VP8X flags', () => {
		const bytes = new Uint8Array([...ascii('RIFF'), 22, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0x02, 0, 0, 0, 63, 0, 0, 31, 0, 0])
		expect(inspectImageContainer(bytes)).toMatchObject({ format: 'webp', width: 64, height: 32, animated: true })
	})

	it('distinguishes AVIF, HEIC and SVG by content', () => {
		expect(sniffImageFormat(new Uint8Array([0, 0, 0, 20, ...ascii('ftyp'), ...ascii('avif'), 0, 0, 0, 0, ...ascii('mif1')]))).toBe('avif')
		expect(sniffImageFormat(new Uint8Array([0, 0, 0, 20, ...ascii('ftyp'), ...ascii('heic'), 0, 0, 0, 0, ...ascii('mif1')]))).toBe('heic')
		expect(sniffImageFormat(new TextEncoder().encode('<?xml version="1.0"?><svg></svg>'))).toBe('svg')
	})
})
