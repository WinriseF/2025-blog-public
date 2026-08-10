'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

export type SelectMenuOption<Value extends string> = {
	value: Value
	label: string
}

type SelectMenuProps<Value extends string> = {
	value: Value
	options: readonly SelectMenuOption<Value>[]
	onChange: (value: Value) => void
	ariaLabel: string
	label?: string
	leading?: ReactNode
	disabled?: boolean
	className?: string
}

export function SelectMenu<Value extends string>({ value, options, onChange, ariaLabel, label, leading, disabled = false, className }: SelectMenuProps<Value>) {
	const listboxId = useId()
	const rootRef = useRef<HTMLDivElement | null>(null)
	const triggerRef = useRef<HTMLButtonElement | null>(null)
	const shouldReduceMotion = useReducedMotion()
	const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
	const [open, setOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(selectedIndex)
	const selected = options[selectedIndex]

	useEffect(() => {
		if (!open) return
		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', handlePointerDown)
		return () => document.removeEventListener('pointerdown', handlePointerDown)
	}, [open])

	const openMenu = () => {
		if (disabled) return
		setActiveIndex(selectedIndex)
		setOpen(true)
	}

	const choose = (index: number) => {
		const option = options[index]
		if (!option) return
		onChange(option.value)
		setOpen(false)
		requestAnimationFrame(() => triggerRef.current?.focus())
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (disabled) return

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (!open) {
				openMenu()
				return
			}
			const direction = event.key === 'ArrowDown' ? 1 : -1
			setActiveIndex(current => (current + direction + options.length) % options.length)
			return
		}

		if (open && (event.key === 'Home' || event.key === 'End')) {
			event.preventDefault()
			setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
			return
		}

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			if (open) choose(activeIndex)
			else openMenu()
			return
		}

		if (open && event.key === 'Escape') {
			event.preventDefault()
			setOpen(false)
			return
		}

		if (open && event.key === 'Tab') setOpen(false)
	}

	return (
		<div ref={rootRef} className={cn('relative z-30', className)}>
			<button
				ref={triggerRef}
				type='button'
				role='combobox'
				aria-label={ariaLabel}
				aria-haspopup='listbox'
				aria-controls={listboxId}
				aria-expanded={open}
				aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : openMenu())}
				onKeyDown={handleKeyDown}
				className='flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-article px-3 text-xs outline-none transition-colors duration-150 hover:border-brand/45 focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-55'>
				{leading}
				{label && <span className='text-secondary'>{label}</span>}
				<span className='font-semibold text-primary'>{selected?.label}</span>
				<ChevronDown size={16} className={cn('ml-auto text-secondary transition-transform duration-150', open && 'rotate-180')} />
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={shouldReduceMotion ? false : { opacity: 0, y: -4, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
						transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
						className='absolute top-[calc(100%+8px)] right-0 z-50 min-w-full overflow-hidden rounded-lg border border-border bg-article p-1.5 shadow-[0_18px_50px_-24px_var(--color-primary)]'>
						<div id={listboxId} role='listbox' aria-label={ariaLabel} className='grid max-h-72 gap-1 overflow-y-auto overscroll-contain'>
							{options.map((option, index) => {
								const selectedOption = option.value === value
								const active = index === activeIndex

								return (
									<button
										key={option.value}
										id={`${listboxId}-option-${index}`}
										type='button'
										role='option'
										tabIndex={-1}
										aria-selected={selectedOption}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => choose(index)}
										className={cn(
											'flex min-h-11 w-full items-center gap-3 whitespace-nowrap rounded-md px-3 text-left text-sm font-medium outline-none transition-colors duration-150',
											active ? 'bg-brand/10 text-primary' : 'text-secondary',
											selectedOption && 'text-brand'
										)}>
										<span className='flex size-5 shrink-0 items-center justify-center'>{selectedOption && <Check size={15} strokeWidth={2.4} />}</span>
										{option.label}
									</button>
								)
							})}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
