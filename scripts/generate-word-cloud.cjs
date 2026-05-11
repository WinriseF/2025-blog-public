const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const BLOGS_DIR = path.join(ROOT, 'public', 'blogs')
const BLOG_INDEX_PATH = path.join(BLOGS_DIR, 'index.json')
const OUTPUT_PATH = path.join(BLOGS_DIR, 'word-cloud.json')
const MAX_WORDS_PER_GROUP = 90
const MIN_ADJUSTED_SCORE = 0.14

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
		'一块',
		'一张',
		'一层',
		'一般',
		'一定',
		'不是',
		'不能',
		'不过',
		'不同',
		'不太',
		'不用',
		'不一定',
		'为了',
		'主要',
		'之前',
		'事情',
		'之后',
		'也是',
		'也会',
		'也就',
		'另外',
		'了解',
		'什么',
		'以及',
		'以后',
		'但是',
		'但是你',
		'还是',
		'他们',
		'你们',
		'你要',
		'你是',
		'你在',
		'你有',
		'你会',
		'你的',
		'使用',
		'例如',
		'做的',
		'做了',
		'其实',
		'出来',
		'到了',
		'因为',
		'因此',
		'如果',
		'它们',
		'它的',
		'它是',
		'实际上',
		'实际',
		'具体',
		'对于',
		'对于你',
		'叫做',
		'就是',
		'就是说',
		'也就是说',
		'已经',
		'应该',
		'我们',
		'我要',
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
		'大概',
		'大概是',
		'开始',
		'直接',
		'看到',
		'真的',
		'知道',
		'比较',
		'觉得',
		'的话',
		'来说',
		'来讲',
		'来看',
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
		'上面',
		'下面',
		'前面',
		'后面',
		'地方',
		'重点',
		'需要',
		'可以',
		'比如',
		'特别',
		'非常',
		'首先',
		'还有',
		'可能',
		'可能是',
		'看一下',
		'东西',
		'什么东西',
		'几个',
		'好的',
		'容易',
		'本身',
		'作为',
		'拿到',
		'过来',
		'下来',
		'进去',
		'进来',
		'别的',
		'我的',
		'自己',
		'是有',
		'是不是',
		'所谓',
		'所谓的',
		'当然',
		'重新',
		'取决',
		'取决于',
		'或者',
		'或者是',
		'能够',
		'基本上',
		'得到',
		'而且',
		'每一',
		'使得',
		'之间',
		'新的',
		'都是',
		'样子',
		'等于',
		'变成',
		'认为',
		'最好的',
		'完整',
		'基于',
		'真正',
		'差不多',
		'越来越',
		'为什么',
		'很有',
		'不会',
		'不要',
		'各种',
		'关心',
		'多少个',
		'到底是',
		'也可以',
		'就把',
		'也好',
		'机器',
		'实用',
		'办法',
		'变化',
		'大量',
		'发生',
		'告诉',
		'更多',
		'过去',
		'加上',
		'甚至',
		'是在',
		'中间',
		'干什么',
		'虽然',
		'多少',
		'例子',
		'link',
		'links',
		'http',
		'https',
		'www',
		'com'
	].map(word => word.toLowerCase())
)

const LOW_SIGNAL_WORDS = new Set(
	[
		'安全',
		'包括',
		'部分',
		'常见',
		'创建',
		'发现',
		'方式',
		'分析',
		'处理',
		'复杂',
		'更好',
		'工作',
		'规划',
		'过程',
		'行业',
		'很多',
		'环境',
		'简单',
		'结果',
		'解释',
		'进行',
		'进入',
		'客户',
		'快速',
		'类型',
		'流程',
		'方法',
		'明确',
		'内容',
		'判断',
		'配置',
		'情况',
		'任务',
		'完成',
		'文本',
		'稳定',
		'速度',
		'说明',
		'通过',
		'通常',
		'相对',
		'相关',
		'选择',
		'要求',
		'优先',
		'支持',
		'产品',
		'广告',
		'网页',
		'公司',
		'当前',
		'中文',
		'程序',
		'持续',
		'定位',
		'发布',
		'格式',
		'关注',
		'观测',
		'基础',
		'建议',
		'面向',
		'提供',
		'管理',
		'对话',
		'助手',
		'功能',
		'设计',
		'示例',
		'维护',
		'系列',
		'需求',
		'优点',
		'准确',
		'问题',
		'房子',
		'价格',
		'用户',
		'同样',
		'对应',
		'关系',
		'空间',
		'总结',
		'科学',
		'收集',
		'下降',
		'效果',
		'实现',
		'原始'
	].map(word => word.toLowerCase())
)

const DOMAIN_TERMS = new Set(
	[
		'ai',
		'api',
		'mcp',
		'prompt',
		'rag',
		'sdk',
		'spring',
		'langchain4j',
		'openai',
		'deepseek',
		'gemini',
		'claude',
		'cursor',
		'dashscope',
		'qwen',
		'llama',
		'embedding',
		'dify',
		'coze',
		'yolo',
		'yolo11',
		'yolov8',
		'adam',
		'auc',
		'gpu',
		'bagging',
		'boosting',
		'imagenet',
		'模型',
		'应用',
		'开发',
		'智能',
		'能力',
		'服务',
		'代码',
		'平台',
		'数据',
		'数据集',
		'训练集',
		'验证集',
		'测试集',
		'标注',
		'部署',
		'训练',
		'学习',
		'检测',
		'类别',
		'图片',
		'图像',
		'样本',
		'预测',
		'病害',
		'网络',
		'输出',
		'特征',
		'参数',
		'计算',
		'指标',
		'验证',
		'标签',
		'输入',
		'系统',
		'线性',
		'精度',
		'向量',
		'迁移',
		'微调',
		'架构',
		'分类',
		'算法',
		'函数',
		'神经',
		'梯度',
		'偏差',
		'方差',
		'回归',
		'编码器',
		'解码器',
		'注意力',
		'评估',
		'苹果',
		'比赛',
		'基线',
		'选型',
		'生态',
		'成本',
		'知识',
		'私有',
		'问答',
		'编排',
		'厂商',
		'上下文'
	].map(word => word.toLowerCase())
)

const DOMAIN_PHRASES = [
	'AI 大模型',
	'大模型',
	'模型接入',
	'模型选型',
	'应用开发',
	'Spring AI',
	'LangChain4j',
	'计算机视觉',
	'目标检测',
	'数据标注',
	'类别取舍',
	'比赛复盘',
	'大小模型',
	'模型协同',
	'机器学习',
	'实用机器学习',
	'课程笔记',
	'病虫害检测',
	'音频转写',
	'逐字去噪',
	'课程介绍',
	'特征工程',
	'模型评估',
	'迁移学习',
	'数据获取',
	'数据清洗',
	'模型训练',
	'模型部署',
	'深度学习',
	'神经网络',
	'随机森林',
	'决策树',
	'语言模型',
	'词嵌入',
	'预训练模型',
	'注意力机制'
]

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
	const normalized = word.trim().toLowerCase().replace(/\s+/g, ' ')
	if (!normalized) return ''
	if (normalized.length < 2) return ''
	if (/^\d+(?:\.\d+)?$/.test(normalized)) return ''
	if (STOP_WORDS.has(normalized)) return ''
	if (normalized.includes('东西')) return ''
	if (/^[一二三四五六七八九十两几]+个$/u.test(normalized)) return ''
	if (/^第?[一二三四五六七八九十两几]+[个种张层块次方面]$/u.test(normalized)) return ''
	if (/^[你我他她它][\p{Script=Han}]{1,3}$/u.test(normalized)) return ''
	if (/^(或者|可能|所谓|基本上|也就是说|就是说|看一下)/u.test(normalized)) return ''
	if (/^(也|就|很|不|没)[\p{Script=Han}]{1,3}$/u.test(normalized)) return ''
	if (/(的话|来说|来讲)$/u.test(normalized)) return ''
	return normalized
}

function getTermScoreMultiplier(text) {
	if (DOMAIN_TERMS.has(text)) return 1.18
	if (DOMAIN_PHRASES.some(phrase => phrase.toLowerCase() === text)) return 1.22
	if (LOW_SIGNAL_WORDS.has(text)) return 0.42
	if (/^[\p{Script=Han}]{2}$/u.test(text)) return 0.86
	return 1
}

function isPhraseKeyword(text) {
	return DOMAIN_PHRASES.some(phrase => phrase.toLowerCase() === text)
}

function isAsciiKeyword(text) {
	return DOMAIN_TERMS.has(text)
}

function isDomainKeyword(text) {
	return DOMAIN_TERMS.has(text) || isPhraseKeyword(text) || isAsciiKeyword(text)
}

function isSourceKeyword(text) {
	if (LOW_SIGNAL_WORDS.has(text)) return false
	if (isDomainKeyword(text)) return true
	return /^[\p{Script=Han}]{3,}$/u.test(text)
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

function addWords(target, words, amount = 1, cap = Number.POSITIVE_INFINITY) {
	for (const word of words) {
		target.set(word, Math.min(cap, (target.get(word) || 0) + amount))
	}
}

function addPhrase(target, phrase, amount) {
	const word = normalizeWord(phrase)
	if (!word) return
	target.set(word, (target.get(word) || 0) + amount)
}

function addMatchingPhrases(target, text, amount) {
	const normalizedText = String(text || '').toLowerCase()
	for (const phrase of DOMAIN_PHRASES) {
		if (normalizedText.includes(phrase.toLowerCase())) {
			addPhrase(target, phrase, amount)
		}
	}
}

function getArticleTerms(article) {
	const mdPath = path.join(BLOGS_DIR, article.slug, 'index.md')
	if (!fs.existsSync(mdPath)) return null

	const markdown = fs.readFileSync(mdPath, 'utf8')
	const counts = new Map()

	addWords(counts, extractWords(markdown).filter(isDomainKeyword), 0.8, 8)
	addWords(counts, extractWords(article.title).filter(isSourceKeyword), 8)
	addWords(counts, extractWords(article.summary).filter(isSourceKeyword), 5)
	addMatchingPhrases(counts, `${article.title || ''} ${article.summary || ''}`, 12)
	addMatchingPhrases(counts, markdown, 4)

	for (const tag of article.tags || []) {
		addPhrase(counts, tag, 18)
		addWords(counts, extractWords(tag), 8)
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
	const scored = Array.from(group.words.values())
		.map(item => {
			const documentFrequency = Math.max(1, item.articles.size)
			const idf = Math.log((group.articleCount + 1) / (documentFrequency + 0.5)) + 1
			return {
				...item,
				adjustedScore: item.score * idf * getTermScoreMultiplier(item.text)
			}
		})
		.filter(item => item.adjustedScore >= MIN_ADJUSTED_SCORE && !LOW_SIGNAL_WORDS.has(item.text))

	const sorted = scored
		.sort((a, b) => b.adjustedScore - a.adjustedScore || b.count - a.count || a.text.localeCompare(b.text, 'zh-CN'))
		.slice(0, MAX_WORDS_PER_GROUP)

	const maxScore = Math.max(1, ...sorted.map(item => item.adjustedScore))

	return {
		year,
		articleCount: group.articleCount,
		words: sorted.map(item => ({
			text: item.text,
			weight: Number((item.adjustedScore / maxScore).toFixed(4)),
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
