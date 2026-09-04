import { cache } from 'react'

const DEFAULT_ENGLISH_READING_BASE_URL = 'https://img.winrisef.top/news/english-reading'
const ENGLISH_READING_REVALIDATE_SECONDS = 300

const ENGLISH_READING_BASE_URL = (process.env.ENGLISH_READING_BASE_URL || process.env.NEXT_PUBLIC_ENGLISH_READING_BASE_URL || DEFAULT_ENGLISH_READING_BASE_URL).replace(/\/$/, '')

export type EnglishReadingItem = {
	key: string
	title: string
	hasAudio: boolean
}

export type EnglishReadingIndex = {
	items: EnglishReadingItem[]
}

export type EnglishReadingArticle = EnglishReadingItem & {
	markdown: string
	sourceUrl: string
	summary: string
}

export type EnglishReadingResult<T> =
	| {
			ok: true
			data: T
	  }
	| {
			ok: false
			error: string
			status?: number
	  }

function getEnglishReadingUrl(path: string) {
	return `${ENGLISH_READING_BASE_URL}/${path.replace(/^\//, '')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isValidKey(key: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(key)
}

function normalizeItem(value: unknown): EnglishReadingItem | null {
	if (!isRecord(value)) return null

	const key = readString(value.key)
	const title = readString(value.title)
	if (!key || !title || !isValidKey(key)) return null

	return {
		key,
		title,
		hasAudio: value.hasAudio === true
	}
}

export function parseEnglishReadingIndex(text: string): EnglishReadingIndex {
	const value: unknown = JSON.parse(text)
	const items = isRecord(value) && Array.isArray(value.items) ? value.items.map(normalizeItem).filter((item): item is EnglishReadingItem => Boolean(item)) : []
	return { items }
}

export function parseEnglishReadingArticle(markdown: string, item: EnglishReadingItem, sourceUrl: string): EnglishReadingArticle {
	const lines = markdown.split(/\r?\n/)
	const titleIndex = lines.findIndex(line => Boolean(line.trim()))
	const firstLine = titleIndex >= 0 ? lines[titleIndex].trim() : ''
	const markdownTitle = /^\uFEFF?#{1,6}\s+(.+)$/.exec(firstLine)?.[1]?.trim()
	const hasLeadingTitle = Boolean(markdownTitle) || firstLine === item.title
	const content = hasLeadingTitle && titleIndex >= 0 ? lines.slice(titleIndex + 1).join('\n').trimStart() : markdown.trimStart()
	const summary = content.split(/\r?\n/).find(line => Boolean(line.trim()))?.trim() || '英文原文精读与音频听读。'

	return {
		...item,
		markdown: content,
		sourceUrl,
		summary
	}
}

const fetchEnglishReadingText = cache(async function fetchEnglishReadingText(path: string): Promise<EnglishReadingResult<{ text: string; url: string }>> {
	const url = getEnglishReadingUrl(path)

	try {
		const res = await fetch(url, {
			headers: {
				Accept: 'application/json,text/markdown,text/plain,*/*'
			},
			next: { revalidate: ENGLISH_READING_REVALIDATE_SECONDS }
		})

		if (!res.ok) {
			return {
				ok: false,
				error: `英语精读加载失败：${res.status} ${res.statusText}`,
				status: res.status
			}
		}

		const text = await res.text()
		if (!text.trim()) {
			return {
				ok: false,
				error: '英语精读内容为空',
				status: res.status
			}
		}

		return { ok: true, data: { text, url } }
	} catch {
		return { ok: false, error: '英语精读加载失败，请稍后再试' }
	}
})

export async function getEnglishReadingIndex(): Promise<EnglishReadingResult<EnglishReadingIndex>> {
	const result = await fetchEnglishReadingText('list.json')
	if (!result.ok) return result

	try {
		return { ok: true, data: parseEnglishReadingIndex(result.data.text) }
	} catch {
		return { ok: false, error: '英语精读索引格式异常' }
	}
}

export async function getEnglishReadingArticle(key: string): Promise<EnglishReadingResult<EnglishReadingArticle>> {
	if (!isValidKey(key)) return { ok: false, error: '英语精读标识无效' }

	const [articleResult, indexResult] = await Promise.all([fetchEnglishReadingText(`${encodeURIComponent(key)}.md`), getEnglishReadingIndex()])
	if (!indexResult.ok) return indexResult

	const item = indexResult.data.items.find(candidate => candidate.key === key)
	if (!item) return { ok: false, error: '英语精读不存在', status: 404 }
	if (!articleResult.ok) return articleResult

	return { ok: true, data: parseEnglishReadingArticle(articleResult.data.text, item, articleResult.data.url) }
}
