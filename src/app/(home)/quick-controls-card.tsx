'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Globe2, Moon, SunMedium, Sunrise, Sunset } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ANIMATION_DELAY, CARD_SPACING } from '@/consts'
import { useConfigStore } from './stores/config-store'
import { useCenterStore } from '@/hooks/use-center'
import { useSize } from '@/hooks/use-size'
import { useClickEffectPreference } from '@/components/click-effect-preference'
import { useTimeTheme } from '@/components/time-theme-provider'
import type { TimeThemeName } from '@/lib/time-theme'
import { cn } from '@/lib/utils'

const themes: Array<{ name: TimeThemeName; label: string; icon: typeof Sunrise }> = [
	{ name: 'dawn', label: '清晨', icon: Sunrise },
	{ name: 'noon', label: '正午', icon: SunMedium },
	{ name: 'sunset', label: '日落', icon: Sunset },
	{ name: 'night', label: '夜晚', icon: Moon }
]

const EXPANDED_WIDTH = 292
const panelHeights = {
	theme: 139,
	sites: 201
} as const

type ActivePanel = 'theme' | 'sites' | null

function getHostname(url: string) {
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		return ''
	}
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export default function QuickControlsCard() {
	const center = useCenterStore()
	const { cardStyles, siteContent } = useConfigStore()
	const { maxSM } = useSize()
	const { theme, setThemeName } = useTimeTheme()
	const clickEffect = useClickEffectPreference()
	const shouldReduceMotion = useReducedMotion()
	const rootRef = useRef<HTMLElement>(null)
	const themePanelId = useId()
	const sitePanelId = useId()
	const [show, setShow] = useState(false)
	const [activePanel, setActivePanel] = useState<ActivePanel>(null)
	const [hostname, setHostname] = useState('')
	const styles = cardStyles.quickControls
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard
	const compactWidth = styles.width
	const expanded = activePanel !== null
	const width = expanded ? Math.max(EXPANDED_WIDTH, compactWidth) : compactWidth
	const panelHeight = activePanel ? panelHeights[activePanel] : 0
	const height = styles.height + panelHeight

	useEffect(() => {
		const timer = window.setTimeout(() => setShow(true), styles.order * ANIMATION_DELAY * 1000)
		return () => window.clearTimeout(timer)
	}, [styles.order])

	useEffect(() => {
		setHostname(window.location.hostname.toLowerCase())
	}, [])

	useEffect(() => {
		if (!activePanel) return
		const closeOnOutsidePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setActivePanel(null)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setActivePanel(null)
		}

		document.addEventListener('pointerdown', closeOnOutsidePointerDown)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOnOutsidePointerDown)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [activePanel])

	if (maxSM || !show) return null

	const preferredX = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2
	const x = clamp(preferredX, 12, Math.max(12, center.width - width - 12))
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset - styles.height - CARD_SPACING / 2 - clockCardStyles.height
	const HomeIcon = { dawn: Sunrise, noon: SunMedium, sunset: Sunset, night: Moon }[theme.name]
	const cardTransition = shouldReduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.72 }
	const controlClassName = (active: boolean) =>
		cn(
			'flex size-10 items-center justify-center rounded-2xl outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/45',
			active ? 'bg-brand/12 text-brand shadow-inner' : 'text-secondary hover:bg-brand/8 hover:text-brand'
		)
	const togglePanel = (panel: Exclude<ActivePanel, null>) => {
		if (activePanel === panel) {
			setActivePanel(null)
			return
		}
		setActivePanel(panel)
	}

	return (
		<motion.div initial={{ left: x, top: y }} animate={{ left: x, top: y }} transition={cardTransition} className='absolute z-30'>
			<motion.section
				ref={rootRef}
				initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.92, width: compactWidth, height: styles.height }}
				animate={{ opacity: 1, scale: 1, width, height }}
				transition={cardTransition}
				data-click-effect='off'
				className='bg-card overflow-hidden rounded-[24px] border p-1.5 shadow-[0_18px_50px_-24px_var(--color-primary)] backdrop-blur-xl'>
				<div role='group' aria-label='首页快捷设置' className='flex items-center gap-2'>
					<motion.button
						type='button'
						aria-label='主题设置'
						aria-expanded={activePanel === 'theme'}
						aria-controls={activePanel === 'theme' ? themePanelId : undefined}
						onClick={() => togglePanel('theme')}
						whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
						className={controlClassName(activePanel === 'theme')}>
						<HomeIcon className='size-5' strokeWidth={2} aria-hidden='true' />
					</motion.button>
					<motion.button
						type='button'
						aria-label='切换部署站点'
						aria-expanded={activePanel === 'sites'}
						aria-controls={activePanel === 'sites' ? sitePanelId : undefined}
						onClick={() => togglePanel('sites')}
						whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
						className={controlClassName(activePanel === 'sites')}>
						<Globe2 className='size-5' strokeWidth={2} aria-hidden='true' />
					</motion.button>
				</div>

				<motion.div
					initial={false}
					animate={{ height: panelHeight }}
					transition={cardTransition}
					className='overflow-hidden'>
					<AnimatePresence initial={false} mode='wait'>
					{activePanel === 'theme' && (
						<motion.section
							key='theme'
							id={themePanelId}
							role='region'
							aria-label='主题设置'
							initial={shouldReduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
							transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0, 0, 1] }}
							className='border-border mt-1.5 border-t px-2 pt-3 pb-2'>
							<div className='grid grid-cols-4 gap-1'>
								{themes.map(option => (
									<button
										key={option.name}
										type='button'
										aria-label={`切换到${option.label}主题`}
										aria-pressed={theme.name === option.name}
										onClick={() => setThemeName(option.name)}
										className={cn(
											'text-secondary flex min-h-15 flex-col items-center justify-center gap-1 rounded-2xl border border-transparent px-1 py-2 text-[11px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/45',
											theme.name === option.name ? 'border-brand/45 bg-brand/10 text-brand' : 'hover:bg-brand/8 hover:text-brand'
										)}>
										<option.icon className='size-4' aria-hidden='true' />
										<span>{option.label}</span>
									</button>
								))}
							</div>

							<button
								type='button'
								role='switch'
								aria-checked={clickEffect.enabled}
								disabled={!clickEffect.ready}
								onClick={() => clickEffect.setEnabled(!clickEffect.enabled)}
								className='border-border mt-3 flex min-h-10 w-full items-center justify-between border-t pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/45 disabled:opacity-50'>
								<span className='text-primary text-sm'>点击动画</span>
								<span className={cn('relative h-6 w-11 rounded-full transition-colors duration-150', clickEffect.enabled ? 'bg-brand' : 'bg-border')} aria-hidden='true'>
									<span className={cn('absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform duration-150', clickEffect.enabled && 'translate-x-5')} />
								</span>
							</button>
						</motion.section>
					)}

					{activePanel === 'sites' && (
						<motion.section
							key='sites'
							id={sitePanelId}
							role='region'
							aria-label='部署站点切换'
							initial={shouldReduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
							transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0, 0, 1] }}
							className='border-border mt-1.5 border-t px-2 pt-3 pb-2'>
							<p className='text-secondary mb-2 px-1 text-xs'>选择部署站点</p>
							<div className='grid gap-1.5'>
								{siteContent.siteSwitcher.sites.map(site => {
									const current = hostname === getHostname(site.url)
									const itemClassName = cn(
										'flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/45',
										current ? 'bg-brand/10 text-brand' : 'text-secondary hover:bg-brand/8 hover:text-primary'
									)

									const content = (
										<>
											<span className={cn('flex size-7 shrink-0 items-center justify-center rounded-xl text-xs font-bold', current ? 'bg-brand text-white' : 'bg-border text-primary')}>
												{site.shortLabel}
											</span>
											<span className='min-w-0'>
												<span className='block text-sm font-medium'>{site.label}</span>
												<span className='block truncate text-[11px] opacity-75'>{getHostname(site.url)}</span>
											</span>
											{current && <span className='ml-auto text-[11px] font-medium'>当前</span>}
										</>
									)

									return current ? (
										<div key={site.id} aria-current='page' className={itemClassName}>
											{content}
										</div>
									) : (
										<motion.a key={site.id} href={site.url} whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }} className={itemClassName}>
											{content}
										</motion.a>
									)
								})}
							</div>
						</motion.section>
					)}
					</AnimatePresence>
				</motion.div>
			</motion.section>
		</motion.div>
	)
}
