import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/image-compress/cdn', () => ({
	loadExifr: vi.fn(async () => ({ parse: vi.fn(async () => ({})) }))
}))

import { inspectImageMetadata, inspectPngColorMetadata } from '../../src/lib/image-compress/metadata'

function fourCc(target: Uint8Array, offset: number, value: string) {
	for (let index = 0; index < 4; index += 1) target[offset + index] = value.charCodeAt(index)
}

function pngChunk(type: string, data: Uint8Array) {
	const chunk = new Uint8Array(data.length + 12)
	new DataView(chunk.buffer).setUint32(0, data.length)
	fourCc(chunk, 4, type)
	chunk.set(data, 8)
	return chunk
}

function png(...chunks: Uint8Array[]) {
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const length = signature.length + chunks.reduce((total, chunk) => total + chunk.length, 0)
	const output = new Uint8Array(length)
	output.set(signature)
	let offset = signature.length
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
	return output
}

function iccp(profile: Uint8Array, name = 'Office RGB profile') {
	const label = new TextEncoder().encode(name)
	const compressed = new Uint8Array(deflateSync(profile))
	const data = new Uint8Array(label.length + compressed.length + 2)
	data.set(label)
	data[label.length + 1] = 0
	data.set(compressed, label.length + 2)
	return pngChunk('iCCP', data)
}

function writeXyz(profile: Uint8Array, offset: number, values: number[]) {
	fourCc(profile, offset, 'XYZ ')
	const view = new DataView(profile.buffer)
	values.forEach((value, index) => view.setInt32(offset + 8 + index * 4, Math.round(value * 65536)))
}

function matrixProfile(matrix: number[]) {
	const tableOffset = 132
	const dataOffset = tableOffset + 6 * 12
	const curveOffset = dataOffset + 60
	const profile = new Uint8Array(curveOffset + 14)
	const view = new DataView(profile.buffer)
	view.setUint32(0, profile.length)
	fourCc(profile, 16, 'RGB ')
	fourCc(profile, 36, 'acsp')
	view.setUint32(128, 6)
	for (let index = 0; index < 3; index += 1) {
		const entry = tableOffset + index * 12
		fourCc(profile, entry, ['rXYZ', 'gXYZ', 'bXYZ'][index])
		view.setUint32(entry + 4, dataOffset + index * 20)
		view.setUint32(entry + 8, 20)
		writeXyz(profile, dataOffset + index * 20, matrix.slice(index * 3, index * 3 + 3))
	}
	for (let index = 0; index < 3; index += 1) {
		const entry = tableOffset + (index + 3) * 12
		fourCc(profile, entry, ['rTRC', 'gTRC', 'bTRC'][index])
		view.setUint32(entry + 4, curveOffset)
		view.setUint32(entry + 8, 14)
	}
	fourCc(profile, curveOffset, 'curv')
	view.setUint32(curveOffset + 8, 1)
	view.setUint16(curveOffset + 12, Math.round(2.2 * 256))
	return profile
}

function unknownProfile() {
	const profile = new Uint8Array(132)
	const view = new DataView(profile.buffer)
	view.setUint32(0, profile.length)
	fourCc(profile, 16, 'RGB ')
	fourCc(profile, 36, 'acsp')
	return profile
}

describe('PNG color metadata', () => {
	it('treats a valid sRGB chunk as safe even when an unknown iCCP chunk is also present', async () => {
		const result = await inspectPngColorMetadata(png(pngChunk('sRGB', new Uint8Array([0])), iccp(unknownProfile())))
		expect(result).toEqual({ hasIcc: true, standardSrgb: true, wideGamut: false, colorUncertain: false })
	})

	it('recognizes a structurally standard sRGB ICC without relying on an sRGB profile name', async () => {
		const profile = matrixProfile([0.4361, 0.2225, 0.0139, 0.3851, 0.7169, 0.0971, 0.1431, 0.0606, 0.7141])
		const bytes = png(iccp(profile, 'Office document profile'))
		const result = await inspectPngColorMetadata(bytes)
		expect(result).toEqual({ hasIcc: true, standardSrgb: true, wideGamut: false, colorUncertain: false })
		await expect(inspectImageMetadata(new File([bytes], 'office.png'), bytes, 'png')).resolves.toMatchObject({ hasIcc: true, wideGamut: false, colorUncertain: false })
	})

	it('keeps genuinely unknown ICC profiles uncertain', async () => {
		const result = await inspectPngColorMetadata(png(iccp(unknownProfile(), 'Custom calibrated profile')))
		expect(result).toEqual({ hasIcc: true, standardSrgb: false, wideGamut: false, colorUncertain: true })
	})

	it('does not trust an sRGB iCCP keyword without a recognizable ICC body', async () => {
		const result = await inspectPngColorMetadata(png(iccp(unknownProfile(), 'sRGB')))
		expect(result).toEqual({ hasIcc: true, standardSrgb: false, wideGamut: false, colorUncertain: true })
	})

	it('detects a wide-gamut ICC from its colorant matrix', async () => {
		const profile = matrixProfile([0.5151, 0.2412, -0.001, 0.292, 0.6922, 0.0419, 0.1571, 0.0666, 0.7841])
		const result = await inspectPngColorMetadata(png(iccp(profile, 'Monitor profile')))
		expect(result).toEqual({ hasIcc: true, standardSrgb: false, wideGamut: true, colorUncertain: false })
	})

	it('recognizes the standard PNG gAMA/cHRM pair', async () => {
		const gamma = new Uint8Array(4)
		new DataView(gamma.buffer).setUint32(0, 45455)
		const chromaticities = new Uint8Array(32)
		const view = new DataView(chromaticities.buffer)
		const values = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]
		values.forEach((value, index) => view.setUint32(index * 4, value))
		await expect(inspectPngColorMetadata(png(pngChunk('gAMA', gamma), pngChunk('cHRM', chromaticities)))).resolves.toMatchObject({ standardSrgb: true, colorUncertain: false })
	})
})
