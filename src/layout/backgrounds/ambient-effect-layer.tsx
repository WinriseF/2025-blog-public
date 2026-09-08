'use client'

import { useEffect, useRef, useState } from 'react'
import type { TimeThemeName } from '@/lib/time-theme'
import { startAnimationLoop } from '@/lib/animation-loop'
import { rand } from './utils'

type AmbientEffectName = 'none' | 'meteor'

type AmbientEffectLayerProps = {
	themeName: TimeThemeName
	visualsEnabled?: boolean
}

type Meteor = {
	x: number
	y: number
	vx: number
	vy: number
	length: number
	age: number
	life: number
	alpha: number
	width: number
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

function pickAmbientEffect(themeName: TimeThemeName): AmbientEffectName {
	const params = new URLSearchParams(window.location.search)
	const override = params.get('effect') || params.get('ambient')
	if (override === 'meteor' || override === 'none') return override
	return themeName === 'night' && Math.random() < 0.44 ? 'meteor' : 'none'
}

function setupCanvas(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')
	if (!ctx) return null

	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.25 : 1.75)
		const width = canvas.clientWidth
		const height = canvas.clientHeight
		canvas.width = Math.max(1, Math.floor(width * dpr))
		canvas.height = Math.max(1, Math.floor(height * dpr))
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		return { width, height }
	}

	return { ctx, resize }
}

function createMeteor(width: number, mobile: boolean): Meteor {
	const speed = rand(mobile ? 540 : 660, mobile ? 820 : 1040)
	return {
		x: rand(width * 0.1, width * 1.05),
		y: rand(-60, 120),
		vx: -speed,
		vy: speed * rand(0.34, 0.48),
		length: rand(mobile ? 90 : 130, mobile ? 170 : 240),
		age: 0,
		life: rand(1.1, 1.8),
		alpha: rand(0.55, 0.9),
		width: rand(1.1, 1.8)
	}
}

function getMeteorSpawnDelay(mobile: boolean) {
	const framesPerSecond = mobile ? 24 : 30
	const chancePerFrame = mobile ? 0.018 : 0.03
	const eventsPerSecond = -Math.log(1 - chancePerFrame) * framesPerSecond
	return (-Math.log(1 - Math.random()) / eventsPerSecond) * 1000
}

function drawMeteors(ctx: CanvasRenderingContext2D, meteors: Meteor[], width: number, height: number, deltaSeconds: number) {
	ctx.clearRect(0, 0, width, height)

	ctx.save()
	ctx.globalCompositeOperation = 'screen'
	for (let i = meteors.length - 1; i >= 0; i--) {
		const meteor = meteors[i]
		meteor.age += deltaSeconds
		meteor.x += meteor.vx * deltaSeconds
		meteor.y += meteor.vy * deltaSeconds

		if (meteor.age > meteor.life || meteor.x < -meteor.length || meteor.y > height * 0.9) {
			meteors.splice(i, 1)
			continue
		}

		const progress = meteor.age / meteor.life
		const alpha = meteor.alpha * Math.sin(progress * Math.PI)
		const angle = Math.atan2(meteor.vy, meteor.vx)
		const tailX = meteor.x - Math.cos(angle) * meteor.length
		const tailY = meteor.y - Math.sin(angle) * meteor.length
		const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY)
		gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
		gradient.addColorStop(0.12, `rgba(149, 225, 255, ${alpha * 0.75})`)
		gradient.addColorStop(1, 'rgba(149, 225, 255, 0)')

		ctx.strokeStyle = gradient
		ctx.lineWidth = meteor.width
		ctx.lineCap = 'round'
		ctx.beginPath()
		ctx.moveTo(meteor.x, meteor.y)
		ctx.lineTo(tailX, tailY)
		ctx.stroke()

		ctx.globalAlpha = alpha
		ctx.fillStyle = '#fff'
		ctx.beginPath()
		ctx.arc(meteor.x, meteor.y, meteor.width * 1.35, 0, Math.PI * 2)
		ctx.fill()
		ctx.globalAlpha = 1
	}
	ctx.restore()
}

export default function AmbientEffectLayer({ themeName, visualsEnabled = true }: AmbientEffectLayerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const reducedMotion = useReducedMotion()
	const [effect, setEffect] = useState<AmbientEffectName>('none')
	const visualEffect = reducedMotion ? 'none' : effect

	useEffect(() => {
		setEffect(pickAmbientEffect(themeName))
	}, [themeName])

	useEffect(() => {
		if (visualEffect === 'none' || !visualsEnabled) return

		const canvas = canvasRef.current
		if (!canvas) return

		const setup = setupCanvas(canvas)
		if (!setup) return
		const { ctx, resize } = setup

		let { width, height } = resize()
		const mobile = window.innerWidth < 640
		const targetFps = mobile ? 24 : 30
		const meteors: Meteor[] = []
		let resizeTimer: number | null = null
		let meteorTimer: number | null = null

		function prepareFrame() {
			const size = resize()
			width = size.width
			height = size.height
			meteors.length = 0
		}

		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeTimer = window.setTimeout(() => {
				prepareFrame()
				resizeTimer = null
			}, 250)
		})

		resizeObserver.observe(canvas)
		prepareFrame()
		const animationLoop = startAnimationLoop(({ deltaMs }) => drawMeteors(ctx, meteors, width, height, deltaMs / 1000), {
			active: () => meteors.length > 0,
			element: canvas,
			maxDeltaMs: 80,
			targetFps
		})

		function scheduleMeteor() {
			meteorTimer = window.setTimeout(() => {
				if (!document.hidden && meteors.length < (mobile ? 3 : 6)) {
					meteors.push(createMeteor(width, mobile))
					animationLoop.wake()
				}
				scheduleMeteor()
			}, getMeteorSpawnDelay(mobile))
		}

		scheduleMeteor()

		return () => {
			animationLoop.destroy()
			if (meteorTimer !== null) window.clearTimeout(meteorTimer)
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeObserver.disconnect()
			ctx.clearRect(0, 0, width, height)
			canvas.width = 1
			canvas.height = 1
		}
	}, [themeName, visualEffect, visualsEnabled])

	if (visualEffect === 'none' || !visualsEnabled) return null

	return (
		<canvas ref={canvasRef} className='absolute inset-0 h-full w-full' data-ambient-effect={visualEffect} aria-hidden='true' />
	)
}
