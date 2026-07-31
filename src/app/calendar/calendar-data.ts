import dayjs, { type Dayjs } from 'dayjs'
import { getCalendarFestival, getHolidayStatus, type CalendarFestival } from '@/lib/calendar/festivals'

export const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']

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

const lunarDayFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
	month: 'long',
	day: 'numeric'
})

const chineseMonths = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

export type CalendarDayModel = {
	date: Dayjs
	key: string
	day: number
	lunarLabel: string
	lunarFullLabel: string
	festival: CalendarFestival | null
	solarTerm: string
	holidayStatus: string
	isAdjacent: boolean
	isToday: boolean
	isWeekend: boolean
}

export type SolarTerm = {
	name: string
	date: Dayjs
}

export type SolarTermContext = {
	terms: SolarTerm[]
	activeIndex: number
	current: SolarTerm
	next: SolarTerm
	progress: number
	daysToNext: number
	phrase: string
}

export function toDateKey(date: Dayjs) {
	return date.format('YYYY-MM-DD')
}

export function getChineseMonth(month: number) {
	return chineseMonths[month]
}

function getLunarLabels(date: Date) {
	const parts = lunarDayFormatter.formatToParts(date)
	const month = parts.find(part => part.type === 'month')?.value || ''
	const day = parts.find(part => part.type === 'day')?.value || ''

	return {
		short: day === '初一' ? month : day,
		full: `${month}${day}`
	}
}

export function getCalendarDays(viewMonth: Dayjs, today: Dayjs): CalendarDayModel[] {
	const monthStart = viewMonth.startOf('month')
	const firstDayOffset = (monthStart.day() + 6) % 7
	const gridStart = monthStart.subtract(firstDayOffset, 'day')
	const solarTermByDate = new Map(
		[viewMonth.year() - 1, viewMonth.year(), viewMonth.year() + 1].flatMap(buildSolarTerms).map(term => [toDateKey(term.date), term.name])
	)

	return Array.from({ length: 42 }, (_, index) => {
		const date = gridStart.add(index, 'day')
		const lunar = getLunarLabels(date.toDate())

		return {
			date,
			key: toDateKey(date),
			day: date.date(),
			lunarLabel: lunar.short,
			lunarFullLabel: lunar.full,
			festival: getCalendarFestival(date.toDate()),
			solarTerm: solarTermByDate.get(toDateKey(date)) || '',
			holidayStatus: getHolidayStatus(date.toDate()),
			isAdjacent: !date.isSame(monthStart, 'month'),
			isToday: date.isSame(today, 'day'),
			isWeekend: [0, 6].includes(date.day())
		}
	})
}

export function buildSolarTerms(year: number): SolarTerm[] {
	const baseUtc = Date.UTC(1900, 0, 6, 2, 5)

	return solarTermNames.map((name, index) => ({
		name,
		date: dayjs(31556925974.7 * (year - 1900) + solarTermInfo[index] * 60000 + baseUtc)
	}))
}

function getSeasonPhrase(termName: string) {
	if (termName === '大暑') return '暑气至盛，秋意将生'
	const index = solarTermNames.indexOf(termName)
	if (index >= 2 && index <= 7) return '风物舒展，春意渐深'
	if (index >= 8 && index <= 13) return '日光丰盛，万物长成'
	if (index >= 14 && index <= 19) return '暑意渐退，秋色初生'
	return '天地收藏，静候新生'
}

export function getSolarTermContext(date: Dayjs): SolarTermContext {
	const selectedDay = date.startOf('day')
	const terms = [date.year() - 1, date.year(), date.year() + 1]
		.flatMap(buildSolarTerms)
		.sort((a, b) => a.date.valueOf() - b.date.valueOf())
	let currentIndex = 0

	for (let index = 0; index < terms.length; index += 1) {
		if (terms[index].date.startOf('day').isAfter(selectedDay)) break
		currentIndex = index
	}

	const current = terms[currentIndex]
	const next = terms[currentIndex + 1]
	const windowStart = Math.max(0, Math.min(currentIndex - 1, terms.length - 4))
	const windowTerms = terms.slice(windowStart, windowStart + 4)
	const interval = Math.max(next.date.valueOf() - current.date.valueOf(), 1)
	const elapsed = Math.min(Math.max(date.valueOf() - current.date.valueOf(), 0), interval)

	return {
		terms: windowTerms,
		activeIndex: currentIndex - windowStart,
		current,
		next,
		progress: elapsed / interval,
		daysToNext: Math.max(0, next.date.startOf('day').diff(selectedDay, 'day')),
		phrase: getSeasonPhrase(current.name)
	}
}

export function getYearProgress(date: Dayjs) {
	const year = date.year()
	const totalDays = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 366 : 365
	const dayOfYear = date.diff(date.startOf('year'), 'day') + 1

	return {
		dayOfYear,
		totalDays,
		progress: dayOfYear / totalDays
	}
}
