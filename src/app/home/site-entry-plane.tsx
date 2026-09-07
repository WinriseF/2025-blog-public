'use client'

import { ExternalLinkIcon, Globe2Icon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSize } from '@/hooks/use-size'
import { siteEntries, type SiteEntry } from './list'
import { OptimizedImage } from '@/components/optimized-image'

interface Tile {
	key: string
	entry: SiteEntry
	x: number
	y: number
}

const CARD_TINTS = [
	{ tint: 'rgba(255,118,165,0.2)', glow: 'rgba(255,118,165,0.34)', accent: '#e85b8e' },
	{ tint: 'rgba(74,201,231,0.2)', glow: 'rgba(74,201,231,0.34)', accent: '#33a9c6' },
	{ tint: 'rgba(255,197,89,0.22)', glow: 'rgba(255,197,89,0.34)', accent: '#d99a2b' },
	{ tint: 'rgba(139,125,246,0.2)', glow: 'rgba(139,125,246,0.35)', accent: '#7567df' },
	{ tint: 'rgba(111,220,168,0.2)', glow: 'rgba(111,220,168,0.32)', accent: '#42a978' },
	{ tint: 'rgba(255,148,105,0.2)', glow: 'rgba(255,148,105,0.34)', accent: '#db7444' }
]

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const positiveModulo = (value: number, size: number) => ((value % size) + size) % size
const CLICK_DRAG_THRESHOLD = 8
const logoCache = new Map<string, string | null>()
const logoRequests = new Map<string, Promise<string | null>>()
const entryVisualCache = new Map<string, { origin: string; tint: (typeof CARD_TINTS)[number] }>()

function hashString(value: string) {
	let hash = 0
	for (let index = 0; index < value.length; index++) {
		hash = (hash * 31 + value.charCodeAt(index)) | 0
	}
	return Math.abs(hash)
}

function normalizeUrl(value: string) {
	const trimmed = value.trim()
	if (!trimmed) return ''
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function getEntryOrigin(url: string) {
	try {
		return new URL(normalizeUrl(url)).origin
	} catch {
		return ''
	}
}

function getEntryHostname(url: string) {
	try {
		return new URL(normalizeUrl(url)).hostname
	} catch {
		return ''
	}
}

function getEntryVisual(entry: SiteEntry) {
	const cacheKey = `${entry.id}:${entry.url}`
	const cached = entryVisualCache.get(cacheKey)
	if (cached) return cached

	const visual = {
		origin: getEntryOrigin(entry.url).replace(/^https?:\/\//, ''),
		tint: CARD_TINTS[hashString(entry.id) % CARD_TINTS.length]
	}
	entryVisualCache.set(cacheKey, visual)
	return visual
}

function getLogoCandidates(url: string) {
	const origin = getEntryOrigin(url)
	const hostname = getEntryHostname(url)
	if (!origin || !hostname) return []

	return [
		`https://favicon.im/${hostname}?larger=true`,
		`https://icons.duckduckgo.com/ip3/${hostname}.ico`,
		`${origin}/favicon.ico`
	]
}

function resolveLogo(url: string) {
	const cached = logoCache.get(url)
	if (logoCache.has(url)) return Promise.resolve(cached)

	const pending = logoRequests.get(url)
	if (pending) return pending

	const candidates = getLogoCandidates(url)
	if (candidates.length === 0) {
		logoCache.set(url, null)
		return Promise.resolve(null)
	}

	const loadImage = (candidate: string) =>
		new Promise<string>((resolve, reject) => {
			const image = new window.Image()
			image.onload = () => {
				if (image.naturalWidth > 0) resolve(candidate)
				else reject(new Error('empty favicon'))
			}
			image.onerror = reject
			image.referrerPolicy = 'no-referrer'
			image.src = candidate
		})

	const request = Promise.any(candidates.map(loadImage))
		.then(candidate => {
			logoCache.set(url, candidate)
			logoRequests.delete(url)
			return candidate
		})
		.catch(() => {
			logoCache.set(url, null)
			logoRequests.delete(url)
			return null
		})

	logoRequests.set(url, request)
	return request
}

const SiteLogo = memo(function SiteLogo({ url }: { url: string }) {
	const [src, setSrc] = useState<string | null>(() => logoCache.get(url) ?? null)

	useEffect(() => {
		let cancelled = false
		setSrc(logoCache.get(url) ?? null)
		resolveLogo(url).then(candidate => {
			if (!cancelled) setSrc(candidate ?? null)
		})

		return () => {
			cancelled = true
		}
	}, [url])

	if (!src) return <Globe2Icon className='h-7 w-7 text-[#668390]' />

	return <OptimizedImage src={src} alt='' width={38} height={38} draggable={false} referrerPolicy='no-referrer' className='rounded-lg max-sm:h-8 max-sm:w-8' />
})

export default function SiteEntryPlane() {
	const { maxSM, init } = useSize()
	const entries = siteEntries
	const [viewport, setViewport] = useState({ width: 0, height: 0 })
	const [renderOffset, setRenderOffset] = useState({ x: 0, y: 0 })
	const offsetRef = useRef({ x: 0, y: 0 })
	const velocityRef = useRef({ x: 0, y: 0 })
	const dragRef = useRef({
		active: false,
		targetUrl: '',
		startX: 0,
		startY: 0,
		x: 0,
		y: 0,
		lastTime: 0
	})
	const surfaceRef = useRef<HTMLDivElement | null>(null)
	const inertiaFrameRef = useRef<number | null>(null)
	const renderFrameRef = useRef<number | null>(null)

	useEffect(() => {
		const syncViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
		syncViewport()
		window.addEventListener('resize', syncViewport)
		return () => window.removeEventListener('resize', syncViewport)
	}, [])

	const queueRender = useCallback(() => {
		if (renderFrameRef.current) return

		renderFrameRef.current = window.requestAnimationFrame(() => {
			renderFrameRef.current = null
			setRenderOffset({ ...offsetRef.current })
		})
	}, [])

	const setMoving = useCallback((moving: boolean) => {
		if (!surfaceRef.current) return
		if (moving) surfaceRef.current.dataset.moving = 'true'
		else delete surfaceRef.current.dataset.moving
	}, [])

	const stopInertia = useCallback(() => {
		if (inertiaFrameRef.current !== null) window.cancelAnimationFrame(inertiaFrameRef.current)
		inertiaFrameRef.current = null
	}, [])

	const startInertia = useCallback(() => {
		if (inertiaFrameRef.current !== null) return

		const tick = () => {
			inertiaFrameRef.current = null
			if (dragRef.current.active) return

			velocityRef.current.x *= 0.93
			velocityRef.current.y *= 0.93
			if (Math.abs(velocityRef.current.x) < 0.03 && Math.abs(velocityRef.current.y) < 0.03) {
				velocityRef.current = { x: 0, y: 0 }
				setMoving(false)
				return
			}

			offsetRef.current.x += velocityRef.current.x
			offsetRef.current.y += velocityRef.current.y
			queueRender()
			inertiaFrameRef.current = window.requestAnimationFrame(tick)
		}

		inertiaFrameRef.current = window.requestAnimationFrame(tick)
	}, [queueRender, setMoving])

	useEffect(() => {
		return () => {
			stopInertia()
			if (renderFrameRef.current !== null) window.cancelAnimationFrame(renderFrameRef.current)
		}
	}, [stopInertia])

	const geometry = useMemo(() => {
		const mobile = maxSM && init
		return {
			tileWidth: mobile ? 220 : 318,
			tileHeight: mobile ? 138 : 186,
			colStep: mobile ? 226 : 324,
			rowStep: mobile ? 144 : 192
		}
	}, [maxSM, init])

	const tiles = useMemo<Tile[]>(() => {
		if (!viewport.width || !viewport.height) return []

		const tiles: Tile[] = []
		const centerWorldCol = Math.floor(renderOffset.x / geometry.colStep)
		const centerWorldRow = Math.floor(renderOffset.y / geometry.rowStep)
		const halfCols = Math.ceil(viewport.width / geometry.colStep / 2) + 1
		const halfRows = Math.ceil(viewport.height / geometry.rowStep / 2) + 1

		for (let worldRow = centerWorldRow - halfRows; worldRow <= centerWorldRow + halfRows; worldRow++) {
			for (let worldCol = centerWorldCol - halfCols; worldCol <= centerWorldCol + halfCols; worldCol++) {
				const stagger = worldRow % 2 === 0 ? 0 : geometry.colStep / 2
				const localX = worldCol * geometry.colStep + stagger - renderOffset.x
				const localY = worldRow * geometry.rowStep - renderOffset.y
				const entryIndex = positiveModulo(worldRow * 7 + worldCol * 5, entries.length)

				tiles.push({
					key: `${worldRow}-${worldCol}`,
					entry: entries[entryIndex],
					x: localX,
					y: localY
				})
			}
		}

		return tiles
	}, [entries, geometry, renderOffset, viewport])

	const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		stopInertia()
		setMoving(true)
		const target = event.target as HTMLElement
		const tileElement = target.closest<HTMLElement>('[data-entry-url]')

		dragRef.current = {
			active: true,
			targetUrl: tileElement?.dataset.entryUrl || '',
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			lastTime: performance.now()
		}
		velocityRef.current = { x: 0, y: 0 }
		event.currentTarget.setPointerCapture(event.pointerId)
	}, [setMoving, stopInertia])

	const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		if (!drag.active) return

		const now = performance.now()
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		const dt = Math.max(now - drag.lastTime, 16)

		offsetRef.current = {
			x: offsetRef.current.x - dx,
			y: offsetRef.current.y - dy
		}
		velocityRef.current = {
			x: clamp(-dx / dt * 16, -32, 32),
			y: clamp(-dy / dt * 16, -32, 32)
		}
		queueRender()

		drag.x = event.clientX
		drag.y = event.clientY
		drag.lastTime = now
	}, [queueRender])

	const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		const totalDx = event.clientX - drag.startX
		const totalDy = event.clientY - drag.startY
		const isClick = Math.hypot(totalDx, totalDy) <= CLICK_DRAG_THRESHOLD

		drag.active = false
		if (isClick && drag.targetUrl) {
			window.open(drag.targetUrl, '_blank', 'noopener,noreferrer')
		}
		startInertia()
	}, [startInertia])

	return (
		<div className='relative h-dvh w-full overflow-hidden'>
			<div
				ref={surfaceRef}
				className='site-entry-plane relative h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing'
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerEnd}
				onPointerCancel={handlePointerEnd}>
				<div className='pointer-events-none absolute inset-0 bg-white/8' />

				<div className='absolute inset-0'>
					{tiles.map(tile => {
						const { origin, tint } = getEntryVisual(tile.entry)

						return (
							<div
								key={tile.key}
								role='link'
								tabIndex={0}
								data-entry-url={tile.entry.url}
								onKeyDown={event => {
									if (event.key !== 'Enter' && event.key !== ' ') return
									event.preventDefault()
									window.open(tile.entry.url, '_blank', 'noopener,noreferrer')
								}}
								className='site-entry-tile group absolute block outline-none'
								style={{
									left: `calc(50% + ${tile.x}px)`,
									top: `calc(50% + ${tile.y}px)`,
									width: geometry.tileWidth,
									height: geometry.tileHeight,
									transform: 'translate(-50%, -50%)',
									contain: 'layout paint style'
								}}>
								<div
									className='relative flex h-full overflow-hidden rounded-[22px] border border-white/75 p-4 text-[#26363d] shadow-[0_24px_38px_-24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md max-sm:p-3'
									style={{
										background: `radial-gradient(circle at 18% 18%, ${tint.glow} 0%, transparent 32%), radial-gradient(circle at 86% 86%, ${tint.tint} 0%, transparent 42%), linear-gradient(135deg, rgba(255,255,255,0.94), rgba(255,255,255,0.78))`
									}}>
									<div className='pointer-events-none absolute inset-x-6 top-0 h-px bg-white/80' />
									<div className='pointer-events-none absolute -bottom-8 -left-6 h-18 w-28 rounded-full opacity-45' style={{ background: tint.glow }} />
									<div className='absolute inset-y-2 -right-2 w-2 rounded-r-xl border-y border-r border-white/55 bg-white/42' />
									<div className='flex min-w-0 flex-1 gap-4 max-sm:gap-3'>
										<div className='relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white shadow-sm max-sm:h-12 max-sm:w-12'>
											<div className='absolute inset-0 opacity-20' style={{ background: tint.tint }} />
											<SiteLogo url={tile.entry.url} />
										</div>
										<div className='min-w-0 flex-1'>
											<div className='flex items-center gap-1'>
												<div className='truncate text-lg font-semibold max-sm:text-base'>{tile.entry.name}</div>
												<ExternalLinkIcon className='h-4 w-4 shrink-0' style={{ color: tint.accent }} />
											</div>
											<div className='mt-1 truncate text-xs' style={{ color: tint.accent }}>
												{origin}
											</div>
											<p className='mt-3 line-clamp-2 text-sm leading-snug text-[#4f6670] max-sm:mt-2 max-sm:text-xs'>{tile.entry.description}</p>
										</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
