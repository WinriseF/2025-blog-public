import type { TranslationConfig } from './types'

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

export function createSessionConfigStore() {
	let config: TranslationConfig | null = null
	return {
		get: () => config,
		set(input: TranslationConfig) {
			config = validateTranslationConfig(input)
		},
		clear() {
			config = null
		}
	}
}

export type SessionConfigStore = ReturnType<typeof createSessionConfigStore>
