'use client'

import { useEffect, useRef, useState } from 'react'
import type { TimeThemeName } from '@/lib/time-theme'
import { rand } from './utils'
import { useMusicPlayer } from '@/components/music-player'
import { ambientMusic } from '@/app/music/list'

export type AmbientEffectName = 'none' | 'rain' | 'meteor'

type AmbientEffectLayerProps = {
	themeName: TimeThemeName
}

type RainDrop = {
	x: number
	y: number
	length: number
	speed: number
	wind: number
	alpha: number
	width: number
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
	if (typeof window !== 'undefined') {
		const params = new URLSearchParams(window.location.search)
		const override = params.get('effect') || params.get('ambient')
		if (override === 'rain' || override === 'meteor' || override === 'none') return override
	}

	const score = Math.random()
	if (themeName === 'night') {
		if (score < 0.44) return 'meteor'
		if (score < 0.6) return 'rain'
		return 'none'
	}

	return score < 0.28 ? 'rain' : 'none'
}

function setupCanvas(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')
	if (!ctx) return null

	const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.25 : 1.75)
	const resize = () => {
		const width = canvas.clientWidth
		const height = canvas.clientHeight
		canvas.width = Math.max(1, Math.floor(width * dpr))
		canvas.height = Math.max(1, Math.floor(height * dpr))
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.scale(dpr, dpr)
		return { width, height }
	}

	return { ctx, resize }
}

function createRainDrops(count: number, width: number, height: number, themeName: TimeThemeName): RainDrop[] {
	const night = themeName === 'night'
	return Array.from({ length: count }, () => ({
		x: rand(-width * 0.15, width * 1.1),
		y: rand(-height, height),
		length: rand(night ? 26 : 42, night ? 58 : 86),
		speed: rand(night ? 620 : 720, night ? 940 : 1120),
		wind: rand(night ? -120 : -160, night ? -40 : -70),
		alpha: rand(night ? 0.34 : 0.42, night ? 0.62 : 0.72),
		width: rand(night ? 0.9 : 1.15, night ? 1.65 : 2.35)
	}))
}

function resetRainDrop(drop: RainDrop, width: number, height: number, themeName: TimeThemeName) {
	const night = themeName === 'night'
	drop.x = rand(-width * 0.12, width * 1.12)
	drop.y = rand(-height * 0.28, -20)
	drop.length = rand(night ? 26 : 42, night ? 58 : 86)
	drop.speed = rand(night ? 620 : 720, night ? 940 : 1120)
	drop.wind = rand(night ? -120 : -160, night ? -40 : -70)
	drop.alpha = rand(night ? 0.34 : 0.42, night ? 0.62 : 0.72)
	drop.width = rand(night ? 0.9 : 1.15, night ? 1.65 : 2.35)
}

function drawRain(ctx: CanvasRenderingContext2D, drops: RainDrop[], width: number, height: number, deltaSeconds: number, themeName: TimeThemeName) {
	ctx.clearRect(0, 0, width, height)
	ctx.save()
	ctx.lineCap = 'round'
	const rainColor = themeName === 'night' ? 'rgba(205, 235, 255, 0.95)' : 'rgba(42, 82, 94, 0.95)'
	const rainHighlight = themeName === 'night' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(225, 246, 255, 0.42)'

	for (const drop of drops) {
		drop.x += drop.wind * deltaSeconds
		drop.y += drop.speed * deltaSeconds

		if (drop.y > height + drop.length || drop.x < -width * 0.2) {
			resetRainDrop(drop, width, height, themeName)
		}

		const slant = drop.wind * 0.055
		ctx.globalAlpha = drop.alpha
		ctx.strokeStyle = rainColor
		ctx.lineWidth = drop.width
		ctx.beginPath()
		ctx.moveTo(drop.x, drop.y)
		ctx.lineTo(drop.x + slant, drop.y + drop.length)
		ctx.stroke()

		ctx.globalAlpha = drop.alpha * 0.46
		ctx.strokeStyle = rainHighlight
		ctx.lineWidth = Math.max(0.45, drop.width * 0.38)
		ctx.beginPath()
		ctx.moveTo(drop.x - 0.8, drop.y + drop.length * 0.18)
		ctx.lineTo(drop.x + slant - 0.8, drop.y + drop.length)
		ctx.stroke()
	}

	ctx.restore()
}

function maybeSpawnMeteor(meteors: Meteor[], width: number, mobile: boolean) {
	const maxMeteors = mobile ? 3 : 6
	if (meteors.length >= maxMeteors) return
	if (Math.random() > (mobile ? 0.018 : 0.03)) return

	const speed = rand(mobile ? 540 : 660, mobile ? 820 : 1040)
	meteors.push({
		x: rand(width * 0.1, width * 1.05),
		y: rand(-60, 120),
		vx: -speed,
		vy: speed * rand(0.34, 0.48),
		length: rand(mobile ? 90 : 130, mobile ? 170 : 240),
		age: 0,
		life: rand(1.1, 1.8),
		alpha: rand(0.55, 0.9),
		width: rand(1.1, 1.8)
	})
}

function drawMeteors(ctx: CanvasRenderingContext2D, meteors: Meteor[], width: number, height: number, deltaSeconds: number, mobile: boolean) {
	ctx.clearRect(0, 0, width, height)
	maybeSpawnMeteor(meteors, width, mobile)

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

export default function AmbientEffectLayer({ themeName }: AmbientEffectLayerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const reducedMotion = useReducedMotion()
	const [effect, setEffect] = useState<AmbientEffectName>('none')
	const [effectReady, setEffectReady] = useState(false)
	const { playMusic } = useMusicPlayer()
	const visualEffect = reducedMotion ? 'none' : effect
	const rainActive = visualEffect === 'rain' && effectReady

	useEffect(() => {
		setEffect(pickAmbientEffect(themeName))
	}, [themeName])

	useEffect(() => {
		if (!rainActive) return
		void playMusic(ambientMusic.rain, {
			fadeInMs: 5000,
			loop: true,
			showPlayer: true
		})
	}, [playMusic, rainActive])

	useEffect(() => {
		setEffectReady(false)
		if (visualEffect === 'none') return

		const canvas = canvasRef.current
		if (!canvas) return

		const setup = setupCanvas(canvas)
		if (!setup) return
		const { ctx, resize } = setup

		let { width, height } = resize()
		const mobile = window.innerWidth < 640
		const targetFps = visualEffect === 'rain' ? (mobile ? 24 : 30) : mobile ? 24 : 30
		const frameInterval = 1000 / targetFps
		let rainDrops = visualEffect === 'rain' ? createRainDrops(mobile ? 72 : 148, width, height, themeName) : []
		const meteors: Meteor[] = []
		let animationFrame = 0
		let lastTime = 0
		let accumulatedTime = 0
		let resizeTimer: number | null = null

		function prepareFrame() {
			const size = resize()
			width = size.width
			height = size.height
			if (width <= 1 || height <= 1) return false

			if (visualEffect === 'rain') {
				rainDrops = createRainDrops(mobile ? 72 : 148, width, height, themeName)
				drawRain(ctx, rainDrops, width, height, frameInterval / 1000, themeName)
			} else {
				meteors.splice(0)
				drawMeteors(ctx, meteors, width, height, frameInterval / 1000, mobile)
			}

			setEffectReady(true)
			return true
		}

		function draw(t: number) {
			const deltaMs = lastTime ? Math.min(t - lastTime, 80) : frameInterval
			lastTime = t
			accumulatedTime += deltaMs

			if (document.hidden) {
				animationFrame = requestAnimationFrame(draw)
				return
			}

			if (accumulatedTime < frameInterval) {
				animationFrame = requestAnimationFrame(draw)
				return
			}

			const deltaSeconds = accumulatedTime / 1000
			accumulatedTime = 0

			if (visualEffect === 'rain') {
				drawRain(ctx, rainDrops, width, height, deltaSeconds, themeName)
			} else {
				drawMeteors(ctx, meteors, width, height, deltaSeconds, mobile)
			}

			animationFrame = requestAnimationFrame(draw)
		}

		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeTimer = window.setTimeout(() => {
				if (prepareFrame() && !animationFrame) {
					animationFrame = requestAnimationFrame(draw)
				}
				resizeTimer = null
			}, 250)
		})

		resizeObserver.observe(canvas)
		if (prepareFrame()) {
			animationFrame = requestAnimationFrame(draw)
		}

		return () => {
			if (animationFrame) cancelAnimationFrame(animationFrame)
			if (resizeTimer !== null) window.clearTimeout(resizeTimer)
			resizeObserver.disconnect()
			ctx.clearRect(0, 0, width, height)
			setEffectReady(false)
		}
	}, [themeName, visualEffect])

	if (visualEffect === 'none') return null

	return (
		<>
			{rainActive && (
				<div
					className='absolute inset-0'
					style={{
						background:
							'linear-gradient(180deg, rgba(26, 39, 46, 0.28) 0%, rgba(25, 39, 47, 0.42) 52%, rgba(15, 27, 34, 0.56) 100%)',
						backdropFilter: 'brightness(0.68) saturate(0.72)'
					}}
				/>
			)}
			<canvas ref={canvasRef} className='absolute inset-0 h-full w-full' data-ambient-effect={visualEffect} />
		</>
	)
}
