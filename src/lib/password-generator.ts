export type PasswordMode = 'random' | 'passphrase' | 'pin'
export type PassphraseLanguage = 'english' | 'chinese'
export type CharacterGroupName = 'uppercase' | 'lowercase' | 'digits' | 'symbols'

export type RandomPasswordOptions = {
	length: number
	groups: Record<CharacterGroupName, boolean>
	excludeSimilar: boolean
	avoidConsecutiveRepeat: boolean
	excludedCharacters: string
}

export type PassphraseOptions = {
	language: PassphraseLanguage
	wordCount: number
	separator: '' | '-' | '_' | '.' | ' '
	capitalize: boolean
	appendDigit: boolean
}

export type PassphraseWord = {
	value: string
	hint?: string
}

export type PassphraseResult = {
	password: string
	hint: string
	segments: string[]
}

export type PinOptions = {
	length: number
	avoidConsecutiveRepeat: boolean
}

export type PasswordStrength = {
	bits: number
	label: '弱' | '中等' | '强' | '极强'
	segments: 1 | 2 | 3 | 4
}

export const CHARACTER_GROUPS: Record<CharacterGroupName, string> = {
	uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	lowercase: 'abcdefghijklmnopqrstuvwxyz',
	digits: '0123456789',
	symbols: '!@#$%^&*()-_=+[]{};:,.?/'
}

export const DEFAULT_RANDOM_OPTIONS: RandomPasswordOptions = {
	length: 24,
	groups: {
		uppercase: true,
		lowercase: true,
		digits: true,
		symbols: true
	},
	excludeSimilar: true,
	avoidConsecutiveRepeat: true,
	excludedCharacters: ''
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
	language: 'english',
	wordCount: 6,
	separator: '-',
	capitalize: false,
	appendDigit: false
}

export const DEFAULT_PIN_OPTIONS: PinOptions = {
	length: 6,
	avoidConsecutiveRepeat: true
}

const SIMILAR_CHARACTERS = 'iIl1oO0'
const UINT32_RANGE = 0x100000000

const WORDLISTS: Record<PassphraseLanguage, { url: string; sha256: string; size: number; format: 'json' | 'pinyin-tsv' }> = {
	english: {
		url: 'https://cdn.jsdelivr.net/npm/bip39@3.1.0/src/wordlists/english.json',
		sha256: '62f88f0b7469bfddd862ba4e2499af3758384ae6304c5bb48637d2401d22afb2',
		size: 2048,
		format: 'json'
	},
	chinese: {
		url: 'https://cdn.jsdelivr.net/gh/cfbao/chinese-diceware@5a37230adedf91453d8f255e7826415b034b8562/pinyin8k.wordlist',
		sha256: '0afdec57d3b3cf344cd119e6fa56be701a022d6acafc3607eae5d1e8b6174978',
		size: 8192,
		format: 'pinyin-tsv'
	}
}

const wordlistCache = new Map<PassphraseLanguage, readonly PassphraseWord[]>()
const wordlistRequests = new Map<PassphraseLanguage, Promise<readonly PassphraseWord[]>>()

function randomIndex(maxExclusive: number) {
	if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
		throw new Error('无法从空字符集中生成密码')
	}

	const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive
	const buffer = new Uint32Array(1)
	let value = 0
	do {
		crypto.getRandomValues(buffer)
		value = buffer[0]
	} while (value >= limit)
	return value % maxExclusive
}

function pick<T>(items: readonly T[]) {
	return items[randomIndex(items.length)]
}

function pickDifferent<T>(items: readonly T[], previous?: T) {
	if (previous === undefined) return pick(items)
	if (items.length === 1 && items[0] === previous) throw new Error('可用选项不足以避免连续重复')
	let next = pick(items)
	while (next === previous) next = pick(items)
	return next
}

function shuffle<T>(items: readonly T[]) {
	const result = [...items]
	for (let index = result.length - 1; index > 0; index -= 1) {
		const target = randomIndex(index + 1)
		;[result[index], result[target]] = [result[target], result[index]]
	}
	return result
}

function uniqueCharacters(value: string) {
	return [...new Set(Array.from(value))]
}

function getRandomCharacterGroups(options: RandomPasswordOptions) {
	const excluded = new Set(uniqueCharacters(`${options.excludeSimilar ? SIMILAR_CHARACTERS : ''}${options.excludedCharacters}`))
	return (Object.entries(options.groups) as Array<[CharacterGroupName, boolean]>)
		.filter(([, enabled]) => enabled)
		.map(([name]) => ({ name, characters: uniqueCharacters(CHARACTER_GROUPS[name]).filter(character => !excluded.has(character)) }))
}

export function generateRandomPassword(options: RandomPasswordOptions) {
	const groups = getRandomCharacterGroups(options)
	if (!groups.length) throw new Error('至少选择一种字符类型')
	if (options.length < groups.length) throw new Error('密码长度不能小于已选字符类型数')
	if (groups.some(group => !group.characters.length)) throw new Error('排除字符过多，某个已选字符类型已经为空')
	if (options.avoidConsecutiveRepeat && groups.some(group => group.characters.length < 2)) {
		throw new Error('当前排除规则无法避免连续重复')
	}

	const pool = uniqueCharacters(groups.flatMap(group => group.characters).join(''))
	if (options.avoidConsecutiveRepeat && pool.length < 2) throw new Error('可用字符不足以避免连续重复')

	const requiredPositions = shuffle(Array.from({ length: options.length }, (_, index) => index)).slice(0, groups.length)
	const requiredGroups = new Map(shuffle(requiredPositions).map((position, index) => [position, groups[index].characters] as const))
	const result: string[] = []

	for (let index = 0; index < options.length; index += 1) {
		const source = requiredGroups.get(index) ?? pool
		result.push(options.avoidConsecutiveRepeat ? pickDifferent(source, result[result.length - 1]) : pick(source))
	}

	return result.join('')
}

export function generatePin(options: PinOptions) {
	const digits = Array.from(CHARACTER_GROUPS.digits)
	const result: string[] = []

	for (let index = 0; index < options.length; index += 1) {
		result.push(options.avoidConsecutiveRepeat ? pickDifferent(digits, result[result.length - 1]) : pick(digits))
	}

	return result.join('')
}

export function generatePassphrase(wordlist: readonly PassphraseWord[], options: PassphraseOptions): PassphraseResult {
	if (wordlist.length !== WORDLISTS[options.language].size) throw new Error('词表校验失败')
	const words: PassphraseWord[] = []

	for (let index = 0; index < options.wordCount; index += 1) {
		words.push(pickDifferent(wordlist, words[words.length - 1]))
	}

	const passwordWords = words.map(word =>
		options.language === 'english' && options.capitalize ? `${word.value.charAt(0).toUpperCase()}${word.value.slice(1)}` : word.value
	)
	const suffix = options.appendDigit ? String(randomIndex(10)) : ''
	const hint = options.language === 'chinese' ? `${words.map(word => word.hint).join(' · ')}${suffix ? ` · 数字 ${suffix}` : ''}` : ''
	const segments = passwordWords.map((word, index) => (index === passwordWords.length - 1 ? `${word}${suffix}` : word))
	return { password: `${passwordWords.join(options.separator)}${suffix}`, hint, segments }
}

function bytesToHex(bytes: ArrayBuffer) {
	return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchWordlist(language: PassphraseLanguage) {
	const source = WORDLISTS[language]
	const response = await fetch(source.url, { cache: 'force-cache' })
	if (!response.ok) throw new Error('词表加载失败')

	const text = await response.text()
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	if (bytesToHex(digest) !== source.sha256) throw new Error('词表完整性校验失败')

	let data: PassphraseWord[]
	if (source.format === 'json') {
		const parsed: unknown = JSON.parse(text)
		if (!Array.isArray(parsed)) throw new Error('词表格式校验失败')
		data = parsed.map(word => ({ value: typeof word === 'string' ? word : '' }))
	} else {
		data = text
			.split(/\r?\n/)
			.filter(Boolean)
			.map(line => {
				const [value = '', hint = ''] = line.split('\t')
				return { value, hint }
			})
	}
	if (
		data.length !== source.size ||
		data.some(word => !word.value || (source.format === 'pinyin-tsv' && (!/^[a-z]+$/.test(word.value) || !word.hint))) ||
		new Set(data.map(word => word.value)).size !== source.size
	) {
		throw new Error('词表格式校验失败')
	}
	return Object.freeze(data.map(word => Object.freeze(word)))
}

export function loadPassphraseWordlist(language: PassphraseLanguage) {
	const cached = wordlistCache.get(language)
	if (cached) return Promise.resolve(cached)

	const pending = wordlistRequests.get(language)
	if (pending) return pending

	const request = fetchWordlist(language)
		.then(wordlist => {
			wordlistCache.set(language, wordlist)
			wordlistRequests.delete(language)
			return wordlist
		})
		.catch(error => {
			wordlistRequests.delete(language)
			throw error
		})

	wordlistRequests.set(language, request)
	return request
}

export function estimateRandomPasswordEntropy(options: RandomPasswordOptions) {
	const groups = getRandomCharacterGroups(options)
	if (!groups.length || groups.some(group => !group.characters.length) || options.length < groups.length) return 0
	const poolSize = uniqueCharacters(groups.flatMap(group => group.characters).join('')).length
	if (!poolSize) return 0
	if (options.avoidConsecutiveRepeat && options.length > 1) {
		if (poolSize < 2) return 0
		return Math.log2(poolSize) + (options.length - 1) * Math.log2(poolSize - 1)
	}
	return options.length * Math.log2(poolSize)
}

export function estimatePassphraseEntropy(options: PassphraseOptions) {
	const base = options.wordCount * Math.log2(WORDLISTS[options.language].size)
	return base + (options.appendDigit ? Math.log2(10) : 0)
}

export function estimatePinEntropy(options: PinOptions) {
	if (options.avoidConsecutiveRepeat && options.length > 1) return Math.log2(10) + (options.length - 1) * Math.log2(9)
	return options.length * Math.log2(10)
}

export function getPasswordStrength(bits: number): PasswordStrength {
	if (bits < 40) return { bits, label: '弱', segments: 1 }
	if (bits < 60) return { bits, label: '中等', segments: 2 }
	if (bits < 80) return { bits, label: '强', segments: 3 }
	return { bits, label: '极强', segments: 4 }
}
