import type { ImageAnalysis, ImageClass, ImageCompressionPreset, PngQuantizationOptions } from './types'

const CDN_ROOT = 'https://cdn.jsdelivr.net/npm'

export const IMAGE_CODEC_URLS = {
	jpeg: `${CDN_ROOT}/@jsquash/jpeg@1.6.0/+esm`,
	png: `${CDN_ROOT}/@jsquash/png@3.1.1/+esm`,
	oxipng: `${CDN_ROOT}/@jsquash/oxipng@2.3.0/+esm`,
	webp: `${CDN_ROOT}/@jsquash/webp@1.5.0/+esm`,
	avif: `${CDN_ROOT}/@jsquash/avif@2.1.1/+esm`,
	exifr: `${CDN_ROOT}/exifr@7.1.3/dist/full.esm.mjs`,
	imagequant: `${CDN_ROOT}/libimagequant-wasm@0.3.0/dist/wasm/libimagequant_wasm.js`,
	imagequantWasm: `${CDN_ROOT}/libimagequant-wasm@0.3.0/dist/wasm/libimagequant_wasm_bg.wasm`
} as const

type EncodeModule = { encode: (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
type OxiPngModule = { optimise: (data: ArrayBuffer | ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
type ExifrModule = { parse: (input: Blob, options?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined> }

type ImageQuantResult = {
	getPalette: () => number[][]
	getPaletteLength: () => number
	setDithering: (value: number) => void
	getPaletteIndices: (rgba: Uint8ClampedArray, width: number, height: number) => Uint8Array
	free: () => void
}

type ImageQuantizer = {
	setSpeed: (value: number) => void
	setQuality: (min: number, target: number) => void
	setMaxColors: (value: number) => void
	quantizeImage: (rgba: Uint8ClampedArray, width: number, height: number) => ImageQuantResult
	free: () => void
}

type ImageQuantModule = {
	default: (wasmUrl?: string) => Promise<unknown>
	ImageQuantizer: new () => ImageQuantizer
	encode_palette_to_png: (indices: Uint8Array, palette: number[][], width: number, height: number) => Uint8Array
}

export type QuantizedImage = {
	bytes: ArrayBuffer
	imageData: ImageData
	paletteLength: number
}

const remoteModules = new Map<string, Promise<unknown>>()
let imageQuantPromise: Promise<ImageQuantModule> | undefined

async function importRemote<T>(url: string): Promise<T> {
	let pending = remoteModules.get(url)
	if (!pending) {
		const moduleUrl = url
		pending = import(/* webpackIgnore: true */ moduleUrl).catch(error => {
			remoteModules.delete(url)
			throw error
		})
		remoteModules.set(url, pending)
	}
	return pending as Promise<T>
}

export function loadJpegEncoder() {
	return importRemote<EncodeModule>(IMAGE_CODEC_URLS.jpeg)
}

export function loadPngEncoder() {
	return importRemote<EncodeModule>(IMAGE_CODEC_URLS.png)
}

export function loadWebpEncoder() {
	return importRemote<EncodeModule>(IMAGE_CODEC_URLS.webp)
}

export function loadAvifEncoder() {
	return importRemote<EncodeModule>(IMAGE_CODEC_URLS.avif)
}

export function loadOxiPng() {
	return importRemote<OxiPngModule>(IMAGE_CODEC_URLS.oxipng)
}

export function loadExifr() {
	return importRemote<ExifrModule>(IMAGE_CODEC_URLS.exifr)
}

async function loadImageQuant() {
	if (!imageQuantPromise) {
		imageQuantPromise = importRemote<ImageQuantModule>(IMAGE_CODEC_URLS.imagequant)
			.then(async module => {
				await module.default(IMAGE_CODEC_URLS.imagequantWasm)
				return module
			})
			.catch(error => {
				imageQuantPromise = undefined
				throw error
			})
	}
	return imageQuantPromise
}

export function buildPngQuantizationCandidates(preset: ImageCompressionPreset, classification: ImageClass, analysis: ImageAnalysis): PngQuantizationOptions[] {
	const graphic = classification === 'ui-text' || classification === 'flat-illustration' || classification === 'transparent-icon'
	const gradient = analysis.gradientRatio > 0.2
	if (preset !== 'smaller') {
		const flat = analysis.flatAreaRatio > 0.5
		return [{
			speed: 3,
			minQuality: preset === 'higher' ? 88 : 0,
			targetQuality: preset === 'higher' ? 98 : 80,
			maxColors: 256,
			dithering: preset === 'higher' ? (gradient ? 0.9 : flat ? 0.4 : 0.8) : gradient ? 0.65 : flat ? 0.2 : 0.4
		}]
	}

	const maxColors = graphic ? [128, 64, 32, 16, 8, 4] : gradient || classification === 'photo' ? [128, 64] : [128, 64, 32, 16]
	const targetQuality = classification === 'ui-text' || classification === 'photo' || gradient
		? 55
		: classification === 'flat-illustration' || classification === 'transparent-icon' ? 45 : 50
	const dithering = graphic ? [0] : gradient ? [0.3, 0.45] : classification === 'photo' ? [0.15, 0.25] : [0.05, 0.1]
	return maxColors.flatMap(colors => dithering.map(value => ({
		speed: 3,
		minQuality: 0,
		targetQuality,
		maxColors: colors,
		dithering: value
	})))
}

export async function quantizeImage(image: ImageData, options: PngQuantizationOptions): Promise<QuantizedImage> {
	const module = await loadImageQuant()
	const quantizer = new module.ImageQuantizer()
	try {
		quantizer.setSpeed(options.speed)
		quantizer.setQuality(options.minQuality, options.targetQuality)
		quantizer.setMaxColors(options.maxColors)
		const result = quantizer.quantizeImage(image.data, image.width, image.height)
		try {
			result.setDithering(options.dithering)
			const palette = result.getPalette()
			const indices = result.getPaletteIndices(image.data, image.width, image.height)
			const rgba = new Uint8ClampedArray(image.width * image.height * 4)
			for (let index = 0; index < indices.length; index += 1) {
				const color = palette[indices[index]]
				const offset = index * 4
				rgba[offset] = color[0]
				rgba[offset + 1] = color[1]
				rgba[offset + 2] = color[2]
				rgba[offset + 3] = color[3]
			}
			const png = module.encode_palette_to_png(indices, palette, image.width, image.height)
			return {
				bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
				imageData: new ImageData(rgba, image.width, image.height),
				paletteLength: result.getPaletteLength()
			}
		} finally {
			result.free()
		}
	} finally {
		quantizer.free()
	}
}
