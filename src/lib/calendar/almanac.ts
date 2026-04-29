import { Solar } from 'lunar-typescript'

type SolarDateLike = {
	getYear: () => number
	getMonth: () => number
	getDay: () => number
	getWeekInChinese: () => string
	toYmd: () => string
}

type JieQiLike = {
	getName: () => string
	getSolar: () => SolarDateLike
}

export type AlmanacDay = {
	lunarDate: string
	ganzhiYear: string
	ganzhiMonth: string
	ganzhiDay: string
	shengXiao: string
	yi: string[]
	ji: string[]
	pengZu: string[]
	chong: string
	sha: string
	naYin: string
	xiu: string
	xiuLuck: string
	nextJieQi: {
		name: string
		date: string
		weekday: string
		daysAway: number
	}
	prevJieQi: {
		name: string
		date: string
		weekday: string
		daysAway: number
	}
}

function toJieQiInfo(jieQi: JieQiLike, currentDate: Date) {
	const solar = jieQi.getSolar()
	const target = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay())
	const current = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())

	return {
		name: jieQi.getName(),
		date: `${solar.getMonth()}月${solar.getDay()}日`,
		weekday: `周${solar.getWeekInChinese()}`,
		daysAway: Math.round((target.getTime() - current.getTime()) / 86400000)
	}
}

export function getAlmanacDay(date: Date): AlmanacDay {
	const solar = Solar.fromDate(date)
	const lunar = solar.getLunar()
	const nextJieQi = lunar.getNextJieQi() as JieQiLike
	const prevJieQi = lunar.getPrevJieQi() as JieQiLike

	return {
		lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
		ganzhiYear: lunar.getYearInGanZhi(),
		ganzhiMonth: lunar.getMonthInGanZhi(),
		ganzhiDay: lunar.getDayInGanZhi(),
		shengXiao: lunar.getYearShengXiao(),
		yi: lunar.getDayYi().slice(0, 5),
		ji: lunar.getDayJi().slice(0, 4),
		pengZu: [lunar.getPengZuGan(), lunar.getPengZuZhi()].filter(Boolean),
		chong: lunar.getDayChongDesc(),
		sha: lunar.getDaySha(),
		naYin: lunar.getDayNaYin(),
		xiu: lunar.getXiu(),
		xiuLuck: lunar.getXiuLuck(),
		nextJieQi: toJieQiInfo(nextJieQi, date),
		prevJieQi: toJieQiInfo(prevJieQi, date)
	}
}
