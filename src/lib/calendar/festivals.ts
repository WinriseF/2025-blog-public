import { HolidayUtil, Solar } from 'lunar-typescript'

export type CalendarFestivalType = 'solar' | 'lunar' | 'holiday'

export type CalendarFestival = {
	label: string
	type: CalendarFestivalType
}

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

const lunarFestivalNames = new Set(['春节', '元宵节', '端午节', '七夕节', '中秋节', '重阳节', '腊八节', '除夕'])

function compactName(name: string) {
	return compactFestivalNames[name] || ''
}

export function getCalendarFestival(date: Date): CalendarFestival | null {
	const solar = Solar.fromDate(date)
	const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay())

	if (holiday && !holiday.isWork() && holiday.getDay() === holiday.getTarget()) {
		const holidayName = holiday.getName()
		return {
			label: compactName(holidayName) || holidayName,
			type: lunarFestivalNames.has(holidayName) ? 'lunar' : 'holiday'
		}
	}

	const solarFestival = solar.getFestivals().find(name => compactFestivalNames[name])
	if (solarFestival) {
		return {
			label: compactName(solarFestival),
			type: 'solar'
		}
	}

	const lunarFestival = solar.getLunar().getFestivals().find(name => compactFestivalNames[name])
	if (lunarFestival) {
		return {
			label: compactName(lunarFestival),
			type: 'lunar'
		}
	}

	return null
}

export function getHolidayStatus(date: Date) {
	const solar = Solar.fromDate(date)
	const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay())

	if (!holiday) return ''
	return holiday.isWork() ? '班' : '休'
}

export function isHolidayOffDay(date: Date) {
	const solar = Solar.fromDate(date)
	const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay())

	return Boolean(holiday && !holiday.isWork())
}
