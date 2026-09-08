import type { DetectedImageFormat, ImageFormat } from './types'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function ascii(bytes: Uint8Array, offset: number, length: number) {
	let value = ''
	for (let index = 0; index < length && offset + index < bytes.length; index += 1) value += String.fromCharCode(bytes[offset + index])
	return value
}

function matches(bytes: Uint8Array, signature: number[]) {
	return signature.every((value, index) => bytes[index] === value)
}

function readU16BE(bytes: Uint8Array, offset: number) {
	return (bytes[offset] << 8) | bytes[offset + 1]
}

function readU32BE(bytes: Uint8Array, offset: number) {
	return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function readU24LE(bytes: Uint8Array, offset: number) {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readU16LE(bytes: Uint8Array, offset: number) {
	return bytes[offset] | (bytes[offset + 1] << 8)
}

function isIsoBrand(bytes: Uint8Array, brand: string) {
	if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false
	const limit = Math.min(bytes.length, Math.max(16, readU32BE(bytes, 0)))
	for (let offset = 8; offset + 4 <= limit; offset += 4) if (ascii(bytes, offset, 4) === brand) return true
	return false
}

export function sniffImageFormat(bytes: Uint8Array): DetectedImageFormat {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
	if (bytes.length >= 8 && matches(bytes, PNG_SIGNATURE)) return 'png'
	if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
	if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'gif'
	if (isIsoBrand(bytes, 'avif') || isIsoBrand(bytes, 'avis')) return 'avif'
	if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].some(brand => isIsoBrand(bytes, brand))) return 'heic'
	const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).replace(/^\uFEFF/, '').trimStart().toLowerCase()
	if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return 'svg'
	return 'unknown'
}

function jpegDimensions(bytes: Uint8Array) {
	let offset = 2
	while (offset + 8 < bytes.length) {
		while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
		while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
		const marker = bytes[offset]
		offset += 1
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
		if (offset + 2 > bytes.length) break
		const length = readU16BE(bytes, offset)
		if (length < 2 || offset + length > bytes.length) break
		if (JPEG_SOF.has(marker) && length >= 7) return { width: readU16BE(bytes, offset + 5), height: readU16BE(bytes, offset + 3) }
		offset += length
	}
	return null
}

function pngInfo(bytes: Uint8Array) {
	const width = bytes.length >= 24 ? readU32BE(bytes, 16) : 0
	const height = bytes.length >= 24 ? readU32BE(bytes, 20) : 0
	let animated = false
	for (let offset = 8; offset + 12 <= bytes.length; ) {
		const length = readU32BE(bytes, offset)
		const type = ascii(bytes, offset + 4, 4)
		if (type === 'acTL') animated = true
		if (type === 'IEND' || length > bytes.length - offset - 12) break
		offset += length + 12
	}
	return { width, height, animated }
}

function webpInfo(bytes: Uint8Array) {
	let width = 0
	let height = 0
	let animated = false
	for (let offset = 12; offset + 8 <= bytes.length; ) {
		const type = ascii(bytes, offset, 4)
		const length = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)
		const payload = offset + 8
		if (type === 'VP8X' && length >= 10) {
			animated ||= Boolean(bytes[payload] & 0x02)
			width = readU24LE(bytes, payload + 4) + 1
			height = readU24LE(bytes, payload + 7) + 1
		} else if (type === 'VP8 ' && length >= 10 && ascii(bytes, payload + 3, 3) === '\u009d\u0001\u002a') {
			width ||= readU16LE(bytes, payload + 6) & 0x3fff
			height ||= readU16LE(bytes, payload + 8) & 0x3fff
		} else if (type === 'VP8L' && length >= 5 && bytes[payload] === 0x2f) {
			width ||= 1 + (bytes[payload + 1] | ((bytes[payload + 2] & 0x3f) << 8))
			height ||= 1 + ((bytes[payload + 2] >> 6) | (bytes[payload + 3] << 2) | ((bytes[payload + 4] & 0x0f) << 10))
		}
		if (type === 'ANIM' || type === 'ANMF') animated = true
		if (length < 0 || length > bytes.length - payload) break
		offset = payload + length + (length & 1)
	}
	return { width, height, animated }
}

function avifDimensions(bytes: Uint8Array) {
	for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
		if (ascii(bytes, offset, 4) !== 'ispe') continue
		const width = readU32BE(bytes, offset + 8)
		const height = readU32BE(bytes, offset + 12)
		if (width && height) return { width, height }
	}
	return null
}

export function inspectImageContainer(bytes: Uint8Array) {
	const format = sniffImageFormat(bytes)
	if (format === 'jpeg') return { format, ...(jpegDimensions(bytes) ?? { width: 0, height: 0 }), animated: false }
	if (format === 'png') return { format, ...pngInfo(bytes) }
	if (format === 'webp') return { format, ...webpInfo(bytes) }
	if (format === 'avif') return { format, ...(avifDimensions(bytes) ?? { width: 0, height: 0 }), animated: isIsoBrand(bytes, 'avis') }
	return { format, width: 0, height: 0, animated: format === 'gif' }
}

export const IMAGE_FORMAT_META: Record<ImageFormat, { mime: string; extension: string; label: string }> = {
	jpeg: { mime: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
	png: { mime: 'image/png', extension: 'png', label: 'PNG' },
	webp: { mime: 'image/webp', extension: 'webp', label: 'WebP' },
	avif: { mime: 'image/avif', extension: 'avif', label: 'AVIF' }
}

export function assertOutputFormat(bytes: Uint8Array, expected: ImageFormat) {
	const actual = sniffImageFormat(bytes)
	if (actual !== expected) throw new Error(`编码器返回了 ${actual}，预期为 ${expected}`)
}
