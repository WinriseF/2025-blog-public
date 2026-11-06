'use client'

import { useRef } from 'react'
import styles from './database.module.css'

export function PaneDivider({
	value,
	onChange,
	min,
	max,
	horizontal = false,
	percent = false,
	label
}: {
	value: number
	onChange: (value: number) => void
	min: number
	max: number
	horizontal?: boolean
	percent?: boolean
	label: string
}) {
	const drag = useRef<{ start: number; value: number; scale: number } | null>(null)
	const change = (next: number) => onChange(Math.min(max, Math.max(min, next)))
	return (
		<div
			role='separator'
			tabIndex={0}
			aria-label={label}
			aria-orientation={horizontal ? 'horizontal' : 'vertical'}
			aria-valuenow={Math.round(value)}
			aria-valuemin={min}
			aria-valuemax={max}
			className={horizontal ? styles.horizontalDivider : styles.verticalDivider}
			onPointerDown={event => {
				event.preventDefault()
				const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
				drag.current = { start: horizontal ? event.clientY : event.clientX, value, scale: percent ? 100 / (horizontal ? bounds.height : bounds.width) : 1 }
				event.currentTarget.setPointerCapture(event.pointerId)
			}}
			onPointerMove={event => {
				if (drag.current) change(drag.current.value + ((horizontal ? event.clientY : event.clientX) - drag.current.start) * drag.current.scale)
			}}
			onPointerUp={() => {
				drag.current = null
			}}
			onLostPointerCapture={() => {
				drag.current = null
			}}
			onKeyDown={event => {
				const negative = horizontal ? 'ArrowUp' : 'ArrowLeft'
				const positive = horizontal ? 'ArrowDown' : 'ArrowRight'
				if (![negative, positive, 'Home', 'End'].includes(event.key)) return
				event.preventDefault()
				change(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === positive ? 1 : -1) * (percent ? 3 : 16))
			}}
		/>
	)
}
