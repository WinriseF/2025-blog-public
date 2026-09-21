import type { TranslationConfig } from './types'

const STORAGE_KEY = 'english-reading.translation-config.v1'
const KEY_DATABASE = 'english-reading-secrets'
const KEY_STORE = 'keys'
const KEY_ID = 'translation-config'

type StoredConfig = {
	version: 1
	endpoint: string
	model: string
	iv: string
	apiKeyCiphertext: string
}

export function validateTranslationConfig(input: TranslationConfig): TranslationConfig {
	let url: URL
	try {
		url = new URL(input.endpoint.trim())
	} catch {
		throw new Error('请输入完整的模型 API 请求地址。')
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
		throw new Error('请使用 HTTPS 请求地址，密钥请填写在单独的密钥栏中。')
	}
	if (!input.model.trim() || !input.apiKey.trim()) throw new Error('请填写模型名称和 API 密钥。')
	return { endpoint: url.href, model: input.model.trim(), apiKey: input.apiKey.trim() }
}

function openKeyDatabase() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(KEY_DATABASE, 1)
		request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

function requestResult<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

async function readEncryptionKey() {
	const database = await openKeyDatabase()
	try {
		return await requestResult(database.transaction(KEY_STORE).objectStore(KEY_STORE).get(KEY_ID)) as CryptoKey | undefined
	} finally {
		database.close()
	}
}

async function writeEncryptionKey(key: CryptoKey) {
	const database = await openKeyDatabase()
	try {
		await requestResult(database.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(key, KEY_ID))
	} finally {
		database.close()
	}
}

async function deleteEncryptionKey() {
	const database = await openKeyDatabase()
	try {
		await requestResult(database.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).delete(KEY_ID))
	} finally {
		database.close()
	}
}

async function getEncryptionKey() {
	const stored = await readEncryptionKey()
	if (stored) return stored
	const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
	await writeEncryptionKey(created)
	return created
}

function toBase64(value: ArrayBuffer | Uint8Array) {
	let binary = ''
	const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

function fromBase64(value: string) {
	return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (!value || typeof value !== 'object') return false
	const config = value as Partial<StoredConfig>
	return config.version === 1 && typeof config.endpoint === 'string' && typeof config.model === 'string' && typeof config.iv === 'string' && typeof config.apiKeyCiphertext === 'string'
}

async function readStoredConfig() {
	if (typeof localStorage === 'undefined' || typeof indexedDB === 'undefined') return null
	try {
		const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
		if (!isStoredConfig(value)) return null
		const key = await readEncryptionKey()
		if (!key) return null
		const apiKey = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(value.iv) }, key, fromBase64(value.apiKeyCiphertext)))
		return validateTranslationConfig({ endpoint: value.endpoint, model: value.model, apiKey })
	} catch {
		localStorage.removeItem(STORAGE_KEY)
		return null
	}
}

async function writeStoredConfig(config: TranslationConfig) {
	try {
		const key = await getEncryptionKey()
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const apiKeyCiphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(config.apiKey))
		const stored: StoredConfig = { version: 1, endpoint: config.endpoint, model: config.model, iv: toBase64(iv), apiKeyCiphertext: toBase64(apiKeyCiphertext) }
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
	} catch {
		throw new Error('浏览器无法加密并保存配置，请检查当前站点的存储权限。')
	}
}

export function createBrowserConfigStore() {
	let config: TranslationConfig | null = null
	let loading: Promise<TranslationConfig | null> | null = null
	return {
		async get() {
			loading ||= readStoredConfig()
			config = await loading
			return config
		},
		async set(input: TranslationConfig) {
			const next = validateTranslationConfig(input)
			await writeStoredConfig(next)
			config = next
			loading = Promise.resolve(next)
			return next
		},
		async clear() {
			localStorage.removeItem(STORAGE_KEY)
			await deleteEncryptionKey().catch(() => {})
			config = null
			loading = Promise.resolve(null)
		}
	}
}

export type BrowserConfigStore = ReturnType<typeof createBrowserConfigStore>
