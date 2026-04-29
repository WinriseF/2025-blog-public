'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ChevronLeft, Orbit, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAlmanacDay } from '@/lib/calendar/almanac'

dayjs.locale('zh-cn')

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
const solarTermNames = [
	'小寒',
	'大寒',
	'立春',
	'雨水',
	'惊蛰',
	'春分',
	'清明',
	'谷雨',
	'立夏',
	'小满',
	'芒种',
	'夏至',
	'小暑',
	'大暑',
	'立秋',
	'处暑',
	'白露',
	'秋分',
	'寒露',
	'霜降',
	'立冬',
	'小雪',
	'大雪',
	'冬至'
]
const solarTermInfo = [
	0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795,
	462224, 483532, 504758
]

const lunarFullFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
	year: 'numeric',
	month: 'long',
	day: 'numeric'
})

const lunarDayFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
	month: 'long',
	day: 'numeric'
})

function getWeekStartMonday(date: dayjs.Dayjs) {
	const weekday = (date.day() + 6) % 7
	return date.subtract(weekday, 'day')
}

function getLunarDayLabel(date: Date) {
	const parts = lunarDayFormatter.formatToParts(date)
	const month = parts.find(part => part.type === 'month')?.value || ''
	const day = parts.find(part => part.type === 'day')?.value || ''
	return day === '初一' ? month : day
}

function buildSolarTerms(year: number) {
	const baseUtc = Date.UTC(1900, 0, 6, 2, 5)
	return solarTermNames.map((name, index) => {
		const utc = 31556925974.7 * (year - 1900) + solarTermInfo[index] * 60000 + baseUtc
		return {
			name,
			date: dayjs(utc)
		}
	})
}

function isLeapYear(year: number) {
	return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
}

export default function CalendarPage() {
	const now = dayjs()
	const year = now.year()
	const currentDate = now.date()
	const daysInMonth = now.daysInMonth()
	const firstDayWeekday = (now.startOf('month').day() + 6) % 7
	const monthCells = [...new Array(firstDayWeekday).fill(null), ...new Array(daysInMonth).fill(0).map((_, index) => index + 1)]
	const weekStart = getWeekStartMonday(now)
	const lunarToday = lunarFullFormatter.format(now.toDate()).replace(/\s+/g, '')
	const almanac = getAlmanacDay(now.toDate())
	const solarTerms = buildSolarTerms(year)
	const allSolarTerms = [...solarTerms, ...buildSolarTerms(year + 1)]
	const nextSolarTerm = allSolarTerms.find(term => term.date.isAfter(now, 'day')) || allSolarTerms[0]
	const upcomingTerms = allSolarTerms.filter(term => term.date.isAfter(now.subtract(1, 'day'))).slice(0, 5)
	const termPairs = solarTerms.filter(term => term.date.month() === now.month()).slice(0, 2)
	const dayOfYear = now.diff(now.startOf('year'), 'day') + 1
	const thisWeek = new Array(7).fill(0).map((_, index) => weekStart.add(index, 'day'))
	const summaryItems = [
		{ label: '农历', value: almanac.lunarDate },
		{ label: '年进度', value: `${dayOfYear} / ${isLeapYear(year) ? 366 : 365}` },
		{ label: '月余', value: `${daysInMonth - currentDate} 天` },
		{ label: '周段', value: `${weekStart.format('M/D')} - ${weekStart.add(6, 'day').format('M/D')}` }
	]

	return (
		<div className='px-6 pt-28 pb-16 max-sm:px-4 max-sm:pt-24'>
			<div className='mx-auto max-w-[920px]'>
				<motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className='flex items-end justify-between gap-6 max-sm:items-start'>
					<div>
						<Link href='/' className='text-secondary hover:text-brand inline-flex items-center gap-1 text-sm transition-colors'>
							<ChevronLeft className='h-4 w-4' />
							返回首页
						</Link>
						<h1 className='mt-5 text-4xl font-semibold max-sm:text-3xl'>{now.format('YYYY 年 M 月')}</h1>
						<div className='text-secondary mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm'>
							<span>{now.format('M 月 D 日')}</span>
							<span className='bg-secondary/40 h-1 w-1 rounded-full' />
							<span>{now.format('dddd')}</span>
							<span className='bg-secondary/40 h-1 w-1 rounded-full' />
							<span>{lunarToday}</span>
						</div>
					</div>

					<div className='bg-linear flex h-24 w-24 shrink-0 flex-col justify-center rounded-[28px] px-5 text-white shadow-[0_18px_42px_-24px_var(--color-brand)] max-sm:h-20 max-sm:w-20 max-sm:rounded-[24px] max-sm:px-4'>
						<div className='text-3xl leading-none font-semibold max-sm:text-2xl'>{now.format('D')}</div>
						<div className='mt-3 text-xs text-white/80'>{getLunarDayLabel(now.toDate())}</div>
					</div>
				</motion.header>

				<div className='mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.8fr]'>
					<motion.section
						initial={{ opacity: 0, y: 18 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.04 }}
						className='bg-card rounded-[40px] border p-6 shadow backdrop-blur-md max-sm:rounded-[32px] max-sm:p-4'>
						<div className='grid grid-cols-7 gap-2 max-sm:gap-1.5'>
							{weekdayLabels.map((label, index) => {
								const isCurrentWeekday = index === (now.day() + 6) % 7
								return (
									<div key={label} className={cn('py-1 text-center text-xs font-medium', isCurrentWeekday ? 'text-brand' : 'text-secondary')}>
										{label}
									</div>
								)
							})}

							{monthCells.map((day, index) => {
								if (!day) return <div key={`empty-${index}`} className='h-20 rounded-3xl max-sm:h-16' />
								const date = now.date(day)
								const isCurrent = day === currentDate
								const isWeekend = [5, 6].includes((date.day() + 6) % 7)

								return (
									<motion.div
										key={day}
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}
										transition={{ delay: day * 0.01 }}
										className={cn(
											'relative h-20 rounded-3xl border p-3 transition-all max-sm:h-16 max-sm:rounded-2xl max-sm:p-2',
											isCurrent ? 'bg-linear border-transparent text-white shadow-[0_18px_30px_-22px_var(--color-brand)]' : 'bg-white/35 hover:bg-white/55',
											isWeekend && !isCurrent && 'text-brand'
										)}>
										{isCurrent && <span className='absolute top-3 right-3 h-1.5 w-1.5 rounded-full bg-white/80' />}
										<div className={cn('text-lg leading-none font-semibold max-sm:text-base', !isCurrent && 'text-primary')}>{day}</div>
										<div className={cn('mt-6 truncate text-xs max-sm:mt-4', isCurrent ? 'text-white/85' : 'text-secondary')}>
											{getLunarDayLabel(date.toDate())}
										</div>
									</motion.div>
								)
							})}
						</div>

						<div className='mt-6 grid gap-4 border-t pt-5 lg:grid-cols-[0.8fr_1.2fr_0.9fr]'>
							<div className='rounded-[30px] border bg-white/30 p-4'>
								<div className='text-secondary text-xs'>{now.format('YYYY/M/D ddd')}</div>
								<div className='mt-3 flex items-end gap-3'>
									<div className='text-6xl leading-none font-semibold tracking-normal max-sm:text-5xl'>{now.format('D')}</div>
									<div className='pb-1'>
										<div className='text-base font-medium'>{almanac.lunarDate}</div>
										<div className='text-secondary mt-1 text-xs'>
											{almanac.ganzhiYear}年 {almanac.shengXiao}
										</div>
									</div>
								</div>
								<div className='text-secondary mt-4 text-xs leading-5'>
									{almanac.ganzhiMonth}月 · {almanac.ganzhiDay}日
								</div>
							</div>

							<div className='grid gap-3'>
								<div className='rounded-[26px] border bg-white/25 p-3'>
									<div className='mb-2 flex items-center gap-2 text-sm font-medium'>
										<span className='bg-linear flex h-6 w-6 items-center justify-center rounded-full text-xs'>宜</span>
										<span>今日宜</span>
									</div>
									<div className='flex flex-wrap gap-2'>
										{almanac.yi.map(item => (
											<span key={item} className='rounded-full border bg-white/35 px-3 py-1 text-xs'>
												{item}
											</span>
										))}
									</div>
								</div>

								<div className='rounded-[26px] border bg-white/20 p-3'>
									<div className='mb-2 flex items-center gap-2 text-sm font-medium'>
										<span className='text-secondary flex h-6 w-6 items-center justify-center rounded-full border bg-white/35 text-xs'>忌</span>
										<span>今日忌</span>
									</div>
									<div className='flex flex-wrap gap-2'>
										{almanac.ji.map(item => (
											<span key={item} className='text-secondary rounded-full border bg-white/25 px-3 py-1 text-xs'>
												{item}
											</span>
										))}
									</div>
								</div>
							</div>

							<div className='grid grid-cols-2 gap-3 lg:grid-cols-1'>
								{[
									{ label: '冲煞', value: `${almanac.chong} · 煞${almanac.sha}` },
									{ label: '星宿', value: `${almanac.xiu}宿 · ${almanac.xiuLuck}` },
									{ label: '纳音', value: almanac.naYin },
									{ label: '节气', value: `${almanac.prevJieQi.name}后 · ${almanac.nextJieQi.name}前` }
								].map(item => (
									<div key={item.label} className='rounded-2xl border bg-white/25 px-3 py-2.5'>
										<div className='text-secondary text-[11px]'>{item.label}</div>
										<div className='mt-1 text-sm font-medium'>{item.value}</div>
									</div>
								))}
							</div>
						</div>
					</motion.section>

					<div className='space-y-6'>
						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.08 }}
							className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
							<div className='mb-4 flex items-center gap-2'>
								<Orbit className='text-brand h-4 w-4' />
								<h2 className='text-sm font-medium'>本月节气</h2>
							</div>
							<div className='space-y-3'>
								{termPairs.map(term => (
									<div key={term.name} className='rounded-2xl border bg-white/25 p-3'>
										<div className='flex items-center justify-between gap-3'>
											<div className='text-sm font-medium'>{term.name}</div>
											<div className='text-secondary text-xs'>{term.date.format('M月D日')}</div>
										</div>
										<div className='text-secondary mt-2 text-xs'>{term.date.format('dddd')}</div>
									</div>
								))}
							</div>
						</motion.section>

						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.12 }}
							className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
							<div className='mb-4 flex items-center gap-2'>
								<Sparkles className='text-brand h-4 w-4' />
								<h2 className='text-sm font-medium'>后续节气</h2>
							</div>
							<div className='space-y-2.5'>
								{upcomingTerms.map((term, index) => (
									<div key={`${term.name}-${index}`} className='flex items-center justify-between rounded-2xl border bg-white/25 px-3 py-2.5'>
										<div>
											<div className='text-sm font-medium'>{term.name}</div>
											<div className='text-secondary text-xs'>{term.date.format('M月D日 ddd')}</div>
										</div>
										<div className='text-secondary text-xs'>{term.date.diff(now.startOf('day'), 'day')} 天</div>
									</div>
								))}
							</div>
						</motion.section>

						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.16 }}
							className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
							<div className='grid grid-cols-2 gap-3'>
								{summaryItems.map(item => (
									<div key={item.label} className='rounded-2xl border bg-white/25 px-3 py-2.5'>
										<div className='text-secondary text-[11px]'>{item.label}</div>
										<div className='mt-1 text-sm font-medium'>{item.value}</div>
									</div>
								))}
							</div>
						</motion.section>
					</div>
				</div>

				<motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className='mt-6 grid gap-3 md:grid-cols-7'>
					{thisWeek.map(date => {
						const isCurrent = date.isSame(now, 'day')
						return (
							<div key={date.toString()} className={cn('rounded-3xl border bg-white/25 p-4', isCurrent && 'bg-white/65 ring-1 ring-[var(--color-brand)]')}>
								<div className='text-sm font-medium'>{date.format('M/D')}</div>
								<div className='text-secondary mt-1 text-xs'>{date.format('ddd')}</div>
								<div className={cn('mt-4 h-1.5 w-1.5 rounded-full', isCurrent ? 'bg-linear' : 'bg-secondary/20')} />
							</div>
						)
					})}
				</motion.section>
			</div>
		</div>
	)
}
