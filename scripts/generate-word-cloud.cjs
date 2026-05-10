const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const BLOGS_DIR = path.join(ROOT, 'public', 'blogs')
const BLOG_INDEX_PATH = path.join(BLOGS_DIR, 'index.json')
const OUTPUT_PATH = path.join(BLOGS_DIR, 'word-cloud.json')
const MAX_WORDS_PER_GROUP = 90

const STOP_WORDS = new Set(
	[
		'一个',
		'一些',
		'一样',
		'一下',
		'一直',
		'一种',
		'一点',
		'一次',
		'不是',
		'不能',
		'不过',
		'不同',
		'不太',
		'不用',
		'为了',
		'主要',
		'之前',
		'之后',
		'也是',
		'也会',
		'另外',
		'了解',
		'什么',
		'以及',
		'但是',
		'还是',
		'你们',
		'你的',
		'使用',
		'例如',
		'做的',
		'其实',
		'出来',
		'到了',
		'因为',
		'因此',
		'如果',
		'它们',
		'它的',
		'它是',
		'对于',
		'就是',
		'已经',
		'应该',
		'我们',
		'很多',
		'怎么',
		'所以',
		'所有',
		'时候',
		'是否',
		'最后',
		'有些',
		'没有',
		'然后',
		'现在',
		'的是',
		'大家',
		'开始',
		'直接',
		'看到',
		'真的',
		'知道',
		'比较',
		'的话',
		'来说',
		'起来',
		'这个',
		'这些',
		'这里',
		'这样',
		'这种',
		'那么',
		'那些',
		'那个',
		'里面',
		'整个',
		'地方',
		'重点',
		'需要',
		'可以',
		'比如',
		'特别',
		'非常',
		'首先',
		'link',
		'links',
		'http',
		'https',
		'www',
		'com'
	].map(word => word.toLowerCase())
)

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null

function readJson(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'))
	} catch {
		return fallback
	}
}

function stripMarkdown(markdown) {
	return markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`]*`/g, ' ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[|#>*_~\-+=()[\]{}.,，。；;：:！？!?、“”"'<>/\\]/g, ' ')
}

function normalizeWord(word) {
	const normalized = word.trim().toLowerCase()
	if (!normalized) return ''
	if (normalized.length < 2) return ''
	if (/^\d+(?:\.\d+)?$/.test(normalized)) return ''
	if (STOP_WORDS.has(normalized)) return ''
	return normalized
}

function extractWords(text) {
	const clean = stripMarkdown(String(text || ''))
	const words = []

	if (segmenter) {
		for (const part of segmenter.segment(clean)) {
			if (!part.isWordLike) continue
			const word = normalizeWord(part.segment)
			if (word) words.push(word)
		}
		return words
	}

	const matches = clean.match(/[\p{Script=Han}]{2,}|[a-zA-Z][a-zA-Z0-9+#.-]{1,}/gu) || []
	for (const match of matches) {
		const word = normalizeWord(match)
		if (word) words.push(word)
	}
	return words
}

function addWords(target, words, amount = 1) {
	for (const word of words) {
		target.set(word, (target.get(word) || 0) + amount)
	}
}

function addPhrase(target, phrase, amount) {
	const word = normalizeWord(phrase)
	if (!word) return
	target.set(word, (target.get(word) || 0) + amount)
}

function getArticleTerms(article) {
	const mdPath = path.join(BLOGS_DIR, article.slug, 'index.md')
	if (!fs.existsSync(mdPath)) return null

	const markdown = fs.readFileSync(mdPath, 'utf8')
	const counts = new Map()

	addWords(counts, extractWords(markdown), 1)
	addWords(counts, extractWords(article.title), 4)
	addWords(counts, extractWords(article.summary), 1.5)

	for (const tag of article.tags || []) {
		addPhrase(counts, tag, 8)
		addWords(counts, extractWords(tag), 4)
	}

	const maxCount = Math.max(1, ...counts.values())

	return {
		slug: article.slug,
		title: article.title || article.slug,
		year: String(new Date(article.date).getFullYear()),
		counts,
		maxCount
	}
}

function addArticleToGroup(group, articleTerms) {
	group.articleCount += 1

	for (const [text, count] of articleTerms.counts) {
		const contribution = Math.log1p(count) / Math.log1p(articleTerms.maxCount)
		const cappedContribution = Math.min(1, contribution)
		const item = group.words.get(text) || {
			text,
			score: 0,
			count: 0,
			articles: new Map()
		}

		item.score += cappedContribution
		item.count += Math.round(count)
		item.articles.set(articleTerms.slug, {
			slug: articleTerms.slug,
			title: articleTerms.title,
			count: Math.round(count)
		})
		group.words.set(text, item)
	}
}

function createGroup() {
	return {
		articleCount: 0,
		words: new Map()
	}
}

function serializeGroup(year, group) {
	const sorted = Array.from(group.words.values())
		.sort((a, b) => b.score - a.score || b.count - a.count || a.text.localeCompare(b.text, 'zh-CN'))
		.slice(0, MAX_WORDS_PER_GROUP)

	const maxScore = Math.max(1, ...sorted.map(item => item.score))

	return {
		year,
		articleCount: group.articleCount,
		words: sorted.map(item => ({
			text: item.text,
			weight: Number((item.score / maxScore).toFixed(4)),
			count: item.count,
			articles: Array.from(item.articles.values())
				.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'zh-CN'))
				.slice(0, 5)
		}))
	}
}

function main() {
	const blogs = readJson(BLOG_INDEX_PATH, [])
	const byYear = new Map()
	const all = createGroup()

	for (const article of blogs) {
		if (!article?.slug || !article?.date) continue
		const articleTerms = getArticleTerms(article)
		if (!articleTerms) continue

		const yearGroup = byYear.get(articleTerms.year) || createGroup()
		addArticleToGroup(yearGroup, articleTerms)
		byYear.set(articleTerms.year, yearGroup)
		addArticleToGroup(all, articleTerms)
	}

	const years = Array.from(byYear.entries())
		.sort(([a], [b]) => Number(b) - Number(a))
		.map(([year, group]) => serializeGroup(year, group))

	const payload = {
		years,
		all: serializeGroup('all', all)
	}

	fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, '\t')}\n`, 'utf8')
	console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${years.length} year groups.`)
}

main()
