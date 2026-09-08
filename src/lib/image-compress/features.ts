import type { ImageAnalysis, ImageClass } from './types'

function entropy(histogram: Uint32Array, samples: number) {
	let value = 0
	for (const count of histogram) {
		if (!count) continue
		const probability = count / samples
		value -= probability * Math.log2(probability)
	}
	return value
}

export function sampleImageData(source: ImageData, maxSide = 256) {
	const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
	const width = Math.max(1, Math.round(source.width * scale))
	const height = Math.max(1, Math.round(source.height * scale))
	if (width === source.width && height === source.height) return source
	const data = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y += 1) {
		const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / height))
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / width))
			const from = (sourceY * source.width + sourceX) * 4
			const to = (y * width + x) * 4
			data[to] = source.data[from]
			data[to + 1] = source.data[from + 1]
			data[to + 2] = source.data[from + 2]
			data[to + 3] = source.data[from + 3]
		}
	}
	return new ImageData(data, width, height)
}

export function analyzeImage(source: ImageData): ImageAnalysis {
	const image = sampleImageData(source)
	const { data, width, height } = image
	const pixels = width * height
	const colors = new Set<number>()
	const luma = new Uint8Array(pixels)
	const histogram = new Uint32Array(64)
	let alpha = 0
	let semiTransparent = 0

	for (let index = 0; index < pixels; index += 1) {
		const offset = index * 4
		const red = data[offset]
		const green = data[offset + 1]
		const blue = data[offset + 2]
		const opacity = data[offset + 3]
		if (opacity < 254) alpha += 1
		if (opacity > 0 && opacity < 250) semiTransparent += 1
		colors.add(((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3))
		const value = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
		luma[index] = value
		histogram[value >> 2] += 1
	}

	let edges = 0
	let horizontalVertical = 0
	let noise = 0
	let gradients = 0
	let comparisons = 0
	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const index = y * width + x
			const gx = Math.abs(luma[index + 1] - luma[index - 1])
			const gy = Math.abs(luma[index + width] - luma[index - width])
			const magnitude = gx + gy
			if (magnitude > 44) {
				edges += 1
				if (Math.max(gx, gy) > Math.min(gx, gy) * 2.5) horizontalVertical += 1
			}
			const average = (luma[index - 1] + luma[index + 1] + luma[index - width] + luma[index + width]) / 4
			if (magnitude < 38) noise += Math.abs(luma[index] - average)
			if (magnitude >= 2 && magnitude <= 22) gradients += 1
			comparisons += 1
		}
	}

	let flatBlocks = 0
	let blocks = 0
	for (let y = 0; y < height; y += 8) {
		for (let x = 0; x < width; x += 8) {
			let min = 255
			let max = 0
			for (let by = y; by < Math.min(height, y + 8); by += 1) {
				for (let bx = x; bx < Math.min(width, x + 8); bx += 1) {
					const value = luma[by * width + bx]
					min = Math.min(min, value)
					max = Math.max(max, value)
				}
			}
			if (max - min <= 14) flatBlocks += 1
			blocks += 1
		}
	}

	return {
		alphaCoverage: alpha / pixels,
		semiTransparent: semiTransparent / pixels,
		coarseColors: colors.size,
		flatAreaRatio: blocks ? flatBlocks / blocks : 0,
		edgeDensity: comparisons ? edges / comparisons : 0,
		hvEdgeRatio: edges ? horizontalVertical / edges : 0,
		lumaEntropy: entropy(histogram, pixels),
		noiseScore: comparisons ? noise / comparisons / 255 : 0,
		gradientRatio: comparisons ? gradients / comparisons : 0
	}
}

export function classifyImage(analysis: ImageAnalysis): ImageClass {
	const hasAlpha = analysis.alphaCoverage > 0
	const lowColors = analysis.coarseColors <= 256
	const flat = analysis.flatAreaRatio > 0.4
	const screenshotScore = analysis.flatAreaRatio + analysis.edgeDensity * 2 + analysis.hvEdgeRatio * 0.35 - analysis.noiseScore * 3
	const photoScore = analysis.lumaEntropy / 6 + analysis.noiseScore * 2 - analysis.flatAreaRatio * 0.65
	if (hasAlpha && lowColors && flat) return 'transparent-icon'
	if (hasAlpha && analysis.semiTransparent > 0.005 && photoScore > 0.72) return 'transparent-complex'
	if (screenshotScore > 0.78 && analysis.edgeDensity > 0.06) return 'ui-text'
	if (!hasAlpha && photoScore > 0.82 && analysis.coarseColors > 512) return 'photo'
	if (flat && lowColors) return 'flat-illustration'
	return 'mixed'
}
