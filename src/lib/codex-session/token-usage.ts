import { asNumber, asObject, asString, payloadType, recordPayload, tokenUsageSchema, type RecordEnvelope } from './record-utils'
import type { ParseDiagnostic, SessionTokenUsage, TokenUsageNumbers } from './types'

function mapUsage(value: unknown): TokenUsageNumbers | undefined {
	const parsed = tokenUsageSchema.safeParse(value)
	if (!parsed.success) return
	const input = parsed.data.input_tokens ?? 0
	const cachedInput = parsed.data.cached_input_tokens ?? 0
	return {
		input,
		freshInput: Math.max(input - cachedInput, 0),
		cachedInput,
		cacheWriteInput: parsed.data.cache_write_input_tokens ?? 0,
		output: parsed.data.output_tokens ?? 0,
		reasoningOutput: parsed.data.reasoning_output_tokens ?? 0,
		total: parsed.data.total_tokens
	}
}

export function buildTokenUsage(records: RecordEnvelope[], possiblyInherited: boolean, diagnostics: ParseDiagnostic[]): SessionTokenUsage {
	const samples: SessionTokenUsage['samples'] = []
	let latestTotal: TokenUsageNumbers | undefined
	let contextWindow: number | undefined
	let previousTotal: number | undefined
	let invalid = false
	let currentTurnId: string | undefined
	let currentCwd: string | undefined
	let currentModel: string | undefined

	for (const envelope of records) {
		const record = envelope.record
		if (!record) continue
		const payload = recordPayload(record)
		if (record.type === 'session_meta') {
			currentCwd = asString(payload.cwd) ?? currentCwd
			currentModel = asString(payload.model) ?? currentModel
		}
		else if (record.type === 'turn_context') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			currentCwd = asString(payload.cwd) ?? currentCwd
			currentModel = asString(payload.model) ?? currentModel
		}
		if (record.type !== 'event_msg' || payloadType(record) !== 'token_count') continue
		const info = asObject(payload.info)
		if (!info) continue
		contextWindow = asNumber(info.model_context_window) ?? contextWindow

		const total = mapUsage(info.total_token_usage)
		if (!total) {
			diagnostics.push({
				id: `diagnostic-token-shape-${envelope.sequence}`,
				severity: 'warning',
				code: 'TOKEN_USAGE_MALFORMED',
				message: '跳过了一条字段不完整的累计 Token 记录',
				sourceRef: envelope.sourceRef
			})
			continue
		}
		if (previousTotal !== undefined && total.total < previousTotal) {
			invalid = true
			diagnostics.push({
				id: `diagnostic-token-reset-${envelope.sequence}`,
				severity: 'error',
				code: 'TOKEN_TOTAL_DECREASED',
				message: `累计 Token 从 ${previousTotal} 降至 ${total.total}，已隐藏 Session 总量`,
				sourceRef: envelope.sourceRef
			})
		}

		const advanced = previousTotal !== total.total
		previousTotal = total.total
		latestTotal = total
		const rawLast = info.last_token_usage
		const last = advanced ? mapUsage(rawLast) : undefined
		if (advanced && rawLast != null && !last) {
			diagnostics.push({
				id: `diagnostic-token-sample-shape-${envelope.sequence}`,
				severity: 'warning',
				code: 'TOKEN_SAMPLE_MALFORMED',
				message: '跳过了一条字段不完整的请求级 Token 记录',
				sourceRef: envelope.sourceRef
			})
		}
		if (last) {
			samples.push({
				...last,
				id: `token-${envelope.sequence}`,
				sequence: envelope.sequence,
				timestamp: record.timestamp,
				turnId: currentTurnId,
				cwd: currentCwd,
				model: currentModel,
				contextWindow: asNumber(info.model_context_window),
				sourceRef: envelope.sourceRef
			})
		}
	}

	return {
		status: invalid ? 'invalid' : latestTotal ? 'available' : 'missing',
		scope: possiblyInherited ? 'possibly-inherited' : 'session',
		total: invalid ? undefined : latestTotal,
		contextWindow,
		samples
	}
}
