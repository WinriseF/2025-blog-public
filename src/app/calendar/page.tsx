'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ChevronLeft, Orbit, Sparkles } from 'lucide-react'
import { HolidayUtil, Solar } from 'lunar-typescript'
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

const compactFestivalNames: Record<string, string> = {
	国际劳动妇女节: '妇女节',
	中国植树节: '植树节',
	劳动节: '劳动节',
	青年节: '青年节',
	儿童节: '儿童节',
	中国共产党诞辰纪念日: '建党节',
	中国人民解放军建军节: '建军节',
	教师节: '教师节',
	国庆节: '国庆节',
	圣诞节: '圣诞节',
	情人节: '情人节',
	母亲节: '母亲节',
	父亲节: '父亲节',
	春节: '春节',
	元宵节: '元宵',
	端午节: '端午',
	七夕节: '七夕',
	中秋节: '中秋',
	重阳节: '重阳',
	腊八节: '腊八',
	除夕: '除夕'
}

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

function getFestivalLabel(date: Date) {
	const solar = Solar.fromDate(date)
	const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay())

	if (holiday && !holiday.isWork() && holiday.getDay() === holiday.getTarget()) {
		const holidayName = holiday.getName()
		return compactFestivalNames[holidayName] || holidayName
	}

	const festival = [...solar.getFestivals(), ...solar.getLunar().getFestivals()].find(name => compactFestivalNames[name])
	return festival ? compactFestivalNames[festival] : ''
}

function getHolidayStatus(date: Date) {
	const solar = Solar.fromDate(date)
	const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay())

	if (!holiday) return ''
	return holiday.isWork() ? '班' : '休'
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
	const todayFestival = getFestivalLabel(now.toDate())
	const summaryItems = [
		{ label: '农历', value: almanac.lunarDate },
		{ label: '节日', value: todayFestival || '无' },
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
								const festivalLabel = getFestivalLabel(date.toDate())
								const holidayStatus = getHolidayStatus(date.toDate())
								const secondaryLabel = festivalLabel || getLunarDayLabel(date.toDate())

								return (
									<motion.div
										key={day}
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}
										transition={{ delay: day * 0.01 }}
										className={cn(
											'relative h-20 rounded-3xl border p-3 transition-all max-sm:h-16 max-sm:rounded-2xl max-sm:p-2',
											isCurrent
												? 'bg-linear border-transparent text-white shadow-[0_18px_30px_-22px_var(--color-brand)]'
												: holidayStatus === '休'
													? 'border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 hover:bg-[var(--color-brand)]/15'
													: 'bg-white/35 hover:bg-white/55',
											isWeekend && !isCurrent && 'text-brand'
										)}>
										{holidayStatus ? (
											<span
												className={cn(
													'absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium',
													isCurrent ? 'bg-white/25 text-white' : holidayStatus === '休' ? 'bg-[var(--color-brand)]/12 text-brand' : 'bg-secondary/10 text-secondary'
												)}>
												{holidayStatus}
											</span>
										) : (
											isCurrent && <span className='absolute top-3 right-3 h-1.5 w-1.5 rounded-full bg-white/80' />
										)}
										<div className={cn('text-lg leading-none font-semibold max-sm:text-base', !isCurrent && 'text-primary')}>{day}</div>
										<div
											className={cn(
												'mt-6 whitespace-nowrap text-xs leading-none max-sm:mt-4',
												isCurrent ? 'text-white/85' : festivalLabel ? 'text-brand font-medium' : 'text-secondary'
											)}>
											{secondaryLabel}
										</div>
									</motion.div>
								)
							})}
						</div>

						<div className='mt-6 grid gap-4 border-t pt-5 lg:grid-cols-[0.85fr_1.3fr_1fr]'>
							<div className='relative overflow-hidden rounded-[34px] border bg-[linear-gradient(160deg,rgba(255,255,255,0.58),rgba(255,255,255,0.18))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] max-sm:rounded-[28px]'>
								<div className='absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-[var(--color-brand)]/10 blur-2xl' />
								<div className='relative text-secondary text-xs'>{now.format('YYYY/M/D ddd')}</div>
								<div className='relative mt-8 flex items-end gap-4 max-sm:mt-5'>
									<div className='text-[5rem] leading-[0.78] font-semibold tracking-normal text-primary max-sm:text-6xl'>{now.format('D')}</div>
									<div className='pb-1.5'>
										<div className='text-2xl leading-tight font-medium max-sm:text-xl'>{almanac.lunarDate}</div>
										<div className='text-secondary mt-2 text-sm'>
											{almanac.ganzhiYear}年 {almanac.shengXiao}
										</div>
									</div>
								</div>
								<div className='relative mt-8 rounded-2xl border bg-white/25 px-4 py-3 text-sm text-secondary max-sm:mt-5'>
									{almanac.ganzhiMonth}月 · {almanac.ganzhiDay}日
								</div>
							</div>

							<div className='grid gap-4'>
								<div className='rounded-[30px] border bg-[linear-gradient(145deg,rgba(255,255,255,0.62),rgba(255,255,255,0.24))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] max-sm:rounded-[26px] max-sm:p-4'>
									<div className='mb-4 flex items-center gap-3 text-base font-medium'>
										<span className='bg-linear flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm text-white shadow-[0_12px_24px_-18px_var(--color-brand)]'>宜</span>
										<span>今日宜</span>
									</div>
									<div className='flex flex-wrap gap-2.5'>
										{almanac.yi.map(item => (
											<span key={item} className='rounded-full border border-[var(--color-brand)]/20 bg-[var(--color-brand)]/8 px-3.5 py-1.5 text-xs font-medium text-primary'>
												{item}
											</span>
										))}
									</div>
								</div>

								<div className='rounded-[30px] border bg-white/20 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] max-sm:rounded-[26px] max-sm:p-4'>
									<div className='mb-4 flex items-center gap-3 text-base font-medium'>
										<span className='text-secondary flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white/35 text-sm'>忌</span>
										<span>今日忌</span>
									</div>
									<div className='flex flex-wrap gap-2.5'>
										{almanac.ji.map(item => (
											<span key={item} className='text-secondary rounded-full border bg-white/25 px-3.5 py-1.5 text-xs'>
												{item}
											</span>
										))}
									</div>
								</div>
							</div>

							<div className='grid gap-3'>
								{[
									{ label: '冲煞', value: `${almanac.chong} · 煞${almanac.sha}` },
									{ label: '星宿', value: `${almanac.xiu}宿 · ${almanac.xiuLuck}` },
									{ label: '纳音', value: almanac.naYin },
									{ label: '节气', value: `${almanac.prevJieQi.name}后 · ${almanac.nextJieQi.name}前` }
								].map((item, index) => (
									<div
										key={item.label}
										className='group relative overflow-hidden rounded-[24px] border bg-white/22 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors hover:bg-white/35'>
										<div className='absolute inset-y-4 left-0 w-1 rounded-r-full bg-[var(--color-brand)]/35 opacity-70 group-hover:opacity-100' />
										<div className='text-secondary text-[11px]'>{item.label}</div>
										<div className='mt-1.5 text-base leading-snug font-medium max-sm:text-sm'>{item.value}</div>
										<div className='absolute top-3 right-3 text-[10px] text-secondary/40'>{String(index + 1).padStart(2, '0')}</div>
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
