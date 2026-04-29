'use client'

import { useRouter } from 'next/navigation'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ChevronRight } from 'lucide-react'
import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import { cn } from '@/lib/utils'
import { HomeDraggableLayer } from './home-draggable-layer'

dayjs.locale('zh-cn')

const dates = ['一', '二', '三', '四', '五', '六', '日']

function getWeekStartMonday(date: dayjs.Dayjs) {
	const weekday = (date.day() + 6) % 7
	return date.subtract(weekday, 'day')
}

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
	const weekStart = getWeekStartMonday(now)

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset + CARD_SPACING

	return (
		<HomeDraggableLayer cardKey='calendarCard' x={x} y={y} width={styles.width} height={styles.height}>
			<Card order={styles.order} width={styles.width} height={styles.height} x={x} y={y} className='overflow-hidden'>
				<button type='button' onClick={() => router.push('/calendar')} className='group flex h-full w-full flex-col text-left'>
					<div className='flex items-start justify-between gap-4'>
						<div>
							<h3 className='text-secondary text-sm'>
								{now.format('YYYY/M/D')} {now.format('ddd')}
							</h3>
							<div className='mt-2 text-2xl font-semibold'>{now.format('MMMM')}</div>
						</div>
						<div className='flex h-8 w-8 items-center justify-center rounded-full border bg-white/45 transition-colors group-hover:bg-white/70'>
							<ChevronRight className='text-brand h-4 w-4' />
						</div>
					</div>

					<ul className='text-secondary mt-4 grid grid-cols-7 gap-1.5 text-xs'>
						{dates.map((label, index) => (
							<li key={label} className={cn('flex h-5 items-center justify-center font-medium', index === currentWeekday && 'text-brand')}>
								{label}
							</li>
						))}

						{new Array(firstDayWeekday).fill(0).map((_, index) => (
							<li key={`empty-${index}`} />
						))}

						{new Array(daysInMonth).fill(0).map((_, index) => {
							const day = index + 1
							const isToday = day === currentDate
							return (
								<li key={day} className={cn('flex h-5 items-center justify-center rounded-lg', isToday && 'bg-linear border font-medium')}>
									{day}
								</li>
							)
						})}
					</ul>

					<div className='mt-auto flex items-center justify-between gap-3 border-t pt-3'>
						<div className='text-secondary text-xs'>
							本周从 {weekStart.format('M/D')} 到 {weekStart.add(6, 'day').format('M/D')}
						</div>
						<div className='text-brand shrink-0 text-xs'>农历 / 节气</div>
					</div>
				</button>
			</Card>
		</HomeDraggableLayer>
	)
}
