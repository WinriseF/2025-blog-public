export type MaskMode = 'mosaic' | 'blur' | 'emoji'
export type MaskSource = 'auto' | 'manual'
export type EditorMode = 'idle' | 'creating' | 'dragging' | 'resizing'

export type Rect = {
	x: number
	y: number
	width: number
	height: number
}

export type MaskItem = Rect & {
	id: string
	mode: MaskMode
	emoji?: string
	source: MaskSource
}

export type LoadedImage = {
	file: File
	name: string
	type: string
	previewUrl: string
	width: number
	height: number
	bitmap: ImageBitmap
}

export type PreviewRect = {
	displayWidth: number
	displayHeight: number
	scale: number
}

export const MIN_MASK_SIZE = 40
