'use client'

import { ExternalLinkIcon, Globe2Icon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSize } from '@/hooks/use-size'
import { siteEntries, type SiteEntry } from './list'

interface Tile {
	key: string
	entry: SiteEntry
	x: number
	y: number
	rotateX: number
	rotateY: number
	scale: number
	opacity: number
	zIndex: number
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
			if (!cancelled) setSrc(candidate)
		})

		return () => {
			cancelled = true
		}
	}, [url])

	if (!src) return <Globe2Icon className='h-7 w-7 text-[#668390]' />

	return <img src={src} alt='' width={38} height={38} draggable={false} referrerPolicy='no-referrer' className='rounded-lg max-sm:h-8 max-sm:w-8' />
})

export default function SiteEntrySphere() {
	const { maxSM, init } = useSize()
	const entries = siteEntries
	const [mounted, setMounted] = useState(false)
	const [renderOffset, setRenderOffset] = useState({ x: 0, y: 0 })
	const offsetRef = useRef({ x: 0, y: 0 })
	const velocityRef = useRef({ x: 0, y: 0 })
	const dragRef = useRef({
		active: false,
		moved: false,
		targetUrl: '',
		startX: 0,
		startY: 0,
		x: 0,
		y: 0,
		lastTime: 0
	})
	const frameRef = useRef<number | null>(null)
	const renderFrameRef = useRef<number | null>(null)

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		const tick = () => {
			if (!dragRef.current.active) {
				velocityRef.current = {
					x: velocityRef.current.x * 0.93,
					y: velocityRef.current.y * 0.93
				}

				if (Math.abs(velocityRef.current.x) >= 0.03 || Math.abs(velocityRef.current.y) >= 0.03) {
					offsetRef.current = {
						x: offsetRef.current.x + velocityRef.current.x,
						y: offsetRef.current.y + velocityRef.current.y
					}
					queueRender()
				}
			}

			frameRef.current = window.requestAnimationFrame(tick)
		}

		frameRef.current = window.requestAnimationFrame(tick)
		return () => {
			if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
			if (renderFrameRef.current) window.cancelAnimationFrame(renderFrameRef.current)
		}
	}, [])

	const queueRender = useCallback(() => {
		if (renderFrameRef.current) return

		renderFrameRef.current = window.requestAnimationFrame(() => {
			renderFrameRef.current = null
			setRenderOffset({ ...offsetRef.current })
		})
	}, [])

	const geometry = useMemo(() => {
		const mobile = maxSM && init
		return {
			cols: mobile ? 8 : 14,
			rows: mobile ? 12 : 10,
			tileWidth: mobile ? 220 : 318,
			tileHeight: mobile ? 138 : 186,
			colStep: mobile ? 226 : 324,
			rowStep: mobile ? 144 : 192,
			radius: mobile ? 1320 : 1960
		}
	}, [maxSM, init])

	const tiles = useMemo<Tile[]>(() => {
		if (!mounted) return []

		const tiles: Tile[] = []
		const centerWorldCol = Math.floor(renderOffset.x / geometry.colStep)
		const centerWorldRow = Math.floor(renderOffset.y / geometry.rowStep)
		const halfCols = Math.ceil(geometry.cols / 2)
		const halfRows = Math.ceil(geometry.rows / 2)

		for (let worldRow = centerWorldRow - halfRows; worldRow <= centerWorldRow + halfRows; worldRow++) {
			for (let worldCol = centerWorldCol - halfCols; worldCol <= centerWorldCol + halfCols; worldCol++) {
				const stagger = worldRow % 2 === 0 ? 0 : geometry.colStep / 2
				const localX = worldCol * geometry.colStep + stagger - renderOffset.x
				const localY = worldRow * geometry.rowStep - renderOffset.y
				const theta = localX / geometry.radius
				const phi = localY / geometry.radius
				const z = Math.cos(theta) * Math.cos(phi)
				const entryIndex = positiveModulo(worldRow * 7 + worldCol * 5, entries.length)
				const edgeFalloff = clamp((z - 0.74) / 0.24, 0, 1)

				if (edgeFalloff <= 0.02) continue

				tiles.push({
					key: `${worldRow}-${worldCol}`,
					entry: entries[entryIndex],
					x: Math.sin(theta) * geometry.radius,
					y: Math.sin(phi) * geometry.radius,
					rotateX: -phi * 54,
					rotateY: theta * 58,
					scale: 0.82 + z * 0.16,
					opacity: 0.2 + edgeFalloff * 0.8,
					zIndex: Math.round(z * 1000)
				})
			}
		}

		return tiles.sort((a, b) => a.zIndex - b.zIndex)
	}, [entries, geometry, mounted, renderOffset])

	const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement
		const tileElement = target.closest<HTMLElement>('[data-entry-url]')

		dragRef.current = {
			active: true,
			moved: false,
			targetUrl: tileElement?.dataset.entryUrl || '',
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			lastTime: performance.now()
		}
		velocityRef.current = { x: 0, y: 0 }
		event.currentTarget.setPointerCapture(event.pointerId)
	}, [])

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

		const totalDx = event.clientX - drag.startX
		const totalDy = event.clientY - drag.startY
		if (Math.hypot(totalDx, totalDy) > CLICK_DRAG_THRESHOLD) drag.moved = true
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
	}, [])

	return (
		<div className='relative h-dvh w-full overflow-hidden'>
			<div
				className='relative h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing'
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerEnd}
				onPointerCancel={handlePointerEnd}>
				<div className='pointer-events-none absolute inset-0 bg-white/8 shadow-[inset_0_0_120px_rgba(255,255,255,0.16)]' />
				<div className='pointer-events-none absolute inset-x-[-10%] top-[5%] h-[90%] rounded-[50%] border-y border-white/35' />
				<div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_64%,rgba(255,255,255,0.34)_100%)]' />

				<div className='absolute inset-0 [perspective:1100px]'>
					{tiles.map(tile => {
						const origin = getEntryOrigin(tile.entry.url).replace(/^https?:\/\//, '')
						const tint = CARD_TINTS[hashString(tile.entry.id) % CARD_TINTS.length]

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
								className='group absolute block outline-none'
								style={{
									left: `calc(50% + ${tile.x}px)`,
									top: `calc(50% + ${tile.y}px)`,
									width: geometry.tileWidth,
									height: geometry.tileHeight,
									zIndex: tile.zIndex,
									opacity: tile.opacity,
									transform: `translate(-50%, -50%) rotateX(${tile.rotateX}deg) rotateY(${tile.rotateY}deg) scale(${tile.scale})`,
									transformStyle: 'preserve-3d',
									backfaceVisibility: 'hidden',
									willChange: 'transform',
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
