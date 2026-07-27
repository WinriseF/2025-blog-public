'use client'

import { useEffect, useRef, useState } from 'react'

type LanSessionWaterRippleProps = {
	origin: { x: number; y: number } | null
}

const DAMPING = 0.986
const EFFECT_DURATION = 1320
const FADE_START = 820

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export function LanSessionWaterRipple({ origin }: LanSessionWaterRippleProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [visible, setVisible] = useState(true)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			setVisible(false)
			return
		}

		const context = canvas.getContext('2d', { alpha: true })
		if (!context) return

		let frameId = 0
		let width = 0
		let height = 0
		let cellSize = 1
		let current = new Float32Array()
		let previous = new Float32Array()
		let next = new Float32Array()
		let imageData: ImageData

		const reset = () => {
			const viewportWidth = window.innerWidth
			const viewportHeight = window.innerHeight
			cellSize = Math.max(3, Math.ceil(Math.max(viewportWidth, viewportHeight) / 420))
			width = Math.ceil(viewportWidth / cellSize)
			height = Math.ceil(viewportHeight / cellSize)
			canvas.width = width
			canvas.height = height
			current = new Float32Array(width * height)
			previous = new Float32Array(width * height)
			next = new Float32Array(width * height)
			imageData = context.createImageData(width, height)

			const x = clamp(Math.round((origin?.x ?? viewportWidth / 2) / cellSize), 1, width - 2)
			const y = clamp(Math.round((origin?.y ?? viewportHeight / 2) / cellSize), 1, height - 2)
			const radius = Math.max(3, Math.round(18 / cellSize))
			for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
				for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
					const distance = Math.hypot(offsetX, offsetY)
					if (distance > radius) continue
					current[(y + offsetY) * width + x + offsetX] = 140 * (1 - distance / radius)
				}
			}
		}

		const update = () => {
			for (let y = 1; y < height - 1; y += 1) {
				for (let x = 1; x < width - 1; x += 1) {
					const index = y * width + x
					next[index] = ((current[index - 1] + current[index + 1] + current[index - width] + current[index + width]) * 0.5 - previous[index]) * DAMPING
				}
			}
			const recycled = previous
			previous = current
			current = next
			next = recycled
		}

		const render = (fade: number) => {
			for (let index = 0; index < current.length; index += 1) {
				const wave = current[index]
				const crest = Math.min(Math.max(wave, 0) / 90, 1)
				const trough = Math.min(Math.max(-wave, 0) / 110, 1)
				const strength = Math.max(crest, trough)
				const pixel = index * 4
				imageData.data[pixel] = Math.round(12 + crest * 126)
				imageData.data[pixel + 1] = Math.round(57 + crest * 174 + trough * 18)
				imageData.data[pixel + 2] = Math.round(78 + crest * 164 + trough * 50)
				imageData.data[pixel + 3] = Math.round(strength * 188 * fade)
			}
			context.putImageData(imageData, 0, 0)
		}

		reset()
		const start = performance.now()
		const animate = (now: number) => {
			const elapsed = now - start
			update()
			render(elapsed > FADE_START ? 1 - (elapsed - FADE_START) / (EFFECT_DURATION - FADE_START) : 1)
			if (elapsed < EFFECT_DURATION) {
				frameId = requestAnimationFrame(animate)
				return
			}
			setVisible(false)
		}

		frameId = requestAnimationFrame(animate)
		window.addEventListener('resize', reset)
		return () => {
			cancelAnimationFrame(frameId)
			window.removeEventListener('resize', reset)
		}
	}, [origin])

	if (!visible) return null
	return <canvas ref={canvasRef} aria-hidden className='lan-session-water-ripple' />
}
