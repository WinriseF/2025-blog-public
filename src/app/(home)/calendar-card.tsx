'use client'

import { useRouter } from 'next/navigation'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import { cn } from '@/lib/utils'
import { getCalendarFestival, isHolidayOffDay } from '@/lib/calendar/festivals'
import { HomeDraggableLayer } from './home-draggable-layer'

dayjs.locale('zh-cn')

const dates = ['一', '二', '三', '四', '五', '六', '日']

export default function CalendarCard() {
	const router = useRouter()
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const now = dayjs()
	const currentDate = now.date()
	const firstDayOfMonth = now.startOf('month')
	const firstDayWeekday = (firstDayOfMonth.day() + 6) % 7
	const daysInMonth = now.daysInMonth()
	const currentWeekday = (now.day() + 6) % 7
	const styles = cardStyles.calendarCard
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset + CARD_SPACING

	return (
		<HomeDraggableLayer cardKey='calendarCard' x={x} y={y} width={styles.width} height={styles.height}>
			<Card order={styles.order} width={styles.width} height={styles.height} x={x} y={y}>
				<button type='button' onClick={() => router.push('/calendar')} className='block h-full w-full text-left'>
					<h3 className='text-secondary text-sm'>
						{now.format('YYYY/M/D')} {now.format('ddd')}
					</h3>
					<ul className='text-secondary mt-3 grid h-[206px] grid-cols-7 gap-2 text-sm'>
						{dates.map((label, index) => {
							const isCurrentWeekday = index === currentWeekday
							return (
								<li key={label} className={cn('flex items-center justify-center font-medium', isCurrentWeekday && 'text-brand')}>
									{label}
								</li>
							)
						})}

						{new Array(firstDayWeekday).fill(0).map((_, index) => (
							<li key={`empty-${index}`} />
						))}

						{new Array(daysInMonth).fill(0).map((_, index) => {
							const day = index + 1
							const isToday = day === currentDate
							const date = now.date(day).toDate()
							const festival = getCalendarFestival(date)
							const isOffDay = isHolidayOffDay(date)
							return (
								<li
									key={day}
									className={cn(
										'relative flex items-center justify-center rounded-lg border border-transparent transition-colors',
										isOffDay && !isToday && 'border-[var(--color-brand)]/15 bg-[var(--color-brand)]/10 text-brand',
										festival?.type === 'solar' && !isOffDay && !isToday && 'border-[#e85d75]/15 bg-[#e85d75]/10 text-[#b73c55]',
										festival?.type === 'lunar' && !isOffDay && !isToday && 'border-[#d08a00]/20 bg-[#d08a00]/12 text-[#a76600]',
										isToday && 'bg-linear border font-medium text-white'
									)}>
									{day}
								</li>
							)
						})}
					</ul>
				</button>
			</Card>
		</HomeDraggableLayer>
	)
}
