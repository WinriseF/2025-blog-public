import type { EditorMode } from './types'

type ResizePayload = {
	width: number
	height: number
}

type MaskInteractionOptions = {
	scale: number
	enabled: boolean
	onSelect: () => void
	onStart: (mode: EditorMode) => void
	onMove: (dx: number, dy: number) => void
	onResize: (payload: ResizePayload) => void
	onEnd: () => void
}

export function setupMaskInteractions(element: HTMLElement, options: MaskInteractionOptions) {
	let active = true
	let unset = () => {}
	element.style.touchAction = 'none'

	void import('interactjs').then(module => {
		if (!active) return

		const interact = module.default
		const interactable = interact(element)
			.draggable({
				enabled: options.enabled,
				ignoreFrom: '.face-mask-resize-handle, button',
				listeners: {
					start() {
						options.onSelect()
						options.onStart('dragging')
					},
					move(event: { dx: number; dy: number }) {
						options.onMove(event.dx / options.scale, event.dy / options.scale)
					},
					end() {
						options.onEnd()
					}
				}
			})
			.resizable({
				enabled: options.enabled,
				edges: {
					right: '.face-mask-resize-handle',
					bottom: '.face-mask-resize-handle'
				},
				listeners: {
					start() {
						options.onSelect()
						options.onStart('resizing')
					},
					move(event: { rect: { width: number; height: number } }) {
						options.onResize({
							width: event.rect.width / options.scale,
							height: event.rect.height / options.scale
						})
					},
					end() {
						options.onEnd()
					}
				}
			})

		unset = () => interactable.unset()
	})

	return () => {
		active = false
		unset()
	}
}
