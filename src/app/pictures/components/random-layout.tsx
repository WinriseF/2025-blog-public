'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useCenterInit, useCenterStore } from '@/hooks/use-center'
import type { Picture } from '../page'
import siteContent from '@/config/site-content.json'
import { cn } from '@/lib/utils'
import { useSize } from '@/hooks/use-size'
import { getAssetUrl } from '@/lib/asset-url'

interface RandomLayoutProps {
	pictures: Picture[]
	isEditMode?: boolean
	onDeleteSingle?: (pictureId: string, imageIndex: number) => void
}

type PositionedItem = {
	x: number
	y: number
	rotation: number
}

type OriginalSize = {
	width: number
	height: number
}

interface FloatingImageProps {
	url: string
	index: number
	groupIndex: number
	position: PositionedItem
	description?: string
	uploadedAt?: string
	pictureId: string
	imageIndex: number
	isEditMode?: boolean
	onDeleteSingle?: (pictureId: string, imageIndex: number) => void
}

type UrlItem = {
	url: string
	groupIndex: number
	description?: string
	uploadedAt?: string
	pictureId: string
	imageIndex: number
}

const buildUrlList = (pictures: Picture[]): UrlItem[] => {
	return pictures.flatMap((picture, groupIndex) =>
		picture.images.map((url, imageIndex) => ({
			url,
			groupIndex,
			description: picture.description,
			uploadedAt: picture.uploadedAt,
			pictureId: picture.id,
			imageIndex
		}))
	)
}

let lastZIndex = 10
const TOP_Z_INDEX = 9999

const formatUploadedAt = (uploadedAt?: string) => {
	if (!uploadedAt) return ''
	const date = new Date(uploadedAt)

	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')

	return `${year}-${month}-${day} ${hours}:${minutes}`
}

const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`

const loadSavedOffset = (url: string): { x: number; y: number } => {
	const saved = localStorage.getItem(`picture-offset-${url}`)
	return saved ? JSON.parse(saved) : { x: 0, y: 0 }
}

const saveOffset = (url: string, offset: { x: number; y: number }) => {
	localStorage.setItem(`picture-offset-${url}`, JSON.stringify(offset))
}

const FloatingImage = ({
	url,
	index,
	groupIndex,
	position,
	description,
	uploadedAt,
	pictureId,
	imageIndex,
	isEditMode,
	onDeleteSingle
}: FloatingImageProps) => {
	const { centerX, centerY } = useCenterStore()
	const { maxSM } = useSize()
	const bodyRef = useRef(document.body)
	const mouseDownTimeRef = useRef<number | null>(null)
	const [zIndex, setZIndex] = useState(index)
	const [show, setShow] = useState(false)
	const [dragOffset, setDragOffset] = useState(() => loadSavedOffset(url))
	const imageUrl = getAssetUrl(url)
	const noteAccent = siteContent.backgroundColors[groupIndex % siteContent.backgroundColors.length]

	useEffect(() => {
		setTimeout(() => {
			setShow(true)
		}, 200 * index)
	}, [])

	const [originalSize, setOriginalSize] = useState<OriginalSize | null>(null)

	const displaySize = useMemo(() => {
		if (!originalSize) {
			return { width: 200, height: 200 }
		}

		const ratio = originalSize.width / originalSize.height
		const minRatio = 2 / 3
		const maxRatio = 3 / 2
		const clampedRatio = Math.min(Math.max(ratio, minRatio), maxRatio)

		const baseWidth = 200

		return {
			width: baseWidth,
			height: baseWidth / clampedRatio
		}
	}, [originalSize])

	const zoomedSize = useMemo(() => {
		if (!originalSize) {
			return { width: 200, height: 200 }
		}

		const padding = 24
		const maxWidth = document.documentElement.clientWidth - padding * 2
		const maxHeight = document.documentElement.clientHeight - padding * 2

		const scale = Math.min(maxWidth / originalSize.width, maxHeight / originalSize.height, 1)

		return {
			width: originalSize.width * scale,
			height: originalSize.height * scale
		}
	}, [originalSize])

	const [isZoomed, setIsZoomed] = useState(false)
	const dragStartOffsetRef = useRef({ x: 0, y: 0 })
	const notePosition = useMemo(() => {
		if (maxSM) {
			return {
				left: 12,
				top: 12
			}
		}

		const noteWidth = 260
		const noteHeight = 118
		const gap = 18
		const padding = 24
		const viewportWidth = document.documentElement.clientWidth
		const viewportHeight = document.documentElement.clientHeight
		const imageRight = centerX + zoomedSize.width / 2
		const imageBottom = centerY + zoomedSize.height / 2

		return {
			left: Math.min(Math.max(padding, imageRight - noteWidth - gap), viewportWidth - noteWidth - padding),
			top: Math.min(Math.max(padding, imageBottom - noteHeight - gap), viewportHeight - noteHeight - padding)
		}
	}, [centerX, centerY, maxSM, zoomedSize.height, zoomedSize.width])

	if (!show) return null

	return (
		<>
			{isZoomed && (
				<motion.div
					onClick={() => {
						setIsZoomed(false)
					}}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3 }}
					style={{ zIndex: TOP_Z_INDEX }}
					className='bg-card fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xl'
				/>
			)}
			<motion.div
				drag={!isZoomed}
				dragConstraints={bodyRef}
				dragMomentum={false}
				onDragStart={() => {
					if (!isZoomed) {
						dragStartOffsetRef.current = { ...dragOffset }
					}
				}}
				onMouseDown={event => {
					lastZIndex = lastZIndex + 1
					setZIndex(lastZIndex)
					mouseDownTimeRef.current = event.timeStamp
				}}
				onMouseUp={event => {
					if (mouseDownTimeRef.current !== null) {
						const duration = event.timeStamp - mouseDownTimeRef.current
						if (duration <= 150) {
							if (!isZoomed) {
								setIsZoomed(true)
							} else if (maxSM) {
								setIsZoomed(false)
							}
						}
					}
					mouseDownTimeRef.current = null
				}}
				onDragEnd={(_, info) => {
					if (!isZoomed) {
						const newOffset = {
							x: dragStartOffsetRef.current.x + info.offset.x,
							y: dragStartOffsetRef.current.y + info.offset.y
						}
						setDragOffset(newOffset)
						saveOffset(url, newOffset)
					}
				}}
				initial={{
					width: displaySize.width,
					height: displaySize.height,
					borderWidth: 8,
					zIndex,
					left: centerX + position.x,
					top: centerY + position.y,
					rotate: position.rotation,
					scale: 0.6,
					opacity: 0,
					x: dragOffset.x,
					y: dragOffset.y
				}}
				animate={
					isZoomed
						? {
								zIndex: TOP_Z_INDEX,
								left: centerX,
								top: centerY,
								rotate: 0,
								scale: 1,
								opacity: 1,
								x: 0,
								y: 0,
								width: zoomedSize.width,
								height: zoomedSize.height,
								borderWidth: maxSM ? 12 : 24
							}
						: {
								zIndex,
								scale: 1,
								opacity: 1,
								left: centerX + position.x,
								top: centerY + position.y,
								rotate: position.rotation,
								x: dragOffset.x,
								y: dragOffset.y,
								width: displaySize.width,
								height: displaySize.height,
								borderWidth: 8
							}
				}
				transition={{ type: 'tween', ease: 'easeOut' }}
				className={cn(
					'pointer-events-auto absolute origin-center -translate-1/2 cursor-pointer shadow-xl transition-[scale]',
					!isEditMode && !isZoomed && 'hover:scale-105'
				)}>
				<motion.img
					src={imageUrl}
					alt=''
					loading='lazy'
					decoding='async'
					onLoad={event => {
						const img = event.currentTarget
						setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight })
					}}
					draggable={false}
					className={cn('h-full w-full object-cover select-none')}
				/>
				{isEditMode && !isZoomed && (
					<motion.button
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						onClick={e => {
							e.stopPropagation()
							onDeleteSingle?.(pictureId, imageIndex)
						}}
						onMouseUp={e => {
							e.stopPropagation()
						}}
						className='absolute -top-2 -right-2 rounded-full bg-red-500 p-1.5 opacity-0 shadow-lg transition-all group-hover:opacity-100 hover:scale-105 hover:bg-red-600'
						style={{ zIndex: 1 }}>
						<svg xmlns='http://www.w3.org/2000/svg' className='h-3 w-3 text-white' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
							<path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
						</svg>
					</motion.button>
				)}
			</motion.div>

			{isZoomed && description && (
				<motion.div
					drag
					dragConstraints={maxSM ? undefined : bodyRef}
					dragMomentum={false}
					className='fixed w-[260px] max-w-[calc(100vw-24px)] cursor-grab overflow-visible rounded-[14px] border px-5 pt-5 pb-4 text-[#31484a] shadow-[0_18px_34px_-24px_rgba(28,38,40,0.72),inset_0_1px_0_rgba(255,255,255,0.82)] active:cursor-grabbing max-sm:w-[calc(100vw-24px)] max-sm:px-4 max-sm:pt-5 max-sm:pb-4'
					style={{
						background: `radial-gradient(circle at 12% 10%, rgba(255, 255, 255, 0.92) 0 1px, transparent 1px), linear-gradient(135deg, rgba(255, 252, 240, 0.94), rgba(249, 244, 229, 0.84) 58%, rgba(255, 255, 255, 0.76))`,
						backgroundSize: '7px 7px, auto',
						borderColor: 'rgba(255, 255, 255, 0.72)',
						zIndex: TOP_Z_INDEX + 1,
						left: notePosition.left,
						top: notePosition.top
					}}
					initial={{ opacity: 0, scale: 0.86, y: 14, rotate: maxSM ? 0 : -1.8 }}
					animate={{ opacity: 1, scale: 1, y: 0, rotate: maxSM ? 0 : -1.8 }}>
					<div
						className='pointer-events-none absolute -top-3 left-1/2 h-7 w-28 -translate-x-1/2 rotate-[-2deg] rounded-[5px] border border-white/28 shadow-[0_8px_18px_-14px_rgba(29,39,42,0.68)] backdrop-blur-[2px]'
						style={{
							background: `linear-gradient(90deg, rgba(255,255,255,0.48), ${withAlpha(noteAccent, '2E')} 42%, rgba(255,255,255,0.42))`
						}}
					/>
					<div className='pointer-events-none absolute inset-x-3 top-2 h-px bg-white/70' />
					<div className='mb-2.5 flex items-center gap-2 text-[11px] leading-none font-medium text-[#8a8276]'>
						<span className='h-1.5 w-1.5 rounded-full shadow-sm' style={{ backgroundColor: noteAccent }} />
						<span>{formatUploadedAt(uploadedAt)}</span>
					</div>
					<div className='relative break-words text-[16px] leading-7 font-semibold text-[#2f484c]'>{description}</div>
				</motion.div>
			)}
		</>
	)
}

const positionCacheRef = new Map<string, PositionedItem>()
const getStablePosition = (uniqueId: string, width: number, height: number): PositionedItem => {
	if (positionCacheRef.has(uniqueId)) {
		return positionCacheRef.get(uniqueId)!
	}

	let hash = 0
	for (let i = 0; i < uniqueId.length; i++) {
		const char = uniqueId.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32bit integer
	}
	const stableIndex = Math.abs(hash) % 10000

	const maxRadius = Math.min(width, height) / 2 - 100
	const goldenAngle = Math.PI * (3 - Math.sqrt(5))

	const t = (stableIndex % 1000) / 1000
	const radius = Math.pow(t, 0.8) * maxRadius
	const angle = stableIndex * goldenAngle

	const baseX = radius * Math.cos(angle)
	const baseY = radius * Math.sin(angle)

	const jitterSeed = Math.abs(hash) % 1000
	const jitterRadius = 12
	const jitterX = (jitterSeed % (jitterRadius * 2)) - jitterRadius
	const jitterY = ((jitterSeed * 7) % (jitterRadius * 2)) - jitterRadius

	const rotation = ((jitterSeed * 13) % 60) - 30

	const position = {
		x: baseX + jitterX,
		y: baseY + jitterY,
		rotation
	}

	positionCacheRef.set(uniqueId, position)
	return position
}

export const RandomLayout = ({ pictures, isEditMode = false, onDeleteSingle }: RandomLayoutProps) => {
	useCenterInit()
	const { width, height } = useCenterStore()
	const [show, setShow] = useState(false)

	useEffect(() => {
		setTimeout(() => {
			setShow(true)
		}, 1000)
	}, [])

	const urls = useMemo(() => buildUrlList(pictures), [pictures])

	if (!urls.length || !width || !height) {
		return null
	}

	if (!show) return null

	lastZIndex = urls.length + 11

	return (
		<>
			{urls.map((item, index) => {
				const uniqueId = item.url
				const position = getStablePosition(uniqueId, width, height)

				return (
					<FloatingImage
						key={uniqueId}
						url={item.url}
						index={index}
						groupIndex={item.groupIndex}
						position={position}
						description={item.description}
						uploadedAt={item.uploadedAt}
						pictureId={item.pictureId}
						imageIndex={item.imageIndex}
						isEditMode={isEditMode}
						onDeleteSingle={onDeleteSingle}
					/>
				)
			})}
		</>
	)
}
