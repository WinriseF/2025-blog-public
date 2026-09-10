import { loadExifr } from './cdn'
import type { DetectedImageFormat } from './types'

const PNG_SIGNATURE = '\u0089PNG\r\n\u001a\n'
const ICC_LIMIT = 4 * 1024 * 1024
const SRGB_CHROMATICITIES = [0.3127, 0.329, 0.64, 0.33, 0.3, 0.6, 0.15, 0.06]
const SRGB_XYZ = [0.4361, 0.2225, 0.0139, 0.3851, 0.7169, 0.0971, 0.1431, 0.0606, 0.7141]
const WIDE_XYZ = [
	[0.5151, 0.2412, -0.001, 0.292, 0.6922, 0.0419, 0.1571, 0.0666, 0.7841], // Display P3
	[0.6098, 0.3111, 0.0195, 0.2053, 0.6257, 0.0609, 0.1492, 0.0632, 0.7446], // Adobe RGB
	[0.7977, 0.288, 0, 0.1352, 0.7119, 0, 0.0313, 0.0001, 0.8249] // ProPhoto RGB
]

export type PngColorMetadata = {
	hasIcc: boolean
	standardSrgb: boolean
	wideGamut: boolean
	colorUncertain: boolean
}

type IccTag = { offset: number; size: number }

function ascii(bytes: Uint8Array, offset: number, length: number) {
	let value = ''
	for (let index = 0; index < length && offset + index < bytes.length; index += 1) value += String.fromCharCode(bytes[offset + index])
	return value
}

function includesAscii(bytes: Uint8Array, text: string) {
	const pattern = Array.from(text, character => character.charCodeAt(0))
	outer: for (let offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
		for (let index = 0; index < pattern.length; index += 1) if (bytes[offset + index] !== pattern[index]) continue outer
		return true
	}
	return false
}

function readU16(bytes: Uint8Array, offset: number) {
	return (bytes[offset] << 8) | bytes[offset + 1]
}

function readU32(bytes: Uint8Array, offset: number) {
	return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function readS15Fixed16(bytes: Uint8Array, offset: number) {
	const value = readU32(bytes, offset)
	return (value > 0x7fffffff ? value - 0x100000000 : value) / 65536
}

function normalizedLabel(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function classifyLabels(labels: string[]) {
	const normalized = labels.map(normalizedLabel).filter(Boolean)
	const wide = normalized.some(value => [
		'displayp3', 'dcip3', 'adobergb', 'adobergb1998', 'prophotorgb', 'rommrgb', 'widegamutrgb', 'rec2020', 'bt2020', 'ecirgb', 'colormatchrgb'
	].some(name => value.includes(name)))
	const srgb = normalized.some(value => value === 'srgb'
		|| value.includes('srgbiec6196621')
		|| value.includes('iec6196621defaultrgbcolourspace')
		|| value.includes('srgb2014')
		|| value.includes('srgbv4iccpreference')
		|| value.includes('srgbdisplayprofile'))
	return wide ? 'wide' : srgb ? 'srgb' : 'unknown'
}

function closeValues(actual: number[], expected: number[], tolerance: number) {
	return actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance)
}

function triangleArea(points: number[]) {
	const [rx, ry, gx, gy, bx, by] = points
	return Math.abs(rx * (gy - by) + gx * (by - ry) + bx * (ry - gy)) / 2
}

function chromaticityArea(values: number[]) {
	return triangleArea([values[2], values[3], values[4], values[5], values[6], values[7]])
}

function parseIccTags(profile: Uint8Array) {
	if (profile.length < 132 || ascii(profile, 36, 4) !== 'acsp' || ascii(profile, 16, 4) !== 'RGB ') return null
	const declaredSize = readU32(profile, 0)
	if (declaredSize < 132 || declaredSize > profile.length) return null
	const count = readU32(profile, 128)
	if (count > 1024 || 132 + count * 12 > declaredSize) return null
	const tags = new Map<string, IccTag>()
	for (let index = 0; index < count; index += 1) {
		const entry = 132 + index * 12
		const offset = readU32(profile, entry + 4)
		const size = readU32(profile, entry + 8)
		if (size < 8 || offset > declaredSize || size > declaredSize - offset) return null
		tags.set(ascii(profile, entry, 4), { offset, size })
	}
	return tags
}

function decodeUtf16Be(bytes: Uint8Array) {
	let value = ''
	for (let offset = 0; offset + 1 < bytes.length; offset += 2) value += String.fromCharCode(readU16(bytes, offset))
	return value.replace(/\0+$/g, '')
}

function readIccText(profile: Uint8Array, tag: IccTag) {
	const type = ascii(profile, tag.offset, 4)
	if (type === 'desc' && tag.size >= 12) {
		const length = Math.min(readU32(profile, tag.offset + 8), tag.size - 12)
		return [ascii(profile, tag.offset + 12, length).replace(/\0+$/g, '')]
	}
	if (type === 'text' && tag.size >= 8) return [ascii(profile, tag.offset + 8, tag.size - 8).replace(/\0+$/g, '')]
	if (type !== 'mluc' || tag.size < 16) return []
	const count = readU32(profile, tag.offset + 8)
	const recordSize = readU32(profile, tag.offset + 12)
	if (recordSize < 12 || count > 128 || 16 + count * recordSize > tag.size) return []
	const values: string[] = []
	for (let index = 0; index < count; index += 1) {
		const record = tag.offset + 16 + index * recordSize
		const length = readU32(profile, record + 4)
		const relativeOffset = readU32(profile, record + 8)
		if (relativeOffset <= tag.size && length <= tag.size - relativeOffset) values.push(decodeUtf16Be(profile.subarray(tag.offset + relativeOffset, tag.offset + relativeOffset + length)))
	}
	return values
}

function readXyz(profile: Uint8Array, tag: IccTag | undefined) {
	if (!tag || tag.size < 20 || ascii(profile, tag.offset, 4) !== 'XYZ ') return null
	return [readS15Fixed16(profile, tag.offset + 8), readS15Fixed16(profile, tag.offset + 12), readS15Fixed16(profile, tag.offset + 16)]
}

function sameBytes(profile: Uint8Array, first: IccTag, second: IccTag) {
	if (first.size !== second.size) return false
	for (let index = 0; index < first.size; index += 1) if (profile[first.offset + index] !== profile[second.offset + index]) return false
	return true
}

function isSrgbTransferCurve(profile: Uint8Array, tag: IccTag) {
	const type = ascii(profile, tag.offset, 4)
	if (type === 'para' && tag.size >= 32) {
		const fn = readU16(profile, tag.offset + 8)
		if (fn !== 3 && fn !== 4) return false
		const actual = Array.from({ length: fn === 3 ? 5 : 7 }, (_, index) => readS15Fixed16(profile, tag.offset + 12 + index * 4))
		return closeValues(actual.slice(0, 5), [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045], 0.015)
	}
	if (type !== 'curv' || tag.size < 12) return false
	const count = readU32(profile, tag.offset + 8)
	if (count === 1 && tag.size >= 14) return Math.abs(readU16(profile, tag.offset + 12) / 256 - 2.2) <= 0.05
	if (count < 16 || 12 + count * 2 > tag.size) return false
	let error = 0
	let maxError = 0
	for (let index = 0; index < count; index += 1) {
		const encoded = index / (count - 1)
		const expected = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
		const difference = Math.abs(readU16(profile, tag.offset + 12 + index * 2) / 65535 - expected)
		error += difference
		maxError = Math.max(maxError, difference)
	}
	return error / count <= 0.006 && maxError <= 0.02
}

function classifyIccProfile(profile: Uint8Array, profileName: string) {
	const tags = parseIccTags(profile)
	if (!tags) return classifyLabels([profileName]) === 'wide' ? 'wide' : 'unknown'
	const labels: string[] = []
	for (const name of ['desc', 'dscm', 'dmnd', 'dmdd']) {
		const tag = tags.get(name)
		if (tag) labels.push(...readIccText(profile, tag))
	}
	const named = classifyLabels(labels)
	if (named === 'wide' || classifyLabels([profileName]) === 'wide') return 'wide'
	if (named === 'srgb') return 'srgb'
	const xyz = ['rXYZ', 'gXYZ', 'bXYZ'].flatMap(name => readXyz(profile, tags.get(name)) ?? [])
	if (xyz.length !== 9) return 'unknown'
	const curves = ['rTRC', 'gTRC', 'bTRC'].map(name => tags.get(name))
	if (closeValues(xyz, SRGB_XYZ, 0.025) && curves.every(Boolean)
		&& sameBytes(profile, curves[0]!, curves[1]!) && sameBytes(profile, curves[0]!, curves[2]!)
		&& isSrgbTransferCurve(profile, curves[0]!)) return 'srgb'
	if (WIDE_XYZ.some(reference => closeValues(xyz, reference, 0.035))) return 'wide'
	const xy = xyz.flatMap((_, offset) => {
		if (offset % 3) return []
		const total = xyz[offset] + xyz[offset + 1] + xyz[offset + 2]
		return total ? [xyz[offset] / total, xyz[offset + 1] / total] : [0, 0]
	})
	const srgbXy = SRGB_XYZ.flatMap((_, offset) => {
		if (offset % 3) return []
		const total = SRGB_XYZ[offset] + SRGB_XYZ[offset + 1] + SRGB_XYZ[offset + 2]
		return [SRGB_XYZ[offset] / total, SRGB_XYZ[offset + 1] / total]
	})
	return triangleArea(xy) > triangleArea(srgbXy) * 1.08 ? 'wide' : 'unknown'
}

async function inflateIcc(compressed: Uint8Array) {
	if (typeof DecompressionStream === 'undefined' || compressed.byteLength > ICC_LIMIT) return null
	try {
		const input = compressed.slice().buffer
		const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
		const chunks: Uint8Array[] = []
		let length = 0
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > ICC_LIMIT) {
				await reader.cancel()
				return null
			}
			chunks.push(value)
		}
		const output = new Uint8Array(length)
		let offset = 0
		for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
		return output
	} catch {
		return null
	}
}

export async function inspectPngColorMetadata(bytes: Uint8Array): Promise<PngColorMetadata> {
	if (ascii(bytes, 0, 8) !== PNG_SIGNATURE) return { hasIcc: false, standardSrgb: false, wideGamut: false, colorUncertain: false }
	let hasSrgbChunk = false
	let hasIccChunk = false
	let gamma: number | null = null
	let chromaticities: number[] | null = null
	let icc: { name: string; compressed: Uint8Array } | null = null
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const length = readU32(bytes, offset)
		if (length > bytes.length - offset - 12) break
		const type = ascii(bytes, offset + 4, 4)
		const data = bytes.subarray(offset + 8, offset + 8 + length)
		if (type === 'sRGB' && length === 1 && data[0] <= 3) hasSrgbChunk = true
		else if (type === 'gAMA' && length === 4) gamma = readU32(data, 0) / 100000
		else if (type === 'cHRM' && length === 32) chromaticities = Array.from({ length: 8 }, (_, index) => readU32(data, index * 4) / 100000)
		else if (type === 'iCCP' && !icc) {
			hasIccChunk = true
			const separator = data.indexOf(0)
			if (separator > 0 && separator <= 79 && data[separator + 1] === 0 && separator + 2 < data.length) {
				icc = { name: ascii(data, 0, separator), compressed: data.subarray(separator + 2) }
			}
		}
		if (type === 'IEND') break
		offset += length + 12
	}
	if (hasSrgbChunk) return { hasIcc: hasIccChunk, standardSrgb: true, wideGamut: false, colorUncertain: false }
	if (icc) {
		const named = classifyLabels([icc.name])
		const profile = await inflateIcc(icc.compressed)
		const classification = profile ? classifyIccProfile(profile, icc.name) : named === 'wide' ? 'wide' : 'unknown'
		return { hasIcc: true, standardSrgb: classification === 'srgb', wideGamut: classification === 'wide', colorUncertain: classification === 'unknown' }
	}
	if (hasIccChunk) return { hasIcc: true, standardSrgb: false, wideGamut: false, colorUncertain: true }
	const standardSrgb = gamma !== null && Math.abs(gamma - 0.45455) <= 0.0005
		&& chromaticities !== null && closeValues(chromaticities, SRGB_CHROMATICITIES, 0.0025)
	const wideGamut = chromaticities !== null && !standardSrgb && chromaticityArea(chromaticities) > chromaticityArea(SRGB_CHROMATICITIES) * 1.08
	return { hasIcc: false, standardSrgb, wideGamut, colorUncertain: false }
}

export async function inspectImageMetadata(file: File, bytes: Uint8Array, format: DetectedImageFormat) {
	const pngColor = format === 'png' ? await inspectPngColorMetadata(bytes) : null
	const containerHasIcc = pngColor ? pngColor.hasIcc : includesAscii(bytes, 'ICC_PROFILE') || includesAscii(bytes, 'ICCP')
	try {
		const exifr = await loadExifr()
		const metadata = await exifr.parse(file, {
			ifd0: true, exif: true, gps: true, icc: true, xmp: false, iptc: false,
			translateValues: false, reviveValues: false
		}) ?? {}
		const orientation = typeof metadata.Orientation === 'number' ? metadata.Orientation : 1
		const keys = Object.keys(metadata)
		const hasGps = keys.some(key => key.startsWith('GPS') || key === 'latitude' || key === 'longitude')
		const profileText = keys.filter(key => /profile|color.?space|gamut|icc/i.test(key)).map(key => String(metadata[key])).join(' ')
		const textColor = classifyLabels([profileText])
		const hasIcc = containerHasIcc || /profile|icc/i.test(profileText)
		const standardSrgb = Boolean(pngColor?.standardSrgb) || textColor === 'srgb'
		const wideGamut = !standardSrgb && (Boolean(pngColor?.wideGamut) || textColor === 'wide')
		return { orientation, hasGps, hasIcc, wideGamut, colorUncertain: hasIcc && !standardSrgb && !wideGamut, warning: null as string | null }
	} catch {
		return {
			orientation: 1,
			hasGps: false,
			hasIcc: containerHasIcc,
			wideGamut: Boolean(pngColor?.wideGamut),
			colorUncertain: Boolean(pngColor?.colorUncertain),
			warning: `${format.toUpperCase()} EXIF/GPS 元数据检查模块加载失败`
		}
	}
}
