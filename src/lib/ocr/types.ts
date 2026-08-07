export type OcrBox = {
	x: number
	y: number
	width: number
	height: number
}

export type OcrItem = {
	text: string
	confidence: number
	box: OcrBox
}

export type OcrResult = {
	text: string
	confidence: number
	items: OcrItem[]
}

export type OcrModel = 'tiny' | 'small' | 'medium'

export type OcrWorkerRequest = {
	id: number
	type: 'recognize'
	model: OcrModel
	image: ArrayBuffer
}

export type OcrWorkerStatus = 'initializing' | 'recognizing'
export type OcrErrorPhase = 'initialize' | 'recognize'

export type OcrWorkerResponse =
	| {
			id: number
			type: 'status'
			status: OcrWorkerStatus
	  }
	| ({ id: number; type: 'success' } & OcrResult)
	| {
			id: number
			type: 'error'
			phase: OcrErrorPhase
			message: string
	  }
