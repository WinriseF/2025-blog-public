'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { type CalendarDayModel, weekdayLabels } from './calendar-data'
import styles from './calendar.module.css'

type CalendarGridProps = {
	days: CalendarDayModel[]
	direction: number
	focusDateKey: string | null
	selectedDateKey: string
	viewKey: string
	onSelect: (date: CalendarDayModel['date'], focus: boolean) => void
}

type MonthGridProps = Omit<CalendarGridProps, 'viewKey'>

function getKeyboardTarget(event: KeyboardEvent<HTMLButtonElement>, day: CalendarDayModel) {
	switch (event.key) {
		case 'ArrowLeft':
			return day.date.subtract(1, 'day')
		case 'ArrowRight':
			return day.date.add(1, 'day')
		case 'ArrowUp':
			return day.date.subtract(7, 'day')
		case 'ArrowDown':
			return day.date.add(7, 'day')
		case 'PageUp': {
			const targetMonth = day.date.subtract(1, 'month')
			return targetMonth.date(Math.min(day.day, targetMonth.daysInMonth()))
		}
		case 'PageDown': {
			const targetMonth = day.date.add(1, 'month')
			return targetMonth.date(Math.min(day.day, targetMonth.daysInMonth()))
		}
		case 'Home':
			return day.date.subtract((day.date.day() + 6) % 7, 'day')
		case 'End':
			return day.date.add(6 - ((day.date.day() + 6) % 7), 'day')
		default:
			return null
	}
}

function MonthGrid({ days, direction, focusDateKey, selectedDateKey, onSelect }: MonthGridProps) {
	const gridRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!focusDateKey) return
		gridRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date='${focusDateKey}']`)?.focus()
	}, [focusDateKey])

	return (
		<motion.div
			ref={gridRef}
			className={styles.monthGrid}
			role='rowgroup'
			initial={{ opacity: 0, x: direction * 16 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: direction * -16 }}
			transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
			{Array.from({ length: 6 }, (_, weekIndex) => {
				const week = days.slice(weekIndex * 7, weekIndex * 7 + 7)
				return (
					<div key={week[0].key} className={styles.weekRow} role='row'>
						{week.map(day => {
							const selected = day.key === selectedDateKey
							const secondaryLabel = day.solarTerm || day.festival?.label || day.lunarLabel
							const semanticLabel = [day.date.format('YYYY年M月D日 dddd'), day.lunarFullLabel, day.solarTerm, day.festival?.label, day.holidayStatus && `${day.holidayStatus}日`]
								.filter(Boolean)
								.join('，')

							return (
								<button
									key={day.key}
									type='button'
									role='gridcell'
									data-calendar-date={day.key}
									aria-current={day.isToday ? 'date' : undefined}
									aria-label={semanticLabel}
									aria-selected={selected}
									tabIndex={selected ? 0 : -1}
									className={cn(
										styles.day,
										day.isAdjacent && styles.adjacentDay,
										day.isWeekend && styles.weekendDay,
										(day.solarTerm || day.festival) && styles.notableDay
									)}
									onClick={() => onSelect(day.date, true)}
									onKeyDown={event => {
										const target = getKeyboardTarget(event, day)
										if (!target) return
										event.preventDefault()
										onSelect(target, true)
									}}>
									{selected && <motion.span layoutId='calendar-selected-day' className={styles.selectedDayOrbit} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
									<span className={styles.dayCopy}>
										<span className={styles.dayNumber}>{day.day}</span>
										<span className={cn(styles.daySecondary, (day.solarTerm || day.festival) && styles.dayEvent)}>{secondaryLabel}</span>
									</span>
									{day.holidayStatus && <span className={styles.holidayStatus}>{day.holidayStatus}</span>}
									{day.isToday && !selected && <span className={styles.todayDot} aria-hidden='true' />}
								</button>
							)
						})}
					</div>
				)
			})}
		</motion.div>
	)
}

export function CalendarGrid({ days, direction, focusDateKey, selectedDateKey, viewKey, onSelect }: CalendarGridProps) {
	return (
		<LayoutGroup id='calendar-month-grid'>
			<div className={styles.gridShell} role='grid' aria-label={`${days[15].date.format('YYYY 年 M 月')}日历`}>
				<div className={styles.weekdays} role='row'>
					{weekdayLabels.map(label => (
						<span key={label} role='columnheader'>
							{label}
						</span>
					))}
				</div>
				<div className={styles.monthViewport} role='presentation' data-direction={direction}>
					<AnimatePresence initial={false}>
						<MonthGrid key={viewKey} days={days} direction={direction} focusDateKey={focusDateKey} selectedDateKey={selectedDateKey} onSelect={onSelect} />
					</AnimatePresence>
				</div>
			</div>
		</LayoutGroup>
	)
}
