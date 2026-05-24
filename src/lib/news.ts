import { cache } from 'react'

const DEFAULT_NEWS_BILI_BASE_URL = 'https://img.winrisef.top/news/bili'
const NEWS_REVALIDATE_SECONDS = 300
const NEWS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NEWS_DAY_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})(?:（共\s*(\d+)\s*个视频）)?/
const NEWS_TABLE_HEADER_RE = /^\|\s*UP\s*主\s*\|/
const NEWS_TABLE_DIVIDER_RE = /^\|\s*-+/
const NEWS_TABLE_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*(.+)\s*\|\s*\[[^\]]+\]\((https?:\/\/[^)]+)\)\s*\|$/
const MARKDOWN_TITLE_RE = /^#\s+(.+)$/m
const MARKDOWN_LIST_ITEM_RE = /^-\s+/

const NEWS_BILI_BASE_URL = (process.env.NEWS_BILI_BASE_URL || process.env.NEXT_PUBLIC_NEWS_BILI_BASE_URL || DEFAULT_NEWS_BILI_BASE_URL).replace(/\/$/, '')

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
	const title = lines.find(line => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || '新闻趋势'
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
	if (contentCount > 0) summaryParts.push(`${contentCount} 条趋势`)
	if (sourceCount > 0) summaryParts.push(`${sourceCount} 个来源视频`)

	return {
		ok: true,
		data: {
			date,
			title: getMarkdownTitle(markdown, `${date} B站 UP 内容精选`),
			markdown,
			sourceUrl: result.data.url,
			tags: ['新闻', '趋势', 'B站'],
			summary: summaryParts.join('，') || 'B 站 UP 内容精选'
		}
	}
}
