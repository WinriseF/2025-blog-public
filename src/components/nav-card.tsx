'use client'

import Card from '@/components/card'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useCenterStore } from '@/hooks/use-center'
import { CARD_SPACING } from '@/consts'
import ScrollOutlineSVG from '@/svgs/scroll-outline.svg'
import ScrollFilledSVG from '@/svgs/scroll-filled.svg'
import NewsOutlineSVG from '@/svgs/news-outline.svg'
import NewsFilledSVG from '@/svgs/news-filled.svg'
import ProjectsFilledSVG from '@/svgs/projects-filled.svg'
import ProjectsOutlineSVG from '@/svgs/projects-outline.svg'
import AboutFilledSVG from '@/svgs/about-filled.svg'
import AboutOutlineSVG from '@/svgs/about-outline.svg'
import WebsiteFilledSVG from '@/svgs/website-filled.svg'
import WebsiteOutlineSVG from '@/svgs/website-outline.svg'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { cn } from '@/lib/utils'
import { getAssetUrl } from '@/lib/asset-url'
import { useSize } from '@/hooks/use-size'
import { useConfigStore } from '@/app/(home)/stores/config-store'
import { OptimizedImage } from '@/components/optimized-image'
import { useTimeTheme } from '@/components/time-theme-provider'
import { SunMoon } from 'lucide-react'

const list = [
	{
		icon: ScrollOutlineSVG,
		iconActive: ScrollFilledSVG,
		label: '近期文章',
		href: '/blog'
	},
	{
		icon: ProjectsOutlineSVG,
		iconActive: ProjectsFilledSVG,
		label: '我的项目',
		href: '/projects'
	},
	{
		icon: AboutOutlineSVG,
		iconActive: AboutFilledSVG,
		label: '关于网站',
		href: '/about'
	},
	{
		icon: NewsOutlineSVG,
		iconActive: NewsFilledSVG,
		label: '新闻趋势',
		href: '/news'
	},
	{
		icon: WebsiteOutlineSVG,
		iconActive: WebsiteFilledSVG,
		label: '优秀博客',
		href: '/bloggers'
	}
]

const extraSize = 8
const themeLabels = {
	dawn: '清晨',
	noon: '正午',
	sunset: '日落',
	night: '夜晚'
}
const themeItem = { type: 'theme' as const, label: '切换时间主题' }
const compactItems = [...list, themeItem]
const avatarSize = 40
const iconSize = 28
const cardPadding = 24
const longPressDuration = 450

function getExpandedWidth(gap: number) {
	return cardPadding + avatarSize + gap + compactItems.length * iconSize + (compactItems.length - 1) * gap + extraSize * 2
}

export default function NavCard() {
	const pathname = usePathname()
	const centerX = useCenterStore(state => state.x)
	const centerY = useCenterStore(state => state.y)
	const init = useSize(state => state.init)
	const maxSM = useSize(state => state.maxSM)
	const maxXS = useSize(state => state.maxXS)
	const { theme, transitioning, cycleTheme } = useTimeTheme()
	const [isExpanded, setIsExpanded] = useState(false)
	const navRef = useRef<HTMLDivElement>(null)
	const pointerInsideRef = useRef(false)
	const focusWithinRef = useRef(false)
	const touchExpandedRef = useRef(false)
	const lastPointerTypeRef = useRef<string | null>(null)
	const longPressTimerRef = useRef<number | null>(null)
	const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
	const longPressTriggeredRef = useRef(false)
	const mousePositionRef = useRef<{ x: number; y: number } | null>(null)

	const form = pathname === '/' && !maxSM ? 'full' : 'icons'
	const compactIconNav = form === 'icons' && init
	const items = compactIconNav ? compactItems : list
	const iconGap = maxSM ? (maxXS ? 8 : 12) : 24
	const iconGapClass = maxSM ? (maxXS ? 'gap-2' : 'gap-3') : 'gap-6'
	const isCurrentPath = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
	const activeIndex = list.findIndex(item => isCurrentPath(item.href))
	const [hoveredIndex, setHoveredIndex] = useState(Math.max(activeIndex, 0))
	const siteTitle = useConfigStore(state => state.siteContent.meta.title)
	const styles = useConfigStore(state => state.cardStyles.navCard)
	const hiCardStyles = useConfigStore(state => state.cardStyles.hiCard)

	const itemHeight = form === 'full' ? 52 : 28

	const size =
		form === 'icons'
			? { width: compactIconNav ? (isExpanded ? getExpandedWidth(iconGap) : 64) : 340, height: 64 }
			: { width: styles.width, height: styles.height }
	const position = maxSM
		? { x: centerX - size.width / 2, y: 16 }
		: form === 'full'
			? {
				x: styles.offsetX !== null ? centerX + styles.offsetX : centerX - hiCardStyles.width / 2 - styles.width - CARD_SPACING,
				y: styles.offsetY !== null ? centerY + styles.offsetY : centerY + hiCardStyles.height / 2 - styles.height
			}
			: { x: 24, y: 16 }

	const clearLongPress = useCallback(() => {
		if (longPressTimerRef.current !== null) {
			window.clearTimeout(longPressTimerRef.current)
			longPressTimerRef.current = null
		}
		longPressStartRef.current = null
	}, [])

	const updateExpanded = useCallback(() => {
		setIsExpanded(pointerInsideRef.current || focusWithinRef.current || touchExpandedRef.current)
	}, [])

	const closeNavigation = useCallback(() => {
		pointerInsideRef.current = false
		focusWithinRef.current = false
		touchExpandedRef.current = false
		setIsExpanded(false)
		clearLongPress()
	}, [clearLongPress])

	useEffect(() => {
		if (activeIndex >= 0) setHoveredIndex(activeIndex)
	}, [activeIndex])

	useEffect(() => {
		closeNavigation()
	}, [closeNavigation, compactIconNav, pathname])

	useEffect(() => {
		if (!compactIconNav || !isExpanded || !touchExpandedRef.current) return

		const handleOutsidePointerDown = (event: PointerEvent) => {
			if (!navRef.current?.contains(event.target as Node)) closeNavigation()
		}

		document.addEventListener('pointerdown', handleOutsidePointerDown)
		return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
	}, [closeNavigation, compactIconNav, isExpanded])

	useEffect(() => clearLongPress, [clearLongPress])

	useEffect(() => {
		if (transitioning || !compactIconNav || !mousePositionRef.current || !navRef.current) return

		const { x, y } = mousePositionRef.current
		const bounds = navRef.current.getBoundingClientRect()
		pointerInsideRef.current = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
		updateExpanded()
	}, [compactIconNav, transitioning, updateExpanded])

	const rememberMousePosition = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.pointerType === 'mouse') mousePositionRef.current = { x: event.clientX, y: event.clientY }
	}

	const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!compactIconNav || event.pointerType !== 'mouse') return
		rememberMousePosition(event)
		pointerInsideRef.current = true
		updateExpanded()
	}

	const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!compactIconNav || event.pointerType !== 'mouse') return
		rememberMousePosition(event)
		if (transitioning || document.documentElement.classList.contains('time-theme-transitioning')) return
		pointerInsideRef.current = false
		updateExpanded()
	}

	const handleFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
		if (!compactIconNav || !(event.target as HTMLElement).matches(':focus-visible')) return
		focusWithinRef.current = true
		updateExpanded()
	}

	const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
		if (!compactIconNav || event.currentTarget.contains(event.relatedTarget as Node | null)) return
		focusWithinRef.current = false
		updateExpanded()
	}

	const handleAvatarPointerDown = (event: React.PointerEvent<HTMLAnchorElement>) => {
		lastPointerTypeRef.current = event.pointerType
		longPressTriggeredRef.current = false
		if (!compactIconNav || event.pointerType === 'mouse') return

		longPressStartRef.current = { x: event.clientX, y: event.clientY }
		longPressTimerRef.current = window.setTimeout(() => {
			longPressTimerRef.current = null
			longPressTriggeredRef.current = true
			touchExpandedRef.current = true
			setIsExpanded(true)
		}, longPressDuration)
	}

	const handleAvatarPointerMove = (event: React.PointerEvent<HTMLAnchorElement>) => {
		const start = longPressStartRef.current
		if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) return
		clearLongPress()
	}

	const handleAvatarClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (!compactIconNav || (lastPointerTypeRef.current !== 'touch' && lastPointerTypeRef.current !== 'pen')) return
		if (longPressTriggeredRef.current) {
			event.preventDefault()
			longPressTriggeredRef.current = false
			return
		}
		if (touchExpandedRef.current) return

		event.preventDefault()
		touchExpandedRef.current = true
		setIsExpanded(true)
	}

	return (
			<Card
				order={styles.order}
				width={size.width}
				height={size.height}
				x={position.x}
				y={position.y}
				className={clsx('overflow-hidden', form === 'icons' && 'p-3')}>
				<div
					ref={navRef}
					onPointerEnter={handlePointerEnter}
					onPointerLeave={handlePointerLeave}
					onPointerMove={rememberMousePosition}
					onFocusCapture={handleFocusCapture}
					onBlurCapture={handleBlurCapture}
					className={cn(form === 'icons' && '-m-3 flex items-center p-3', form === 'icons' && iconGapClass)}>
					<Link
						className={cn('flex items-center gap-3', form === 'icons' && 'shrink-0 select-none')}
						href='/'
						aria-expanded={compactIconNav ? isExpanded : undefined}
						aria-controls={compactIconNav ? 'compact-site-navigation' : undefined}
						onPointerDown={handleAvatarPointerDown}
						onPointerMove={handleAvatarPointerMove}
						onPointerUp={clearLongPress}
						onPointerCancel={clearLongPress}
						onPointerLeave={event => event.pointerType !== 'mouse' && clearLongPress()}
						onContextMenu={event => {
							if (compactIconNav && lastPointerTypeRef.current !== 'mouse') event.preventDefault()
						}}
						onClick={handleAvatarClick}>
						<OptimizedImage
							src={getAssetUrl('/images/avatar.png')}
							alt='avatar'
							width={40}
							height={40}
							style={{ boxShadow: ' 0 12px 20px -5px #E2D9CE' }}
							className='rounded-full'
						/>
						{form === 'full' && <span className='font-averia mt-1 text-2xl leading-none font-medium'>{siteTitle}</span>}
						{form === 'full' && <span className='text-brand mt-2 text-xs font-medium'>(开发中)</span>}
					</Link>

					{(form === 'full' || form === 'icons') && (
						<>
							{form !== 'icons' && <div className='text-secondary mt-6 text-sm uppercase'>General</div>}

							<div
								id='compact-site-navigation'
								aria-hidden={compactIconNav && !isExpanded}
								inert={compactIconNav && !isExpanded}
								className={cn('relative mt-2 shrink-0 space-y-2', form === 'icons' && 'mt-0 flex items-center space-y-0', form === 'icons' && iconGapClass)}>
								<motion.div
									className='absolute top-0 left-0 max-w-[230px] rounded-full border'
									initial={false}
									animate={
										form === 'icons'
											? {
													x: hoveredIndex * (itemHeight + iconGap) - extraSize,
													y: -extraSize,
													width: itemHeight + extraSize * 2,
													height: itemHeight + extraSize * 2
												}
											: { x: 0, y: hoveredIndex * (itemHeight + 8), width: '100%', height: itemHeight }
									}
									transition={{
										type: 'spring',
										stiffness: 400,
										damping: 30
									}}
									style={{ backgroundImage: 'linear-gradient(to right bottom, var(--color-border) 60%, var(--color-card) 100%)' }}
								/>

								{items.map((item, index) =>
									'type' in item ? (
										<button
											key={item.type}
											type='button'
											title={`切换时间主题（当前：${themeLabels[theme.name]}）`}
											aria-label={`切换时间主题，当前：${themeLabels[theme.name]}`}
											onClick={cycleTheme}
											onMouseEnter={() => setHoveredIndex(index)}
											onFocus={() => setHoveredIndex(index)}
											className='text-secondary text-md relative z-10 flex h-7 w-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/50'>
											<SunMoon strokeWidth={1.6} className={clsx('h-6 w-6', hoveredIndex === index && 'text-brand')} aria-hidden='true' />
										</button>
									) : (
										<Link
											key={item.href}
											href={item.href}
											aria-current={isCurrentPath(item.href) ? 'page' : undefined}
											className={cn('text-secondary text-md relative z-10 flex items-center gap-3 rounded-full px-5 py-3', form === 'icons' && 'p-0')}
											onMouseEnter={() => setHoveredIndex(index)}
											onFocus={() => setHoveredIndex(index)}>
											<div className='flex h-7 w-7 items-center justify-center'>
												{hoveredIndex === index ? <item.iconActive className='text-brand absolute h-7 w-7' /> : <item.icon className='absolute h-7 w-7' />}
											</div>
											{form !== 'icons' && <span className={clsx(index === hoveredIndex && 'text-primary font-medium')}>{item.label}</span>}
										</Link>
									)
								)}
							</div>
						</>
					)}
				</div>
			</Card>
		)
}
