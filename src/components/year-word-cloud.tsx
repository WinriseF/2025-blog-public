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
	size: number
	fontWeight: number
	color: string
	rotate?: number
	x?: number
	y?: number
}

type PlacedWord = Required<Pick<CloudDatum, 'text' | 'count' | 'weight' | 'size' | 'fontWeight' | 'color' | 'rotate' | 'x' | 'y'>>

const COLORS = [
	'var(--color-brand)',
	'var(--color-brand-secondary)',
	'var(--color-primary)',
	'#2F7D73',
	'#3A72A6',
	'color-mix(in srgb, var(--color-primary) 74%, var(--color-brand-secondary))',
	'color-mix(in srgb, var(--color-brand) 72%, var(--color-primary))'
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
	const minFontSize = width < 520 ? 13 : 15
	const maxFontSize = width < 520 ? 38 : 58

	return words
		.filter(word => word.weight > 0)
		.slice(0, maxWords)
		.map((word, index) => ({
			text: word.text,
			count: word.count,
			weight: word.weight,
			size: Math.round(minFontSize + Math.pow(word.weight, 0.58) * (maxFontSize - minFontSize)),
			fontWeight: word.weight > 0.76 ? 800 : word.weight > 0.48 ? 700 : 550,
			color: COLORS[index % COLORS.length]
		}))
}

export function YearWordCloud({ words, height = 220, maxWords = 54, className }: YearWordCloudProps) {
	const rawId = useId()
	const svgId = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ''), [rawId])
	const rootRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)
	const [placedWords, setPlacedWords] = useState<PlacedWord[] | null>(null)

	useEffect(() => {
		const element = rootRef.current
		if (!element) return

		const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width))
		updateWidth()

		const observer = new ResizeObserver(updateWidth)
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	const cloudWords = useMemo(() => toCloudWords(words, maxWords, width), [maxWords, width, words])

	useEffect(() => {
		if (width <= 0 || height <= 0 || cloudWords.length === 0) {
			setPlacedWords([])
			return
		}

		let cancelled = false
		setPlacedWords(null)

		const random = createSeededRandom(cloudWords.map(word => `${word.text}:${word.count}`).join('|'))
		const layout = cloud<CloudDatum>()
			.size([width, height])
			.words(cloudWords)
			.padding(word => (word.weight > 0.76 ? 6 : width < 520 ? 2 : 4))
			.rotate((_, index) => {
				if (index < 8) return 0
				if (index % 15 === 0) return -14
				if (index % 19 === 0) return 14
				return 0
			})
			.font('PingFang SC, Microsoft YaHei, sans-serif')
			.fontWeight(word => word.fontWeight)
			.fontSize(word => word.size)
			.spiral('archimedean')
			.random(random)
			.canvas(() => document.createElement('canvas'))
			.on('end', tags => {
				if (cancelled) return
				setPlacedWords(
					tags.filter((word): word is PlacedWord => Boolean(word.text && word.x !== undefined && word.y !== undefined && word.rotate !== undefined))
				)
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
			className={cn(
				'relative w-full overflow-hidden rounded-2xl border bg-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_24px_60px_-42px_rgba(0,0,0,0.35)]',
				className
			)}
			style={{ height }}
			aria-label='年度文章词云图'>
			<div
				className='pointer-events-none absolute inset-0 opacity-60'
				style={{
					backgroundImage:
						'linear-gradient(135deg, rgba(255,255,255,0.78), rgba(255,255,255,0.28)), linear-gradient(rgba(255,255,255,0.36) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)',
					backgroundSize: '100% 100%, 42px 42px, 42px 42px'
				}}
			/>
			<div className='pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent' />

			{width === 0 || placedWords === null ? (
				<div className='text-secondary relative z-10 flex h-full items-center justify-center text-sm'>生成中...</div>
			) : placedWords.length > 0 ? (
				<svg className='relative z-10 block h-full w-full' viewBox={`0 0 ${width} ${height}`} role='img' aria-label='年度文章词云图'>
					<defs>
						<linearGradient id={`${svgId}-brand`} x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='var(--color-brand)' />
							<stop offset='100%' stopColor='var(--color-brand-secondary)' />
						</linearGradient>
						<linearGradient id={`${svgId}-ink`} x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='var(--color-primary)' />
							<stop offset='100%' stopColor='#2F7D73' />
						</linearGradient>
						<filter id={`${svgId}-soft-shadow`} x='-30%' y='-30%' width='160%' height='160%'>
							<feDropShadow dx='0' dy='5' stdDeviation='4' floodColor='rgba(0,0,0,0.16)' />
						</filter>
					</defs>
					<g transform={`translate(${width / 2}, ${height / 2})`}>
						{placedWords.map((word, index) => (
							<text
								key={`${word.text}-${word.x}-${word.y}`}
								textAnchor='middle'
								transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
								fill={index === 0 ? `url(#${svgId}-brand)` : index < 4 ? `url(#${svgId}-ink)` : word.color}
								fontSize={word.size}
								fontWeight={word.fontWeight}
								filter={index < 3 ? `url(#${svgId}-soft-shadow)` : undefined}
								opacity={0.72 + word.weight * 0.28}>
								<title>{`${word.text} · ${word.count} 次`}</title>
								{word.text}
							</text>
						))}
					</g>
				</svg>
			) : (
				<div className='text-secondary relative z-10 flex h-full items-center justify-center text-sm'>暂无词云数据</div>
			)}
		</div>
	)
}
