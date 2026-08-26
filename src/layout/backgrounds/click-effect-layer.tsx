'use client'

import { useEffect, useRef } from 'react'
import type { TimeTheme } from '@/lib/time-theme'

type Point = {
	x: number
	y: number
	size: number
	delay: number
	major: boolean
	color: string
}

type Edge = {
	from: number
	to: number
}

type ClickEffect = {
	x: number
	y: number
	startedAt: number
	duration: number
	points: Point[]
	edges: Edge[]
	lineColor: string
	glowColor: string
	night: boolean
	compact: boolean
}

type ClickEffectLayerProps = {
	enabled: boolean
	theme: TimeTheme
}

const TAU = Math.PI * 2
const MAX_EFFECTS = 3
const DESKTOP_EFFECT_DURATION = 1150
const COMPACT_EFFECT_DURATION = 740
const LINE_DELAY = 90
const LINE_DURATION = 270
const COMPACT_TIMING_SCALE = 0.82
const IGNORED_TARGETS = 'input, textarea, select, canvas, [contenteditable="true"], [role="slider"], [data-click-effect="off"], .lan-session'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3
const seeded = (value: number) => {
	const result = Math.sin(value * 12.9898 + 78.233) * 43758.5453
	return result - Math.floor(result)
}

function createEffect(x: number, y: number, sequence: number, theme: TimeTheme, compact: boolean): ClickEffect {
	const count = compact ? 5 : 9
	const seed = Math.round(x) * 0.73 + Math.round(y) * 1.37 + sequence * 23.17
	const colors = theme.name === 'night'
		? [theme.colors.brand, theme.colors.brandSecondary, theme.colors.primary]
		: [theme.colors.primary, theme.colors.brand, theme.colors.primary]
	const points = Array.from({ length: count }, (_, index) => {
		const angle = index * TAU / count + (seeded(seed + index * 7) - 0.5) * 0.62
		const distance = (compact ? 24 : 30) + seeded(seed + index * 11) * (compact ? 38 : 48)
		return {
			x: Math.cos(angle) * distance,
			y: Math.sin(angle) * distance * 0.78,
			size: 1.25 + seeded(seed + index * 17) * 1.15,
			delay: index * 0.018,
			major: index % 3 === 0,
			color: colors[index % colors.length]
		}
	})
	const edges: Edge[] = []
	const seen = new Set<string>()

	points.forEach((point, from) => {
		points
			.map((candidate, to) => ({ to, distance: from === to ? Infinity : Math.hypot(point.x - candidate.x, point.y - candidate.y) }))
			.sort((left, right) => left.distance - right.distance)
			.slice(0, 2)
			.forEach(({ to, distance }) => {
				if (distance > (compact ? 68 : 84)) return
				const key = from < to ? `${from}-${to}` : `${to}-${from}`
				if (seen.has(key)) return
				seen.add(key)
				edges.push({ from, to })
			})
	})

	return {
		x,
		y,
		startedAt: performance.now(),
		duration: compact ? COMPACT_EFFECT_DURATION : DESKTOP_EFFECT_DURATION,
		points,
		edges,
		lineColor: theme.name === 'night' ? theme.colors.brandSecondary : theme.colors.primary,
		glowColor: theme.colors.brand,
		night: theme.name === 'night',
		compact
	}
}

function drawEffect(context: CanvasRenderingContext2D, effect: ClickEffect, progress: number) {
	const expansion = 0.18 + easeOutCubic(clamp(progress / 0.34)) * 0.82
	const fade = progress < 0.62 ? 1 : 1 - smooth((progress - 0.62) / 0.38)
	const timingScale = effect.compact ? COMPACT_TIMING_SCALE : 1
	const elapsed = progress * effect.duration
	const lineProgress = smooth(clamp((elapsed - LINE_DELAY * timingScale) / (LINE_DURATION * timingScale)))

	context.lineCap = 'round'
	context.lineWidth = effect.night ? 0.8 : 0.9
	context.strokeStyle = effect.lineColor
	for (let index = 0; index < effect.edges.length; index += 1) {
		const edge = effect.edges[index]
		const from = effect.points[edge.from]
		const to = effect.points[edge.to]
		const fromX = effect.x + from.x * expansion
		const fromY = effect.y + from.y * expansion
		const toX = effect.x + to.x * expansion
		const toY = effect.y + to.y * expansion
		const endX = fromX + (toX - fromX) * lineProgress
		const endY = fromY + (toY - fromY) * lineProgress
		context.globalAlpha = (effect.night ? 0.28 : 0.34) * fade * lineProgress
		context.beginPath()
		context.moveTo(fromX, fromY)
		context.lineTo(endX, endY)
		context.stroke()

		if (index % 3 || progress < 0.28 || progress > 0.72) continue
		const travel = smooth((progress - 0.28) / 0.44)
		context.globalAlpha = Math.sin(Math.PI * travel) * 0.48 * fade
		context.fillStyle = effect.glowColor
		context.beginPath()
		context.arc(fromX + (toX - fromX) * travel, fromY + (toY - fromY) * travel, 1.1, 0, TAU)
		context.fill()
	}

	for (const point of effect.points) {
		const local = clamp((progress - point.delay) / 0.2)
		if (!local) continue
		const x = effect.x + point.x * expansion
		const y = effect.y + point.y * expansion
		const alpha = fade * local

		if (effect.night && point.major) {
			context.globalAlpha = alpha * 0.12
			context.fillStyle = effect.glowColor
			context.beginPath()
			context.arc(x, y, point.size * 3.4, 0, TAU)
			context.fill()
		}

		if (point.major) {
			context.globalAlpha = alpha * (effect.night ? 0.24 : 0.3)
			context.strokeStyle = point.color
			context.lineWidth = 0.65
			context.beginPath()
			context.arc(x, y, point.size + 3, 0, TAU)
			context.stroke()
		}

		context.globalAlpha = alpha * (effect.night ? 0.9 : 0.82)
		context.fillStyle = point.color
		context.beginPath()
		context.arc(x, y, point.size, 0, TAU)
		context.fill()
	}

	if (progress < 0.34) {
		const ping = smooth(progress / 0.34)
		context.globalAlpha = (1 - ping) * (effect.night ? 0.34 : 0.42)
		context.strokeStyle = effect.lineColor
		context.lineWidth = 0.8
		context.beginPath()
		context.arc(effect.x, effect.y, 5 + ping * 25, 0, TAU)
		context.stroke()
	}
}

export function ClickEffectLayer({ enabled, theme }: ClickEffectLayerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const sequenceRef = useRef(0)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!enabled || !canvas) return
		const context = canvas.getContext('2d', { alpha: true })
		if (!context) return

		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
		let effects: ClickEffect[] = []
		let frameId = 0
		let width = 0
		let height = 0

		const clear = () => {
			context.clearRect(0, 0, width, height)
		}
		const stop = () => {
			if (frameId) cancelAnimationFrame(frameId)
			frameId = 0
			effects = []
			clear()
		}
		const draw = (now: number) => {
			frameId = 0
			clear()
			for (let index = effects.length - 1; index >= 0; index -= 1) {
				if (now - effects[index].startedAt >= effects[index].duration) effects.splice(index, 1)
			}
			for (const effect of effects) drawEffect(context, effect, clamp((now - effect.startedAt) / effect.duration))
			context.globalAlpha = 1
			if (effects.length && !document.hidden) frameId = requestAnimationFrame(draw)
		}
		const resize = () => {
			stop()
			if (motionQuery.matches) {
				width = 0
				height = 0
				canvas.width = 1
				canvas.height = 1
				return
			}
			width = window.innerWidth
			height = window.innerHeight
			const compact = width < 640
			const dprCap = width * height > 3_000_000 ? 1 : compact ? 1 : 1.25
			const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
			canvas.width = Math.max(1, Math.floor(width * dpr))
			canvas.height = Math.max(1, Math.floor(height * dpr))
			context.setTransform(dpr, 0, 0, dpr, 0, 0)
		}
		const handlePointerDown = (event: PointerEvent) => {
			if (motionQuery.matches || document.hidden || event.button !== 0 || !event.isPrimary) return
			const target = event.target
			if (target instanceof Element && target.closest(IGNORED_TARGETS)) return
			effects.push(createEffect(event.clientX, event.clientY, sequenceRef.current++, theme, width < 640))
			if (effects.length > MAX_EFFECTS) effects.shift()
			if (!frameId) frameId = requestAnimationFrame(draw)
		}
		const handleMotionChange = () => resize()
		const handleVisibilityChange = () => {
			if (document.hidden) stop()
		}

		resize()
		window.addEventListener('resize', resize)
		window.addEventListener('pointerdown', handlePointerDown, true)
		document.addEventListener('visibilitychange', handleVisibilityChange)
		motionQuery.addEventListener('change', handleMotionChange)
		return () => {
			stop()
			window.removeEventListener('resize', resize)
			window.removeEventListener('pointerdown', handlePointerDown, true)
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			motionQuery.removeEventListener('change', handleMotionChange)
		}
	}, [enabled, theme])

	return <canvas ref={canvasRef} className='pointer-events-none fixed inset-0 z-20 h-full w-full' aria-hidden='true' />
}
