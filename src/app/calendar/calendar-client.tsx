'use client'

import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import { getAlmanacDay } from '@/lib/calendar/almanac'
import { getCalendarFestival } from '@/lib/calendar/festivals'
import { CalendarDayPanel } from './calendar-day-panel'
import { CalendarGrid } from './calendar-grid'
import { getCalendarDays, getChineseMonth, getSolarTermContext, getYearProgress, toDateKey } from './calendar-data'
import { SolarTermTrack } from './solar-term-track'
import styles from './calendar.module.css'

dayjs.locale('zh-cn')

function clampDateToMonth(date: Dayjs, month: Dayjs) {
	return month.date(Math.min(date.date(), month.daysInMonth())).startOf('day')
}

export function CalendarClient() {
	const [today] = useState(() => dayjs().startOf('day'))
	const [viewMonth, setViewMonth] = useState(() => today.startOf('month'))
	const [selectedDate, setSelectedDate] = useState(() => today)
	const [direction, setDirection] = useState(1)
	const [focusDateKey, setFocusDateKey] = useState<string | null>(null)

	const days = useMemo(() => getCalendarDays(viewMonth, today), [today, viewMonth])
	const almanac = useMemo(() => getAlmanacDay(selectedDate.toDate()), [selectedDate])
	const festival = useMemo(() => getCalendarFestival(selectedDate.toDate()), [selectedDate])
	const termContext = useMemo(() => getSolarTermContext(selectedDate), [selectedDate])
	const yearProgress = useMemo(() => getYearProgress(selectedDate), [selectedDate])
	const selectedDateKey = toDateKey(selectedDate)
	const viewKey = viewMonth.format('YYYY-MM')

	const selectDate = useCallback(
		(date: Dayjs, focus: boolean) => {
			const nextDate = date.startOf('day')
			const nextMonth = nextDate.startOf('month')
			const monthOffset = nextMonth.diff(viewMonth, 'month')

			if (monthOffset !== 0) {
				setDirection(monthOffset > 0 ? 1 : -1)
				setViewMonth(nextMonth)
			}

			setSelectedDate(nextDate)
			setFocusDateKey(focus ? toDateKey(nextDate) : null)
		},
		[viewMonth]
	)

	const moveMonth = useCallback(
		(offset: number) => {
			const nextMonth = viewMonth.add(offset, 'month').startOf('month')
			const nextDate = clampDateToMonth(selectedDate, nextMonth)
			setDirection(offset > 0 ? 1 : -1)
			setViewMonth(nextMonth)
			setSelectedDate(nextDate)
			setFocusDateKey(null)
		},
		[selectedDate, viewMonth]
	)

	const returnToToday = useCallback(() => {
		const monthOffset = today.startOf('month').diff(viewMonth, 'month')
		setDirection(monthOffset < 0 ? -1 : 1)
		setViewMonth(today.startOf('month'))
		setSelectedDate(today)
		setFocusDateKey(null)
	}, [today, viewMonth])

	return (
		<MotionConfig reducedMotion='user'>
			<div className={styles.page}>
				<div className={styles.themeGlow} data-position='top' aria-hidden='true' />
				<div className={styles.themeGlow} data-position='bottom' aria-hidden='true' />
				<svg className={styles.celestialField} viewBox='0 0 1080 760' aria-hidden='true'>
					<circle cx='858' cy='82' r='238' />
					<circle cx='858' cy='82' r='166' />
					<path d='M34 700 C 212 586, 364 672, 518 576 S 806 466, 1046 542' />
					<g>
						<circle cx='620' cy='82' r='3' />
						<circle cx='690' cy='-86' r='3' />
						<circle cx='858' cy='-156' r='3' />
						<circle cx='1026' cy='-86' r='3' />
						<circle cx='1096' cy='82' r='3' />
						<circle cx='1026' cy='250' r='3' />
						<circle cx='858' cy='320' r='3' />
						<circle cx='690' cy='250' r='3' />
					</g>
				</svg>

				<div className={styles.content}>
					<motion.header className={styles.header} initial={{ opacity: 0.72, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}>
						<div className={styles.titleRow}>
							<div className={styles.titleBlock}>
								<h1>
									<motion.span
										key={viewMonth.year()}
										className={styles.yearArtwork}
										data-year={viewMonth.year()}
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}>
										{viewMonth.year()}
									</motion.span>
									<motion.em key={viewKey} initial={{ opacity: 0, x: direction * 12 }} animate={{ opacity: 1, x: 0 }}>
										{getChineseMonth(viewMonth.month())}
									</motion.em>
								</h1>
							</div>

							<div className={styles.seasonMark} aria-label={`当前节气${termContext.current.name}，距离${termContext.next.name}${termContext.daysToNext}天`}>
								<motion.span key={termContext.current.name} initial={{ opacity: 0, rotate: -8, scale: 0.88 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 280, damping: 24 }}>
									{termContext.current.name}
								</motion.span>
								<div>
									<strong>{termContext.phrase}</strong>
									<small>
										距{termContext.next.name} {termContext.daysToNext} 天
									</small>
								</div>
							</div>
						</div>

						<div className={styles.toolbar}>
							<div className={styles.monthControls} aria-label='月份导航'>
								<button type='button' onClick={() => moveMonth(-1)} aria-label='上一个月'>
									<ChevronLeft aria-hidden='true' />
								</button>
								<button type='button' onClick={returnToToday}>
									今天
								</button>
								<button type='button' onClick={() => moveMonth(1)} aria-label='下一个月'>
									<ChevronRight aria-hidden='true' />
								</button>
							</div>
							<div className={styles.yearProgress} aria-label={`${selectedDate.year()}年已过去${Math.round(yearProgress.progress * 100)}%`}>
								<motion.span initial={false} animate={{ scaleX: yearProgress.progress }} transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }} />
							</div>
							<span>
								{yearProgress.dayOfYear} / {yearProgress.totalDays}
							</span>
						</div>
					</motion.header>

					<motion.main className={styles.stage} initial={{ opacity: 0.72, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
						<section className={styles.monthSection} aria-labelledby='calendar-month-title'>
							<div className={styles.sectionLabel}>
								<div>
									<h2 id='calendar-month-title'>月历</h2>
									<span>公历 · 农历 · 节气</span>
								</div>
								<span>
									{viewMonth.format('MMM').toUpperCase()} · {viewMonth.year()}
								</span>
							</div>
							<CalendarGrid
								days={days}
								direction={direction}
								focusDateKey={focusDateKey}
								selectedDateKey={selectedDateKey}
								viewKey={viewKey}
								onSelect={selectDate}
							/>
						</section>

						<CalendarDayPanel almanac={almanac} festival={festival} selectedDate={selectedDate} termContext={termContext} today={today} yearProgress={yearProgress} />
					</motion.main>

					<motion.div initial={{ opacity: 0.72, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.45 }}>
						<SolarTermTrack context={termContext} />
					</motion.div>
				</div>
			</div>
		</MotionConfig>
	)
}
