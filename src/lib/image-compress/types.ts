export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'
export type DetectedImageFormat = ImageFormat | 'gif' | 'heic' | 'svg' | 'unknown'
export type ImageCompressionPreset = 'smart' | 'smaller' | 'higher'
export type ImageOutputMode = 'keep' | 'auto' | ImageFormat
export type ImageCompatibility = 'compatible' | 'smallest'
export type ImageClass = 'photo' | 'ui-text' | 'flat-illustration' | 'transparent-icon' | 'transparent-complex' | 'mixed'
export type ImageJobStage = 'validate' | 'metadata' | 'decode' | 'resize' | 'analyze' | 'encode' | 'evaluate'

export type ImageCompressionOptions = {
	preset: ImageCompressionPreset
	output: ImageOutputMode
	compatibility: ImageCompatibility
	maxWidth?: number
	stripMetadata: boolean
	jpegBackground: string
}

export type ImageDeviceLimits = {
	maxPixels: number
	lowMemory: boolean
}

export type ImageSourceInfo = {
	format: DetectedImageFormat
	mime: string
	width: number
	height: number
	animated: boolean
	orientation: number
	hasAlpha: boolean
	hasIcc: boolean
	wideGamut: boolean
	hasGps: boolean
}

export type ImageQualityMetrics = {
	ssim: number
	edgeError: number
	alphaMae: number
}

export type ImageCompressionResult = {
	bytes: ArrayBuffer
	format: ImageFormat
	mime: string
	extension: string
	width: number
	height: number
	originalBytes: number
	outputBytes: number
	usedOriginal: boolean
	classification: ImageClass
	encoder: string
	metrics?: ImageQualityMetrics
	warnings: string[]
}

export type DecodedImagePayload = {
	data: ArrayBuffer
	width: number
	height: number
	warnings: string[]
}

export type ImageWorkerRequest =
	| {
			type: 'job:start'
			jobId: string
			file: File
			options: ImageCompressionOptions
			limits: ImageDeviceLimits
	  }
	| {
			type: 'job:start-decoded'
			jobId: string
			file: File
			options: ImageCompressionOptions
			limits: ImageDeviceLimits
			decoded: DecodedImagePayload
	  }

export type ImageWorkerResponse =
	| { type: 'job:progress'; jobId: string; stage: ImageJobStage; progress?: number; detail?: string }
	| { type: 'job:needs-main-decode'; jobId: string; message: string }
	| { type: 'job:done'; jobId: string; result: ImageCompressionResult }
	| {
			type: 'job:failed'
			jobId: string
			code:
				| 'UNSUPPORTED_FORMAT'
				| 'ANIMATED_IMAGE'
				| 'DECODE_FAILED'
				| 'ENCODE_FAILED'
				| 'QUALITY_GATE_FAILED'
				| 'CDN_UNAVAILABLE'
				| 'OUT_OF_MEMORY'
			message: string
	  }

export type ImageAnalysis = {
	alphaCoverage: number
	semiTransparent: number
	coarseColors: number
	flatAreaRatio: number
	edgeDensity: number
	hvEdgeRatio: number
	lumaEntropy: number
	noiseScore: number
	gradientRatio: number
}

export type CandidatePlan = {
	format: ImageFormat
	variant: 'lossy' | 'lossless' | 'quantized'
}
