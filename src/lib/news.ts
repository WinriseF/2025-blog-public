import { cache } from 'react'

const DEFAULT_NEWS_BILI_BASE_URL = 'https://img.winrisef.top/news/bili'
const DEFAULT_NEWSNOW_BASE_URL = 'https://newsnow.busiyi.world'
const NEWS_REVALIDATE_SECONDS = 300
const NEWSNOW_REVALIDATE_SECONDS = 180
const NEWS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NEWS_DAY_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})(?:（共\s*(\d+)\s*个视频）)?/
const NEWS_TABLE_HEADER_RE = /^\|\s*UP\s*主\s*\|/
const NEWS_TABLE_DIVIDER_RE = /^\|\s*-+/
const NEWS_TABLE_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*(.+)\s*\|\s*\[[^\]]+\]\((https?:\/\/[^)]+)\)\s*\|$/
const MARKDOWN_TITLE_RE = /^#\s+(.+)$/m
const MARKDOWN_LIST_ITEM_RE = /^-\s+/
const NEWS_INDEX_TITLE = '每日内容与热点精选'
const NEWS_INDEX_SUMMARY = '汇总 B 站 UP 内容与 NewsNow 午间热点摘要'
const LEGACY_BILI_DIGEST_TITLE_RE = /B\s*站\s*UP\s*内容精选/

const NEWS_BILI_BASE_URL = (process.env.NEWS_BILI_BASE_URL || process.env.NEXT_PUBLIC_NEWS_BILI_BASE_URL || DEFAULT_NEWS_BILI_BASE_URL).replace(/\/$/, '')
const NEWSNOW_BASE_URL = (process.env.NEWSNOW_BASE_URL || DEFAULT_NEWSNOW_BASE_URL).replace(/\/$/, '')

const NEWSNOW_FOCUS_SOURCES = [
	'36kr-quick',
	'douyin',
	'github-trending-today',
	'ithome',
	'juejin',
	'mktnews-flash',
	'pcbeta-windows11',
	'producthunt',
	'solidot',
	'sspai',
	'thepaper',
	'toutiao',
	'v2ex-share',
	'zaobao',
	'zhihu'
] as const

const NEWSNOW_SOURCE_NAMES: Record<(typeof NEWSNOW_FOCUS_SOURCES)[number], string> = {
	'36kr-quick': '36氪 快讯',
	douyin: '抖音热点',
	'github-trending-today': 'Github Today',
	ithome: 'IT之家',
	juejin: '稀土掘金',
	'mktnews-flash': 'MKTNews',
	'pcbeta-windows11': '远景论坛 Win11',
	producthunt: 'Product Hunt',
	solidot: 'Solidot',
	sspai: '少数派',
	thepaper: '澎湃新闻',
	toutiao: '今日头条',
	'v2ex-share': 'V2EX 分享',
	zaobao: '联合早报',
	zhihu: '知乎'
}

const NEWSNOW_REQUEST_HEADERS = {
	Accept: 'application/json',
	'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
	'Content-Type': 'application/json',
	Origin: NEWSNOW_BASE_URL,
	Referer: `${NEWSNOW_BASE_URL}/c/focus`,
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
}

export type NewsVideo = {
	up: string
	title: string
	url: string
}

export type NewsDay = {
	date: string
	count: number
	videos: NewsVideo[]
}

export type NewsIndex = {
	title: string
	updatedAt?: string
	days: NewsDay[]
}

export type NewsArticle = {
	date: string
	title: string
	markdown: string
	sourceUrl: string
	tags: string[]
	summary: string
}

export type NewsNowItem = {
	id: string
	title: string
	url: string
	mobileUrl?: string
	info?: string
	hover?: string
}

export type NewsNowSource = {
	id: string
	name: string
	status: string
	updatedTime?: number
	items: NewsNowItem[]
}

export type NewsResult<T> =
	| {
			ok: true
			data: T
	  }
	| {
			ok: false
			error: string
			status?: number
	  }

function getNewsUrl(path: string) {
	return `${NEWS_BILI_BASE_URL}/${path.replace(/^\//, '')}`
}

function getNewsNowUrl(path: string) {
	return `${NEWSNOW_BASE_URL}/${path.replace(/^\//, '')}`
}

function normalizeNewsDisplayTitle(title: string, date?: string): string {
	if (LEGACY_BILI_DIGEST_TITLE_RE.test(title)) {
		return date ? `${date} ${NEWS_INDEX_TITLE}` : NEWS_INDEX_TITLE
	}

	return title
}

export function getNewsNowFocusUrl() {
	return getNewsNowUrl('c/focus')
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeNewsNowItem(value: unknown): NewsNowItem | null {
	if (!isRecord(value)) return null

	const title = readString(value.title)
	const url = readString(value.url)
	if (!title || !url) return null

	const extra = isRecord(value.extra) ? value.extra : {}
	const id = readString(value.id) || url
	const mobileUrl = readString(value.mobileUrl)
	const info = readString(extra.info)
	const hover = readString(extra.hover)

	return {
		id,
		title,
		url,
		...(mobileUrl ? { mobileUrl } : {}),
		...(info ? { info } : {}),
		...(hover ? { hover } : {})
	}
}

function normalizeNewsNowSource(value: unknown): NewsNowSource | null {
	if (!isRecord(value)) return null

	const id = readString(value.id)
	if (!id) return null

	const items = Array.isArray(value.items) ? value.items.map(normalizeNewsNowItem).filter((item): item is NewsNowItem => Boolean(item)) : []
	if (items.length === 0) return null

	return {
		id,
		name: NEWSNOW_SOURCE_NAMES[id as (typeof NEWSNOW_FOCUS_SOURCES)[number]] || id,
		status: readString(value.status) || 'unknown',
		updatedTime: readNumber(value.updatedTime),
		items
	}
}

const fetchNewsText = cache(async function fetchNewsText(path: string): Promise<NewsResult<{ text: string; url: string }>> {
	const url = getNewsUrl(path)

	try {
		const res = await fetch(url, {
			headers: {
				Accept: 'text/markdown,text/plain,*/*'
			},
			next: { revalidate: NEWS_REVALIDATE_SECONDS }
		})

		if (!res.ok) {
			return {
				ok: false,
				error: `新闻数据加载失败：${res.status} ${res.statusText}`,
				status: res.status
			}
		}

		const text = await res.text()
		if (!text.trim()) {
			return {
				ok: false,
				error: '新闻数据为空',
				status: res.status
			}
		}

		return {
			ok: true,
			data: { text, url }
		}
	} catch {
		return {
			ok: false,
			error: '新闻数据加载失败，请稍后再试'
		}
	}
})

export const getNewsNowFocus = cache(async function getNewsNowFocus(): Promise<NewsResult<NewsNowSource[]>> {
	try {
		const res = await fetch(getNewsNowUrl('api/s/entire'), {
			method: 'POST',
			headers: NEWSNOW_REQUEST_HEADERS,
			body: JSON.stringify({ sources: NEWSNOW_FOCUS_SOURCES }),
			next: { revalidate: NEWSNOW_REVALIDATE_SECONDS }
		})

		if (!res.ok) {
			return {
				ok: false,
				error: `实时热点加载失败：${res.status} ${res.statusText}`,
				status: res.status
			}
		}

		const data: unknown = await res.json()
		if (!Array.isArray(data)) {
			return {
				ok: false,
				error: '实时热点数据格式异常',
				status: res.status
			}
		}

		const sources = data.map(normalizeNewsNowSource).filter((source): source is NewsNowSource => Boolean(source))
		if (sources.length === 0) {
			return {
				ok: false,
				error: '实时热点暂无内容',
				status: res.status
			}
		}

		return {
			ok: true,
			data: sources
		}
	} catch {
		return {
			ok: false,
			error: '实时热点加载失败，请稍后再试'
		}
	}
})

export function isValidNewsDate(date: string): boolean {
	if (!NEWS_DATE_RE.test(date)) return false

	const [year, month, day] = date.split('-').map(Number)
	const parsed = new Date(Date.UTC(year, month - 1, day))

	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function parseNewsTableRow(line: string): NewsVideo | null {
	const trimmed = line.trim()
	if (!trimmed.startsWith('|')) return null
	if (NEWS_TABLE_DIVIDER_RE.test(trimmed)) return null
	if (NEWS_TABLE_HEADER_RE.test(trimmed)) return null

	const match = NEWS_TABLE_ROW_RE.exec(trimmed)
	if (!match) return null

	return {
		up: match[1].trim(),
		title: match[2].trim(),
		url: match[3].trim()
	}
}

export function parseNewsIndexMarkdown(markdown: string): NewsIndex {
	const lines = markdown.split(/\r?\n/)
	const rawTitle = lines.find(line => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || NEWS_INDEX_TITLE
	const title = normalizeNewsDisplayTitle(rawTitle)
	const updatedAt = lines
		.find(line => /^>\s*更新时间：/.test(line.trim()))
		?.replace(/^>\s*更新时间：/, '')
		.trim()

	const days: NewsDay[] = []
	let currentDay: NewsDay | null = null

	for (const line of lines) {
		const dayMatch = NEWS_DAY_HEADING_RE.exec(line.trim())
		if (dayMatch) {
			currentDay = {
				date: dayMatch[1],
				count: dayMatch[2] ? Number(dayMatch[2]) : 0,
				videos: []
			}
			days.push(currentDay)
			continue
		}

		if (!currentDay) continue

		const video = parseNewsTableRow(line)
		if (video) {
			currentDay.videos.push(video)
		}
	}

	return {
		title,
		updatedAt,
		days: days.map(day => ({
			...day,
			count: day.count || day.videos.length
		}))
	}
}

function getMarkdownTitle(markdown: string, fallback: string): string {
	return MARKDOWN_TITLE_RE.exec(markdown)?.[1]?.trim() || fallback
}

function getSectionMarkdown(markdown: string, heading: string): string {
	const lines = markdown.split(/\r?\n/)
	const sectionLines: string[] = []
	let inSection = false

	for (const line of lines) {
		if (/^##\s+/.test(line.trim())) {
			if (inSection) break
			inSection = line.trim() === `## ${heading}`
			continue
		}

		if (inSection) {
			sectionLines.push(line)
		}
	}

	return sectionLines.join('\n')
}

function countListItems(markdown: string): number {
	let count = 0
	for (const line of markdown.split(/\r?\n/)) {
		if (MARKDOWN_LIST_ITEM_RE.test(line.trim())) count += 1
	}
	return count
}

export function formatNewsDate(date: string): string {
	if (!isValidNewsDate(date)) return date
	const [year, month, day] = date.split('-')
	return `${year}年 ${Number(month)}月 ${Number(day)}日`
}

export async function getNewsIndex(): Promise<NewsResult<NewsIndex>> {
	const result = await fetchNewsText('list.md')
	if (!result.ok) return result

	return {
		ok: true,
		data: parseNewsIndexMarkdown(result.data.text)
	}
}

export async function getNewsArticle(date: string): Promise<NewsResult<NewsArticle>> {
	if (!isValidNewsDate(date)) {
		return {
			ok: false,
			error: '新闻日期格式无效'
		}
	}

	const result = await fetchNewsText(`${date}.md`)
	if (!result.ok) return result

	const markdown = result.data.text
	const contentCount = countListItems(getSectionMarkdown(markdown, '内容'))
	const sourceCount = countListItems(getSectionMarkdown(markdown, '来源'))
	const summaryParts: string[] = []
	if (contentCount > 0) summaryParts.push(`${contentCount} 条 B站内容`)
	if (sourceCount > 0) summaryParts.push(`${sourceCount} 个来源视频`)

	return {
		ok: true,
		data: {
			date,
			title: normalizeNewsDisplayTitle(getMarkdownTitle(markdown, `${date} ${NEWS_INDEX_TITLE}`), date),
			markdown,
			sourceUrl: result.data.url,
			tags: ['新闻', '趋势', 'B站', 'NewsNow'],
			summary: summaryParts.join('，') || NEWS_INDEX_SUMMARY
		}
	}
}
