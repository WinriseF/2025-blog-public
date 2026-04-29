'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { CalendarDays, ChevronLeft, Moon, Orbit, Sparkles, SunMedium } from 'lucide-react'
import { cn } from '@/lib/utils'

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
		const date = dayjs(utc)
		return {
			name,
			date
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
	const firstDayOfMonth = now.startOf('month')
	const firstDayWeekday = (firstDayOfMonth.day() + 6) % 7
	const monthCells = [...new Array(firstDayWeekday).fill(null), ...new Array(daysInMonth).fill(0).map((_, index) => index + 1)]
	const weekStart = getWeekStartMonday(now)
	const lunarToday = lunarFullFormatter.format(now.toDate()).replace(/\s+/g, '')
	const solarTerms = buildSolarTerms(year)
	const allSolarTerms = [...solarTerms, ...buildSolarTerms(year + 1)]
	const nextSolarTerm = allSolarTerms.find(term => term.date.isAfter(now, 'day')) || allSolarTerms[0]
	const upcomingTerms = allSolarTerms.filter(term => term.date.isAfter(now.subtract(1, 'day'))).slice(0, 6)
	const termPairs = solarTerms.filter(term => term.date.month() === now.month()).slice(0, 2)
	const dayOfYear = now.diff(now.startOf('year'), 'day') + 1
	const monthProgress = Math.round((currentDate / daysInMonth) * 100)
	const thisWeek = new Array(7).fill(0).map((_, index) => weekStart.add(index, 'day'))
	const summaryItems = [
		{ label: '农历', value: lunarToday },
		{ label: '年进度', value: `${dayOfYear} / ${isLeapYear(year) ? 366 : 365}` },
		{ label: '月余', value: `${daysInMonth - currentDate} 天` },
		{ label: '周段', value: `${weekStart.format('M/D')} - ${weekStart.add(6, 'day').format('M/D')}` }
	]

	return (
		<div className='px-6 pt-28 pb-16 max-sm:px-4 max-sm:pt-24'>
			<div className='mx-auto max-w-[980px]'>
				<motion.header
					initial={{ opacity: 0, scale: 0.96, y: 14 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					className='bg-card rounded-[40px] border p-6 shadow backdrop-blur-md max-sm:rounded-[32px]'>
					<div className='relative flex items-start justify-between gap-8 max-md:flex-col'>
						<div>
							<Link href='/' className='text-secondary hover:text-brand inline-flex items-center gap-1 text-sm transition-colors'>
								<ChevronLeft className='h-4 w-4' />
								返回首页
							</Link>
							<h1 className='mt-5 text-4xl font-semibold max-sm:text-3xl'>{now.format('YYYY 年 M 月')}</h1>
							<div className='text-secondary mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm'>
								<span>{now.format('dddd')}</span>
								<span className='bg-secondary/40 h-1 w-1 rounded-full' />
								<span>{lunarToday}</span>
								<span className='bg-secondary/40 h-1 w-1 rounded-full' />
								<span>本年第 {dayOfYear} 天</span>
							</div>
						</div>

						<div className='min-w-[170px] rounded-[28px] border bg-white/40 px-5 py-4 text-right backdrop-blur max-md:w-full max-md:text-left'>
							<div className='text-secondary text-xs'>今天</div>
							<div className='mt-2 text-5xl leading-none font-semibold max-sm:text-4xl'>{now.format('D')}</div>
							<div className='text-secondary mt-3 text-sm'>{now.format('M 月 D 日')}</div>
						</div>
					</div>
				</motion.header>

				<div className='mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.8fr]'>
					<div className='space-y-6'>
						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.04 }}
							className='bg-card rounded-[40px] border p-6 shadow backdrop-blur-md max-sm:rounded-[32px] max-sm:p-4'>
							<div className='flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start'>
								<h2 className='text-base font-medium'>月历</h2>
								<div className='flex flex-wrap gap-2'>
									{[`${monthProgress}% 月进度`, `${weekStart.format('M/D')} - ${weekStart.add(6, 'day').format('M/D')} 本周`].map(chip => (
										<span key={chip} className='text-secondary rounded-full border bg-white/35 px-3 py-1 text-xs'>
											{chip}
										</span>
									))}
								</div>
							</div>

							<div className='mt-6 grid grid-cols-7 gap-2 max-sm:gap-1.5'>
								{weekdayLabels.map(label => (
									<div key={label} className='text-secondary py-1 text-center text-xs font-medium'>
										{label}
									</div>
								))}
								{monthCells.map((day, index) => {
									if (!day) return <div key={`empty-${index}`} className='h-20 rounded-3xl max-sm:h-16' />
									const date = now.date(day)
									const isToday = day === currentDate
									const isWeekend = [5, 6].includes((date.day() + 6) % 7)
									return (
										<motion.div
											key={day}
											initial={{ opacity: 0, y: 8 }}
											animate={{ opacity: 1, y: 0 }}
											transition={{ delay: day * 0.012 }}
											className={cn(
												'group h-20 rounded-3xl border p-3 transition-all max-sm:h-16 max-sm:rounded-2xl max-sm:p-2',
												isToday ? 'bg-linear border-transparent shadow-[0_18px_30px_-22px_var(--color-brand)]' : 'bg-white/35 hover:bg-white/55',
												isWeekend && !isToday && 'text-brand'
											)}>
											<div className='flex items-start justify-between gap-2'>
												<span className={cn('text-lg leading-none font-semibold max-sm:text-base', !isToday && 'text-primary')}>{day}</span>
												{isToday && <span className='rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium'>今天</span>}
											</div>
											<div className={cn('mt-6 truncate text-xs max-sm:mt-4', isToday ? 'text-white/85' : 'text-secondary')}>
												{getLunarDayLabel(date.toDate())}
											</div>
										</motion.div>
									)
								})}
							</div>
						</motion.section>

						<motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className='grid gap-6 md:grid-cols-2'>
							<div className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
								<div className='mb-4 flex items-center gap-2'>
									<CalendarDays className='text-brand h-4 w-4' />
									<h2 className='text-sm font-medium'>本周日期</h2>
								</div>
								<div className='space-y-2.5'>
									{thisWeek.map(date => {
										const isToday = date.isSame(now, 'day')
										return (
											<div
												key={date.toString()}
												className={cn('flex items-center justify-between rounded-2xl border px-3 py-2.5', isToday ? 'bg-white/65' : 'bg-white/25')}>
												<div>
													<div className='text-sm font-medium'>{date.format('M 月 D 日')}</div>
													<div className='text-secondary text-xs'>{date.format('dddd')}</div>
												</div>
												<div className={cn('rounded-full px-2.5 py-1 text-xs', isToday ? 'bg-linear text-white' : 'bg-secondary/10 text-secondary')}>
													{isToday ? '今天' : getLunarDayLabel(date.toDate())}
												</div>
											</div>
										)
									})}
								</div>
							</div>

							<div className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
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
											<div className='text-secondary mt-2 text-xs'>{term.date.format('dddd')} · 节令切换点</div>
										</div>
									))}
									{termPairs.length === 0 && <div className='text-secondary rounded-2xl bg-white/35 px-3 py-3 text-sm'>本月没有可用节气信息。</div>}
								</div>
							</div>
						</motion.section>
					</div>

					<div className='space-y-6'>
						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
							className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
							<div className='mb-4 flex items-center gap-2'>
								<SunMedium className='text-brand h-4 w-4' />
								<h2 className='text-sm font-medium'>下一节气</h2>
							</div>
							<div className='rounded-[28px] border bg-white/35 p-4'>
								<div className='text-secondary text-xs'>即将到来</div>
								<div className='mt-3 text-2xl font-semibold'>{nextSolarTerm.name}</div>
								<div className='text-secondary mt-2 text-sm'>{nextSolarTerm.date.format('YYYY 年 M 月 D 日 dddd')}</div>
								<div className='text-secondary mt-4 text-xs'>距离今天 {nextSolarTerm.date.startOf('day').diff(now.startOf('day'), 'day')} 天</div>
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
									<motion.div
										key={term.name}
										initial={{ opacity: 0, x: 10 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: 0.16 + index * 0.03 }}
										className='flex items-center justify-between rounded-2xl border bg-white/25 px-3 py-2.5'>
										<div>
											<div className='text-sm font-medium'>{term.name}</div>
											<div className='text-secondary text-xs'>{term.date.format('M月D日 ddd')}</div>
										</div>
										<div className='text-secondary text-xs'>{term.date.diff(now.startOf('day'), 'day')} 天后</div>
									</motion.div>
								))}
							</div>
						</motion.section>

						<motion.section
							initial={{ opacity: 0, y: 18 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.16 }}
							className='bg-card rounded-[36px] border p-5 shadow backdrop-blur-md'>
							<div className='mb-4 flex items-center gap-2'>
								<Moon className='text-brand h-4 w-4' />
								<h2 className='text-sm font-medium'>日期信息</h2>
							</div>
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
			</div>
		</div>
	)
}
