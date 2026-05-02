'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { TimeTheme } from '@/lib/time-theme'
import { rand } from './utils'
import AmbientEffectLayer from './ambient-effect-layer'

type TimeAtmosphereBackgroundProps = {
	theme: TimeTheme
	backgroundImage?: string
	regenerateKey?: string | number
}

type Glow = {
	x: number
	y: number
	r: number
	color: string
	vx: number
	vy: number
	phase: number
	pulse: number
}

type Star = {
	x: number
	y: number
	r: number
	alpha: number
	phase: number
}

function hexToRgba(hex: string, alpha: number) {
	const clean = hex.replace('#', '')
	if (clean.length !== 6) return hex
	const value = Number.parseInt(clean, 16)
	const r = (value >> 16) & 255
	const g = (value >> 8) & 255
	const b = value & 255
	return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function makeBackground(colors: string[]) {
	const [first, second, third] = colors
	return [
		`radial-gradient(circle at 18% 12%, ${hexToRgba(second, 0.72)} 0, transparent 34%)`,
		`radial-gradient(circle at 82% 18%, ${hexToRgba(third, 0.74)} 0, transparent 32%)`,
		`linear-gradient(145deg, ${first} 0%, ${second} 48%, ${third} 100%)`
	].join(', ')
}

function useReducedMotion() {
	const [reducedMotion, setReducedMotion] = useState(false)

	useEffect(() => {
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const update = () => setReducedMotion(query.matches)

		update()
		query.addEventListener('change', update)
		return () => query.removeEventListener('change', update)
	}, [])

	return reducedMotion
}

export default function TimeAtmosphereBackground({ theme, backgroundImage, regenerateKey = 0 }: TimeAtmosphereBackgroundProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const reducedMotion = useReducedMotion()
	const { atmosphere } = theme

	const backgroundStyle = useMemo(
		() =>
			({
				backgroundColor: theme.colors.bg,
				backgroundImage: makeBackground(atmosphere.background),
				opacity: backgroundImage ? 0.9 : 1
			}) satisfies CSSProperties,
		[atmosphere.background, backgroundImage, theme.colors.bg]
	)

	useEffect(() => {
		const canvasEl = canvasRef.current
		if (!canvasEl) return

		const context = canvasEl.getContext('2d')
		if (!context) return
		const canvas = canvasEl as HTMLCanvasElement
		const ctx = context as CanvasRenderingContext2D

		let width = canvas.clientWidth
		let height = canvas.clientHeight
		let animationFrame = 0
		let resizeTimer: number | null = null
		let lastTime = 0
		let accumulatedTime = 0
		let glows: Glow[] = []
		let stars: Star[] = []

		const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.25 : 1.75)
		const targetFps = reducedMotion ? 1 : Math.max(1, atmosphere.targetFps)
		const frameInterval = 1000 / targetFps
		const mobile = window.innerWidth < 640
		const glowCount = reducedMotion ? Math.min(3, atmosphere.bubbleCount) : mobile ? Math.min(4, atmosphere.bubbleCount) : atmosphere.bubbleCount
		const starCount = theme.name === 'night' ? (mobile ? 36 : 72) : 0

		function resizeCanvas() {
			width = canvas.clientWidth
			height = canvas.clientHeight
			canvas.width = Math.max(1, Math.floor(width * dpr))
			canvas.height = Math.max(1, Math.floor(height * dpr))
			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.scale(dpr, dpr)
		}

		function createGlows() {
			glows = Array.from({ length: glowCount }, (_, index) => {
				const r = rand(atmosphere.minRadius, atmosphere.maxRadius) * (mobile ? 0.72 : 1)
				const yMin = height * atmosphere.bottomBandStart
				return {
					x: rand(-r * 0.3, width + r * 0.3),
					y: rand(yMin - r * 0.25, height + r * 0.35),
					r,
					color: atmosphere.glows[index % atmosphere.glows.length],
					vx: rand(-atmosphere.speed, atmosphere.speed),
					vy: rand(-atmosphere.speed * 0.55, atmosphere.speed * 0.55),
					phase: rand(0, Math.PI * 2),
					pulse: rand(0.035, 0.08)
				}
			})
		}

		function createStars() {
			stars = Array.from({ length: starCount }, () => ({
				x: rand(0, width),
				y: rand(0, height * 0.72),
				r: rand(0.55, 1.8),
				alpha: rand(0.18, atmosphere.starOpacity),
				phase: rand(0, Math.PI * 2)
			}))
		}

		function updateGlows(t: number) {
			const bandMin = height * atmosphere.bottomBandStart
			for (const glow of glows) {
				glow.x += glow.vx + Math.cos(t * 0.00012 + glow.phase) * atmosphere.speed * 0.18
				glow.y += glow.vy + Math.sin(t * 0.0001 + glow.phase) * atmosphere.speed * 0.12

				if (glow.x < -glow.r * 0.65) glow.x = width + glow.r * 0.35
				if (glow.x > width + glow.r * 0.65) glow.x = -glow.r * 0.35
				if (glow.y < bandMin - glow.r * 0.45) glow.vy = Math.abs(glow.vy)
				if (glow.y > height + glow.r * 0.55) glow.vy = -Math.abs(glow.vy)
			}
		}

		function drawGlows(t: number) {
			ctx.globalCompositeOperation = theme.name === 'night' ? 'screen' : 'source-over'
			for (const glow of glows) {
				const pulse = reducedMotion ? 1 : 1 + Math.sin(t * 0.00035 + glow.phase) * glow.pulse
				const radius = glow.r * pulse
				const gradient = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, radius)
				const alpha = atmosphere.glowOpacity
				gradient.addColorStop(0, hexToRgba(glow.color, alpha))
				gradient.addColorStop(0.42, hexToRgba(glow.color, alpha * 0.46))
				gradient.addColorStop(1, hexToRgba(glow.color, 0))
				ctx.fillStyle = gradient
				ctx.beginPath()
				ctx.arc(glow.x, glow.y, radius, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.globalCompositeOperation = 'source-over'
		}

		function drawStars(t: number) {
			if (!stars.length) return
			ctx.save()
			ctx.globalCompositeOperation = 'screen'
			for (const star of stars) {
				const flicker = reducedMotion ? 1 : 0.72 + Math.sin(t * 0.0012 + star.phase) * 0.28
				ctx.globalAlpha = star.alpha * flicker
				ctx.fillStyle = '#FFFFFF'
				ctx.beginPath()
				ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.restore()
		}

		function draw(t = 0) {
			ctx.clearRect(0, 0, width, height)
			drawGlows(t)
			drawStars(t)
		}

		function frame(t: number) {
			if (document.hidden) {
				animationFrame = requestAnimationFrame(frame)
				return
			}

			const deltaTime = lastTime ? t - lastTime : frameInterval
			lastTime = t
			accumulatedTime += deltaTime

			if (accumulatedTime < frameInterval) {
				animationFrame = requestAnimationFrame(frame)
				return
			}

			accumulatedTime = 0
			updateGlows(t)
			draw(t)
			animationFrame = requestAnimationFrame(frame)
		}

		resizeCanvas()
		createGlows()
		createStars()
		draw()

		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeTimer = window.setTimeout(() => {
				resizeCanvas()
				createGlows()
				createStars()
				draw()
				resizeTimer = null
			}, 250)
		})
		resizeObserver.observe(canvas)

		if (!reducedMotion) {
			animationFrame = requestAnimationFrame(frame)
		}

		return () => {
			if (animationFrame) cancelAnimationFrame(animationFrame)
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeObserver.disconnect()
		}
	}, [atmosphere, reducedMotion, regenerateKey, theme.name])

	return (
		<div className='pointer-events-none fixed inset-0 z-0 overflow-hidden' data-time-atmosphere={theme.name}>
			<div
				className='absolute inset-0 bg-cover bg-center bg-no-repeat'
				style={backgroundImage ? { backgroundColor: theme.colors.bg, backgroundImage: `url(${backgroundImage})` } : { backgroundColor: theme.colors.bg }}
			/>
			<div className='absolute inset-0 transition-opacity duration-1000' style={backgroundStyle} />
			<canvas ref={canvasRef} className='absolute inset-0 h-full w-full' />
			<AmbientEffectLayer themeName={theme.name} />
			<div
				className='absolute inset-0 mix-blend-overlay'
				style={{
					opacity: atmosphere.noiseOpacity,
					backgroundImage:
						'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.9) 0 1px, transparent 1px), radial-gradient(circle at 80% 60%, rgba(0,0,0,0.65) 0 1px, transparent 1px)',
					backgroundSize: '3px 3px, 5px 5px'
				}}
			/>
		</div>
	)
}
