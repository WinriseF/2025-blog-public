'use client'

import { useEffect, useRef } from 'react'
import { useTimeTheme } from '@/components/time-theme-provider'
import { startAnimationLoop } from '@/lib/animation-loop'
import styles from './hi-card.module.css'
import { drawDaylightAtmosphere } from './daylight-atmosphere'

function random(seed: number) {
	const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
	return value - Math.floor(value)
}

const brightStars = [[0.12, 0.31], [0.85, 0.19], [0.91, 0.55], [0.18, 0.73]]
const starColor = '204,224,255'
const cloudColor = '108,112,198'

export default function Starfield() {
	const baseRef = useRef<HTMLCanvasElement>(null)
	const lightRef = useRef<HTMLCanvasElement>(null)
	const { theme } = useTimeTheme()

	useEffect(() => {
		const base = baseRef.current
		const lights = lightRef.current
		if (!base) return
		const context = base.getContext('2d')
		const lightContext = lights?.getContext('2d')
		if (!context) return
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
		let width = 0
		let height = 0
		let elapsed = 0
		let dpr = 0

		const glow = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) => {
			const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
			gradient.addColorStop(0, `rgba(${color},${alpha})`)
			gradient.addColorStop(0.25, `rgba(${color},${alpha * 0.35})`)
			gradient.addColorStop(1, `rgba(${color},0)`)
			ctx.fillStyle = gradient
			ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
		}
		const drawLights = () => {
			if (!lightContext) return
			lightContext.clearRect(0, 0, width, height)
			brightStars.forEach(([x, y], index) => {
				const strength = motion.matches ? 0.7 : 0.65 + Math.sin(elapsed / (6500 + index * 1500) * Math.PI * 2 + index * 2) * 0.18
				glow(lightContext, x * width, y * height, 5 + index % 2, starColor, strength * 0.36)
				lightContext.fillStyle = `rgba(${starColor},${strength})`
				lightContext.beginPath()
				lightContext.arc(x * width, y * height, 0.65, 0, Math.PI * 2)
				lightContext.fill()
			})
		}
		const resize = () => {
			const nextWidth = base.clientWidth
			const nextHeight = base.clientHeight
			const nextDpr = Math.min(window.devicePixelRatio || 1, 2)
			if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height && nextDpr === dpr)) return
			width = nextWidth
			height = nextHeight
			dpr = nextDpr
			for (const canvas of [base, lights]) {
				if (!canvas) continue
				canvas.width = Math.round(width * dpr)
				canvas.height = Math.round(height * dpr)
			}
			context.setTransform(dpr, 0, 0, dpr, 0, 0)
			lightContext?.setTransform(dpr, 0, 0, dpr, 0, 0)
			if (theme.name !== 'night') {
				drawDaylightAtmosphere(context, width, height, theme.name)
				return
			}
			// Uneven overlapping clouds suggest a distant band, not a circular halo.
			for (let index = 0; index < 22; index++) {
				const t = index / 21
				glow(context, width * (0.04 + t * 0.94), height * (0.78 - t * 0.65 + (random(index + 40) - 0.5) * 0.18), width * (0.08 + random(index + 80) * 0.12), cloudColor, 0.035 + random(index + 90) * 0.035)
			}
			for (let index = 0; index < 240; index++) {
				const x = random(index * 5 + 1)
				const y = index % 3 === 0
					? Math.max(0.03, Math.min(0.85, 0.78 - x * 0.65 + (random(index * 5 + 2) - 0.5) * 0.24))
					: random(index * 5 + 2) * 0.89
				const fade = Math.min(1, (0.89 - y) / 0.16)
				const medium = index % 9 === 0
				context.fillStyle = `rgba(${starColor},${(medium ? 0.4 + random(index + 7) * 0.25 : 0.12 + random(index + 9) * 0.25) * fade})`
				context.beginPath()
				context.arc(x * width, y * height, medium ? 0.5 + random(index + 11) * 0.3 : 0.22 + random(index + 13) * 0.22, 0, Math.PI * 2)
				context.fill()
			}
			drawLights()
		}
		resize()
		const observer = new ResizeObserver(resize)
		observer.observe(base)
		const loop = theme.name === 'night' ? startAnimationLoop(({ deltaMs }) => {
			elapsed += deltaMs
			drawLights()
		}, { element: base, active: () => !motion.matches, targetFps: 12 }) : null
		const syncMotion = () => {
			drawLights()
			loop?.wake()
		}
		motion.addEventListener('change', syncMotion)
		window.addEventListener('resize', resize)
		return () => {
			loop?.destroy()
			observer.disconnect()
			motion.removeEventListener('change', syncMotion)
			window.removeEventListener('resize', resize)
		}
	}, [theme.name])

	return (
		<div aria-hidden='true' className={styles.starfield}>
			<canvas ref={baseRef} />
			{theme.name === 'night' && <canvas ref={lightRef} />}
		</div>
	)
}
