import { Solar } from 'lunar-typescript'
import { getSubsolarPoint, type Coordinates } from './solar'

export type SolarTermKind = 'cardinal' | 'season-start' | 'minor'

export interface SolarTermPoint extends Coordinates {
	name: string
	date: Date
	sampleDate: Date
	kind: SolarTermKind
	index: number
}

type SolarLike = {
	getYear: () => number
	getMonth: () => number
	getDay: () => number
	getHour: () => number
	getMinute: () => number
	getSecond: () => number
}

const SOLAR_TERM_DEFS = [
	{ name: '小寒', key: 'XIAO_HAN' },
	{ name: '大寒', key: 'DA_HAN' },
	{ name: '立春', key: 'LI_CHUN' },
	{ name: '雨水', key: 'YU_SHUI' },
	{ name: '惊蛰', key: 'JING_ZHE' },
	{ name: '春分', key: 'CHUN_FEN' },
	{ name: '清明', key: 'QING_MING' },
	{ name: '谷雨', key: 'GU_YU' },
	{ name: '立夏', key: 'LI_XIA' },
	{ name: '小满', key: 'XIAO_MAN' },
	{ name: '芒种', key: 'MANG_ZHONG' },
	{ name: '夏至', key: 'XIA_ZHI' },
	{ name: '小暑', key: 'XIAO_SHU' },
	{ name: '大暑', key: 'DA_SHU' },
	{ name: '立秋', key: 'LI_QIU' },
	{ name: '处暑', key: 'CHU_SHU' },
	{ name: '白露', key: 'BAI_LU' },
	{ name: '秋分', key: 'QIU_FEN' },
	{ name: '寒露', key: 'HAN_LU' },
	{ name: '霜降', key: 'SHUANG_JIANG' },
	{ name: '立冬', key: 'LI_DONG' },
	{ name: '小雪', key: 'XIAO_XUE' },
	{ name: '大雪', key: 'DA_XUE' },
	{ name: '冬至', key: 'DONG_ZHI' }
] as const

const cardinalTerms = new Set(['春分', '夏至', '秋分', '冬至'])
const seasonStartTerms = new Set(['立春', '立夏', '立秋', '立冬'])

function getSolarTermKind(name: string): SolarTermKind {
	if (cardinalTerms.has(name)) return 'cardinal'
	if (seasonStartTerms.has(name)) return 'season-start'
	return 'minor'
}

function solarToUtcDate(solar: SolarLike) {
	return new Date(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay(), solar.getHour() - 8, solar.getMinute(), solar.getSecond()))
}

function createSampleDate(solar: SolarLike, sampleTime: Date) {
	return new Date(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay(), sampleTime.getUTCHours(), sampleTime.getUTCMinutes(), 0))
}

function findTermSolar(table: Record<string, SolarLike>, name: string, key: string, year: number) {
	const candidates = [table[name], table[key]].filter(Boolean)
	return candidates.find(solar => solar.getYear() === year) || candidates[0]
}

export function buildSolarTermPoints(year: number, sampleTime: Date): SolarTermPoint[] {
	const table = Solar.fromYmd(year, 7, 1).getLunar().getJieQiTable() as Record<string, SolarLike>

	return SOLAR_TERM_DEFS.flatMap(({ name, key }, index) => {
		const solar = findTermSolar(table, name, key, year)
		if (!solar) return []

		const sampleDate = createSampleDate(solar, sampleTime)
		return [{
			...getSubsolarPoint(sampleDate),
			name,
			date: solarToUtcDate(solar),
			sampleDate,
			kind: getSolarTermKind(name),
			index
		}]
	})
}

export function formatSolarTermDate(date: Date) {
	const chinaDate = new Date(date.getTime() + 8 * 60 * 60 * 1000)
	return `${chinaDate.getUTCMonth() + 1}月${chinaDate.getUTCDate()}日`
}
