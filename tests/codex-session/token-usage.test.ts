import { describe, expect, it } from 'vitest'
import type { RecordEnvelope } from '../../src/lib/codex-session/parser-internal'
import { buildTokenUsage } from '../../src/lib/codex-session/token-usage'
import type { ParseDiagnostic } from '../../src/lib/codex-session/types'

function tokenRecord(sequence: number, total: number, input = 100, cached = 20): RecordEnvelope {
	return {
		sequence,
		sourceRef: { line: sequence, byteStart: sequence * 10, byteEnd: sequence * 10 + 9 },
		record: {
			timestamp: `2026-01-01T00:00:0${sequence}.000Z`,
			type: 'event_msg',
			payload: {
				type: 'token_count',
				info: {
					total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: total - input, reasoning_output_tokens: 5, total_tokens: total },
					last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: total - input, reasoning_output_tokens: 5, total_tokens: total },
					model_context_window: 1000
				}
			}
		}
	}
}

describe('buildTokenUsage', () => {
	it('使用最后一条累计值并正确拆分缓存', () => {
		const diagnostics: ParseDiagnostic[] = []
		const usage = buildTokenUsage([tokenRecord(1, 120), tokenRecord(2, 180, 140, 40)], false, diagnostics)
		expect(usage.status).toBe('available')
		expect(usage.total).toMatchObject({ total: 180, input: 140, freshInput: 100, cachedInput: 40 })
		expect(usage.samples).toHaveLength(2)
	})

	it('累计值下降时隐藏总量', () => {
		const diagnostics: ParseDiagnostic[] = []
		const usage = buildTokenUsage([tokenRecord(1, 180, 140), tokenRecord(2, 120)], false, diagnostics)
		expect(usage.status).toBe('invalid')
		expect(usage.total).toBeUndefined()
		expect(diagnostics.some(item => item.code === 'TOKEN_TOTAL_DECREASED')).toBe(true)
	})

	it('缺失记录不显示零，并保留继承范围标记', () => {
		const usage = buildTokenUsage([], true, [])
		expect(usage).toMatchObject({ status: 'missing', scope: 'possibly-inherited' })
	})
})
