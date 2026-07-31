'use client'

import cloud from 'd3-cloud'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BlogWordCloudWord } from '@/hooks/use-blog-word-cloud'
import { cn } from '@/lib/utils'

type YearWordCloudProps = {
	words: BlogWordCloudWord[]
	height?: number
	maxWords?: number
	className?: string
}

type CloudDatum = {
	text: string
	count: number
	weight: number
	rank: number
	size: number
	fontWeight: number
	color: string
	rotate?: number
	x?: number
	y?: number
}

type PlacedWord = Required<Pick<CloudDatum, 'text' | 'count' | 'weight' | 'rank' | 'size' | 'fontWeight' | 'color' | 'rotate' | 'x' | 'y'>>
type CloudBounds = [{ x: number; y: number }, { x: number; y: number }]
type WordCloudLayout = {
	words: PlacedWord[]
	bounds: CloudBounds | null
}

const COLORS = [
	'var(--word-cloud-word-1)',
	'var(--word-cloud-word-2)',
	'var(--word-cloud-word-3)',
	'var(--word-cloud-word-4)',
	'var(--word-cloud-word-5)',
	'var(--word-cloud-word-6)',
	'var(--word-cloud-word-7)'
]

function createSeededRandom(seed: string) {
	let hash = 2166136261
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}

	return () => {
		hash += 0x6d2b79f5
		let value = hash
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296
	}
}

function toCloudWords(words: BlogWordCloudWord[], maxWords: number, width: number): CloudDatum[] {
	const minFontSize = width < 520 ? 8 : 10
	const maxFontSize = width < 520 ? 36 : 56
	const visibleWords = words.filter(word => word.weight > 0).slice(0, maxWords)
	const lastIndex = Math.max(visibleWords.length - 1, 1)

	return visibleWords.map((word, index) => {
		const rankProgress = index / lastIndex
		const rankCurve = Math.pow(1 - rankProgress, 2.7)
		const weightCurve = Math.pow(word.weight, 1.7)
		const emphasis = Math.min(1, rankCurve * 0.58 + weightCurve * 0.42)
		const baseSize = minFontSize + emphasis * (maxFontSize - minFontSize)
		const size = index === 0 ? maxFontSize : index < 3 ? Math.max(baseSize, maxFontSize * 0.78) : index < 8 ? Math.max(baseSize, maxFontSize * 0.58) : baseSize

		return {
			text: word.text,
			count: word.count,
			weight: word.weight,
			rank: index,
			size: Math.round(size),
			fontWeight: index < 4 ? 800 : word.weight > 0.62 ? 750 : word.weight > 0.42 ? 650 : 520,
			color: COLORS[index % COLORS.length]
		}
	})
}

function getCloudTransform(bounds: CloudBounds | null, width: number, height: number) {
	if (!bounds) return { offsetX: 0, offsetY: 0, scale: 1 }

	const cloudWidth = Math.max(bounds[1].x - bounds[0].x, 1)
	const cloudHeight = Math.max(bounds[1].y - bounds[0].y, 1)
	const margin = width < 520 ? 8 : 10
	const availableWidth = Math.max(width - margin * 2, 1)
	const availableHeight = Math.max(height - margin * 2, 1)
	const maxScale = width < 520 ? 1.16 : 1.24
	const scale = Math.min(availableWidth / cloudWidth, availableHeight / cloudHeight, maxScale)
	const centerX = (bounds[0].x + bounds[1].x) / 2 - width / 2
	const centerY = (bounds[0].y + bounds[1].y) / 2 - height / 2

	return {
		offsetX: -centerX * scale,
		offsetY: -centerY * scale,
		scale
	}
}

export function YearWordCloud({ words, height = 220, maxWords = 54, className }: YearWordCloudProps) {
	const rawId = useId()
	const svgId = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ''), [rawId])
	const rootRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)
	const [layout, setLayout] = useState<WordCloudLayout | null>(null)

	useEffect(() => {
		const element = rootRef.current
		if (!element) return

		const updateWidth = () => {
			const nextWidth = Math.round(element.getBoundingClientRect().width)
			setWidth(current => (current === nextWidth ? current : nextWidth))
		}
		updateWidth()

		const observer = new ResizeObserver(updateWidth)
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	const cloudWords = useMemo(() => toCloudWords(words, maxWords, width), [maxWords, width, words])

	useEffect(() => {
		if (width <= 0 || height <= 0 || cloudWords.length === 0) {
			setLayout({ words: [], bounds: null })
			return
		}

		let cancelled = false
		setLayout(null)

		const random = createSeededRandom(cloudWords.map(word => `${word.text}:${word.count}`).join('|'))
		const layout = cloud<CloudDatum>()
			.size([width, height])
			.words(cloudWords)
			.padding(word => (word.rank < 3 ? 2 : word.rank < 12 ? 1 : 0.35))
			.rotate((word, index) => {
				if (index < 10) return 0
				if (word.text.length > 5) return 0
				if (index % 17 === 0) return 90
				if (index % 23 === 0) return -90
				if (index % 11 === 0) return -12
				if (index % 13 === 0) return 12
				return 0
			})
			.font('PingFang SC, Microsoft YaHei, sans-serif')
			.fontWeight(word => word.fontWeight)
			.fontSize(word => word.size)
			.spiral('rectangular')
			.random(random)
			.timeInterval(12)
			.canvas(() => document.createElement('canvas'))
			.on('end', (tags, bounds) => {
				if (cancelled) return
				setLayout({
					words: tags.filter((word): word is PlacedWord => Boolean(word.text && word.x !== undefined && word.y !== undefined && word.rotate !== undefined)),
					bounds: bounds?.length === 2 ? (bounds as CloudBounds) : null
				})
			})

		layout.start()

		return () => {
			cancelled = true
			layout.stop()
		}
	}, [cloudWords, height, width])

	return (
		<div
			ref={rootRef}
			className={cn('year-word-cloud relative w-full overflow-hidden rounded-2xl border', className)}
			style={{ height }}
			aria-label='年度文章词云图'>
			<div
				className='pointer-events-none absolute inset-0'
				style={{
					backgroundImage: 'var(--word-cloud-surface-overlay)',
					opacity: 'var(--word-cloud-surface-overlay-opacity)'
				}}
			/>
			<div
				className='pointer-events-none absolute inset-x-6 top-0 h-px'
				style={{ background: 'linear-gradient(to right, transparent, var(--word-cloud-highlight), transparent)' }}
			/>

			{width === 0 || layout === null ? (
				<div className='text-secondary relative z-10 flex h-full items-center justify-center text-sm'>生成中...</div>
			) : layout.words.length > 0 ? (
				<svg
					className='relative z-10 block h-full w-full'
					viewBox={`0 0 ${width} ${height}`}
					role='img'
					aria-label='年度文章词云图'
					textRendering='geometricPrecision'>
					<defs>
						<linearGradient id={`${svgId}-brand`} x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='var(--word-cloud-brand-start)' />
							<stop offset='100%' stopColor='var(--word-cloud-brand-end)' />
						</linearGradient>
						<linearGradient id={`${svgId}-ink`} x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='var(--word-cloud-ink-start)' />
							<stop offset='100%' stopColor='var(--word-cloud-ink-end)' />
						</linearGradient>
						<filter id={`${svgId}-soft-shadow`} x='-30%' y='-30%' width='160%' height='160%'>
							<feDropShadow dx='0' dy='5' stdDeviation='4' floodColor='var(--word-cloud-text-shadow)' />
						</filter>
					</defs>
					{(() => {
						const transform = getCloudTransform(layout.bounds, width, height)
						return (
							<g transform={`translate(${width / 2 + transform.offsetX}, ${height / 2 + transform.offsetY}) scale(${transform.scale})`}>
								{layout.words.map((word, index) => (
									<text
										key={`${word.text}-${word.x}-${word.y}`}
										textAnchor='middle'
										transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
										fill={index === 0 ? `url(#${svgId}-brand)` : index < 4 ? `url(#${svgId}-ink)` : word.color}
										fontSize={word.size}
										fontWeight={word.fontWeight}
										filter={index < 3 ? `url(#${svgId}-soft-shadow)` : undefined}
										opacity={0.78 + word.weight * 0.22}>
										<title>{`${word.text} · ${word.count} 次`}</title>
										{word.text}
									</text>
								))}
							</g>
						)
					})()}
				</svg>
			) : (
				<div className='text-secondary relative z-10 flex h-full items-center justify-center text-sm'>暂无词云数据</div>
			)}
		</div>
	)
}
