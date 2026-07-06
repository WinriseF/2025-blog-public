import { MIN_MASK_SIZE, type Rect } from './types'

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

export function clampRect(rect: Rect, imageWidth: number, imageHeight: number, minSize = MIN_MASK_SIZE): Rect {
	const width = clamp(rect.width, minSize, imageWidth)
	const height = clamp(rect.height, minSize, imageHeight)

	return {
		x: clamp(rect.x, 0, imageWidth - width),
		y: clamp(rect.y, 0, imageHeight - height),
		width,
		height
	}
}

export function expandBox(box: Rect, imageWidth: number, imageHeight: number, ratio = 0.35): Rect {
	const expandX = box.width * ratio
	const expandY = box.height * ratio
	const x = Math.max(0, box.x - expandX / 2)
	const y = Math.max(0, box.y - expandY / 2)
	const right = Math.min(imageWidth, box.x + box.width + expandX / 2)
	const bottom = Math.min(imageHeight, box.y + box.height + expandY / 2)

	return clampRect(
		{
			x,
			y,
			width: right - x,
			height: bottom - y
		},
		imageWidth,
		imageHeight
	)
}

export function moveRect(rect: Rect, dx: number, dy: number, imageWidth: number, imageHeight: number): Rect {
	return clampRect(
		{
			...rect,
			x: rect.x + dx,
			y: rect.y + dy
		},
		imageWidth,
		imageHeight
	)
}

export function resizeRect(rect: Rect, width: number, height: number, imageWidth: number, imageHeight: number): Rect {
	return clampRect(
		{
			...rect,
			width,
			height
		},
		imageWidth,
		imageHeight
	)
}

export function rectFromCenter(centerX: number, centerY: number, width: number, height: number, imageWidth: number, imageHeight: number): Rect {
	return clampRect(
		{
			x: centerX - width / 2,
			y: centerY - height / 2,
			width,
			height
		},
		imageWidth,
		imageHeight
	)
}
