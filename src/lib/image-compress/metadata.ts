import { loadExifr } from './cdn'
import type { DetectedImageFormat } from './types'

function includesAscii(bytes: Uint8Array, text: string) {
	const pattern = Array.from(text, character => character.charCodeAt(0))
	outer: for (let offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
		for (let index = 0; index < pattern.length; index += 1) if (bytes[offset + index] !== pattern[index]) continue outer
		return true
	}
	return false
}

export async function inspectImageMetadata(file: File, bytes: Uint8Array, format: DetectedImageFormat) {
	const containerHasIcc = includesAscii(bytes, 'ICC_PROFILE') || includesAscii(bytes, 'iCCP') || includesAscii(bytes, 'ICCP')
	try {
		const exifr = await loadExifr()
		const metadata = await exifr.parse(file, {
			ifd0: true,
			exif: true,
			gps: true,
			icc: true,
			xmp: false,
			iptc: false,
			translateValues: false,
			reviveValues: false
		}) ?? {}
		const orientation = typeof metadata.Orientation === 'number' ? metadata.Orientation : 1
		const keys = Object.keys(metadata)
		const hasGps = keys.some(key => key.startsWith('GPS') || key === 'latitude' || key === 'longitude')
		const profileText = keys
			.filter(key => /profile|color.?space|gamut|icc/i.test(key))
			.map(key => String(metadata[key]))
			.join(' ')
		const wideGamut = /display\s*p3|adobe\s*rgb|prophoto|wide.?gamut/i.test(profileText)
		const hasIcc = containerHasIcc || /profile|icc/i.test(profileText)
		return { orientation, hasGps, hasIcc, wideGamut, colorUncertain: hasIcc && !wideGamut && !/s\s*rgb/i.test(profileText), warning: null as string | null }
	} catch {
		return {
			orientation: 1,
			hasGps: false,
			hasIcc: containerHasIcc,
			wideGamut: false,
			colorUncertain: containerHasIcc,
			warning: containerHasIcc
				? `${format.toUpperCase()} 包含 ICC，但色域检查模块加载失败`
				: `${format.toUpperCase()} 元数据检查模块加载失败，已继续采用保守编码`
		}
	}
}
