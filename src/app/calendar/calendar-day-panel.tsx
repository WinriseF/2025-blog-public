'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { Dayjs } from 'dayjs'
import type { AlmanacDay } from '@/lib/calendar/almanac'
import type { CalendarFestival } from '@/lib/calendar/festivals'
import type { SolarTermContext } from './calendar-data'
import styles from './calendar.module.css'

type CalendarDayPanelProps = {
	almanac: AlmanacDay
	festival: CalendarFestival | null
	selectedDate: Dayjs
	termContext: SolarTermContext
	today: Dayjs
	yearProgress: {
		dayOfYear: number
		totalDays: number
		progress: number
	}
}

const orbitCircumference = 2 * Math.PI * 100

export function CalendarDayPanel({ almanac, festival, selectedDate, termContext, today, yearProgress }: CalendarDayPanelProps) {
	const selectedKey = selectedDate.format('YYYY-MM-DD')
	const isToday = selectedDate.isSame(today, 'day')

	return (
		<aside className={styles.dayPanel} aria-labelledby='calendar-selected-weekday'>
			<div className={styles.panelTopline}>
				<span>{isToday ? '今日 / TODAY' : '所选日期 / SELECTED'}</span>
				<span>DAY {yearProgress.dayOfYear}</span>
			</div>

			<div className={styles.dateOrbit}>
				<svg viewBox='0 0 240 240' aria-hidden='true'>
					<circle className={styles.orbitBase} cx='120' cy='120' r='100' />
					<motion.circle
						className={styles.orbitProgress}
						cx='120'
						cy='120'
						r='100'
						strokeDasharray={orbitCircumference}
						initial={false}
						animate={{ strokeDashoffset: orbitCircumference * (1 - yearProgress.progress) }}
						transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
					/>
					<circle className={styles.orbitInner} cx='120' cy='120' r='72' />
				</svg>
				<motion.span className={styles.orbitMarker} initial={false} animate={{ rotate: yearProgress.progress * 360 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
					<i />
				</motion.span>

				<AnimatePresence initial={false} mode='wait'>
					<motion.div
						key={selectedKey}
						className={styles.orbitDate}
						initial={{ opacity: 0, y: 8, scale: 0.96 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -6, scale: 0.98 }}
						transition={{ duration: 0.2 }}>
						<strong>{selectedDate.format('D')}</strong>
						<span>{almanac.lunarDate}</span>
					</motion.div>
				</AnimatePresence>
			</div>

			<AnimatePresence initial={false} mode='wait'>
				<motion.div
					key={selectedKey}
					className={styles.dayPanelContent}
					initial={{ opacity: 0, y: 9 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -7 }}
					transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
					<div className={styles.selectedDateHeading}>
						<div>
							<h2 id='calendar-selected-weekday'>{selectedDate.format('dddd')}</h2>
							<p>
								{almanac.ganzhiYear}年 · {almanac.ganzhiMonth}月 · {almanac.ganzhiDay}日
							</p>
						</div>
						{festival && <span className={styles.festivalMark}>{festival.label}</span>}
					</div>

					<p className={styles.selectedDateMeta}>
						{selectedDate.format('YYYY.MM.DD')} · {almanac.shengXiao}年 · {termContext.phrase}
					</p>

					<div className={styles.yiJi}>
						<div>
							<span className={styles.guidanceLabel}>宜</span>
							<p>{almanac.yi.join('　')}</p>
						</div>
						<div>
							<span className={styles.guidanceLabel}>忌</span>
							<p>{almanac.ji.join('　')}</p>
						</div>
					</div>

					<dl className={styles.dayFacts}>
						<div>
							<dt>冲煞</dt>
							<dd>
								{almanac.chong} · 煞{almanac.sha}
							</dd>
						</div>
						<div>
							<dt>星宿</dt>
							<dd>
								{almanac.xiu}宿 · {almanac.xiuLuck}
							</dd>
						</div>
						<div>
							<dt>纳音</dt>
							<dd>{almanac.naYin}</dd>
						</div>
					</dl>

					<div className={styles.nextTermSummary}>
						<div>
							<span>{termContext.next.name}</span>
							<small>
								{termContext.next.date.format('M 月 D 日')} · {termContext.daysToNext} 天
							</small>
						</div>
						<div className={styles.termMiniProgress} aria-label={`从${termContext.current.name}到${termContext.next.name}的进度`}>
							<motion.span initial={false} animate={{ scaleX: termContext.progress }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />
						</div>
					</div>
				</motion.div>
			</AnimatePresence>
		</aside>
	)
}
