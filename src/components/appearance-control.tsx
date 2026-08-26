'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Moon, SunMedium, SunMoon, Sunrise, Sunset } from 'lucide-react'
import type { TimeThemeName } from '@/lib/time-theme'
import { cn } from '@/lib/utils'
import { useClickEffectPreference } from '@/components/click-effect-preference'
import { useTimeTheme } from '@/components/time-theme-provider'

const themes: Array<{ name: TimeThemeName; label: string; icon: typeof Sunrise }> = [
	{ name: 'dawn', label: '清晨', icon: Sunrise },
	{ name: 'noon', label: '正午', icon: SunMedium },
	{ name: 'sunset', label: '日落', icon: Sunset },
	{ name: 'night', label: '夜晚', icon: Moon }
]

type AppearanceControlProps = {
	variant: 'home' | 'nav'
	className?: string
	onMouseEnter?: () => void
	onFocus?: () => void
}

export function AppearanceControl({ variant, className, onMouseEnter, onFocus }: AppearanceControlProps) {
	const { theme, setThemeName } = useTimeTheme()
	const clickEffect = useClickEffectPreference()
	const [open, setOpen] = useState(false)
	const [panelStyle, setPanelStyle] = useState<CSSProperties>()
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLElement>(null)
	const panelId = useId()
	const HomeIcon = { dawn: Sunrise, noon: SunMedium, sunset: Sunset, night: Moon }[theme.name]
	const TriggerIcon = variant === 'home' ? HomeIcon : SunMoon

	const togglePanel = () => {
		if (!open && triggerRef.current) {
			const bounds = triggerRef.current.getBoundingClientRect()
			const width = Math.min(260, window.innerWidth - 24)
			setPanelStyle({
				width,
				left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
				top: Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - 210))
			})
		}
		setOpen(current => !current)
	}

	useEffect(() => {
		if (!open) return
		const closeOnOutsideClick = (event: PointerEvent) => {
			const target = event.target as Node
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}

		document.addEventListener('pointerdown', closeOnOutsideClick)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOnOutsideClick)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [open])

	return (
		<>
			<button
				ref={triggerRef}
				type='button'
				data-click-effect='off'
				aria-label='外观设置'
				aria-haspopup='dialog'
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				onClick={togglePanel}
				onMouseEnter={onMouseEnter}
				onFocus={onFocus}
				className={className}>
				<TriggerIcon className={variant === 'home' ? 'size-5' : 'size-6'} strokeWidth={variant === 'nav' ? 1.6 : 2} aria-hidden='true' />
			</button>

			{open &&
				createPortal(
					<section
						id={panelId}
						ref={panelRef}
						role='dialog'
						aria-label='外观设置'
						data-click-effect='off'
						style={panelStyle}
						className='bg-card fixed z-[80] rounded-[20px] border p-4 shadow-xl backdrop-blur-xl'>
						<div className='grid grid-cols-4 gap-1'>
							{themes.map(option => (
								<button
									key={option.name}
									type='button'
									aria-label={`切换到${option.label}主题`}
									aria-pressed={theme.name === option.name}
									onClick={() => setThemeName(option.name)}
									className={cn(
										'text-secondary flex flex-col items-center gap-1 rounded-xl border border-transparent px-1 py-2 text-[10px]',
										theme.name === option.name && 'border-brand/45 bg-brand/10 text-brand'
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
							className='border-border mt-3 flex w-full items-center justify-between border-t pt-3 disabled:opacity-50'>
							<span className='text-primary text-sm'>点击动画</span>
							<span className={cn('relative h-6 w-11 rounded-full transition-colors', clickEffect.enabled ? 'bg-brand' : 'bg-border')} aria-hidden='true'>
								<span
									className={cn('absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform', clickEffect.enabled && 'translate-x-5')}
								/>
							</span>
						</button>
					</section>,
					document.body
				)}
		</>
	)
}
