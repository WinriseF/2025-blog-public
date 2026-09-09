import type { ImageCompressionPreset } from './types'

const CDN_ROOT = 'https://cdn.jsdelivr.net/npm'

export const IMAGE_CODEC_URLS = {
	jpeg: `${CDN_ROOT}/@jsquash/jpeg@1.6.0/+esm`,
	png: `${CDN_ROOT}/@jsquash/png@3.1.1/+esm`,
	oxipng: `${CDN_ROOT}/@jsquash/oxipng@2.3.0/+esm`,
	webp: `${CDN_ROOT}/@jsquash/webp@1.5.0/+esm`,
	avif: `${CDN_ROOT}/@jsquash/avif@2.1.1/+esm`,
	pica: `${CDN_ROOT}/pica@10.0.3/dist/pica.mjs`,
	exifr: `${CDN_ROOT}/exifr@7.1.3/dist/full.esm.mjs`,
	imagequant: `${CDN_ROOT}/libimagequant-wasm@0.3.0/dist/wasm/libimagequant_wasm.js`,
	imagequantWasm: `${CDN_ROOT}/libimagequant-wasm@0.3.0/dist/wasm/libimagequant_wasm_bg.wasm`
} as const

type EncodeModule = { encode: (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
type OxiPngModule = { optimise: (data: ArrayBuffer | ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
type ExifrModule = { parse: (input: Blob, options?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined> }
type PicaInstance = {
	resize: (from: OffscreenCanvas, to: OffscreenCanvas, options?: Record<string, unknown>) => Promise<OffscreenCanvas>
}
type PicaModule = { default: (options?: Record<string, unknown>) => PicaInstance }

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
let picaInstance: PicaInstance | undefined
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

export async function loadPica() {
	if (!picaInstance) {
		const module = await importRemote<PicaModule>(IMAGE_CODEC_URLS.pica)
		picaInstance = module.default({ features: ['js', 'wasm'], concurrency: 1, tile: 1024 })
	}
	return picaInstance
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

function quantizationOptions(preset: ImageCompressionPreset, analysis: { gradientRatio: number; flatAreaRatio: number }) {
	const flat = analysis.flatAreaRatio > 0.5
	const gradient = analysis.gradientRatio > 0.2
	// Let the output quality gate judge the rendered pixels instead of aborting quantization early.
	if (preset === 'smaller') return { speed: 3, min: 0, target: 65, colors: 256, dithering: gradient ? 0.5 : flat ? 0.1 : 0.25 }
	if (preset === 'higher') return { speed: 3, min: 88, target: 98, colors: 256, dithering: gradient ? 0.9 : flat ? 0.4 : 0.8 }
	return { speed: 3, min: 0, target: 80, colors: 256, dithering: gradient ? 0.65 : flat ? 0.2 : 0.4 }
}

export async function quantizeImage(image: ImageData, preset: ImageCompressionPreset, analysis: { gradientRatio: number; flatAreaRatio: number }): Promise<QuantizedImage> {
	const module = await loadImageQuant()
	const options = quantizationOptions(preset, analysis)
	const quantizer = new module.ImageQuantizer()
	try {
		quantizer.setSpeed(options.speed)
		quantizer.setQuality(options.min, options.target)
		quantizer.setMaxColors(options.colors)
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
