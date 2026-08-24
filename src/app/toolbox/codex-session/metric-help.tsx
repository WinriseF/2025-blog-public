'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'

type Position = { left: number; top: number; width: number }

export function MetricHelp({ label, children }: { label: string; children: string }) {
	const id = useId()
	const buttonRef = useRef<HTMLButtonElement | null>(null)
	const [open, setOpen] = useState(false)
	const [position, setPosition] = useState<Position>()

	const updatePosition = useCallback(() => {
		const bounds = buttonRef.current?.getBoundingClientRect()
		if (!bounds) return
		const width = Math.min(288, window.innerWidth - 24)
		const left = Math.min(Math.max(bounds.left + bounds.width / 2 - width / 2, 12), window.innerWidth - width - 12)
		setPosition({ left, top: bounds.bottom + 8, width })
	}, [])

	const show = useCallback(() => {
		updatePosition()
		setOpen(true)
	}, [updatePosition])

	useEffect(() => {
		if (!open) return
		const closeOutside = (event: PointerEvent) => {
			if (!buttonRef.current?.contains(event.target as Node)) setOpen(false)
		}
		const reposition = () => updatePosition()
		document.addEventListener('pointerdown', closeOutside)
		window.addEventListener('resize', reposition)
		window.addEventListener('scroll', reposition, true)
		return () => {
			document.removeEventListener('pointerdown', closeOutside)
			window.removeEventListener('resize', reposition)
			window.removeEventListener('scroll', reposition, true)
		}
	}, [open, updatePosition])

	return <>
		<button
			ref={buttonRef}
			type='button'
			aria-label={`解释${label}`}
			aria-expanded={open}
			aria-controls={id}
			onMouseEnter={show}
			onMouseLeave={() => setOpen(false)}
			onFocus={show}
			onBlur={() => setOpen(false)}
			onPointerDown={event => {
				if (event.pointerType === 'mouse') return
				event.preventDefault()
				if (open) setOpen(false)
				else show()
			}}
			onKeyDown={event => event.key === 'Escape' && setOpen(false)}
			className='text-secondary/75 hover:text-brand focus-visible:text-brand inline-flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/40'
		>
			<CircleHelp size={12} aria-hidden='true' />
		</button>
		{open && position && typeof document !== 'undefined' && createPortal(
			<div id={id} role='tooltip' className='bg-article fixed z-[100] rounded-lg border border-border px-3 py-2 text-left text-[11px] leading-5 text-primary shadow-xl' style={position}>
				{children}
			</div>,
			document.body
		)}
	</>
}

export function MetricLabel({ label, help }: { label: string; help?: string }) {
	return <span className='flex min-w-0 items-center gap-1'>
		<span className='min-w-0 flex-1 truncate'>{label}</span>
		{help && <MetricHelp label={label}>{help}</MetricHelp>}
	</span>
}
