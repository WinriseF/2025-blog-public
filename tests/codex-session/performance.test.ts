import { describe, expect, it } from 'vitest'
import { buildSessionPerformance, summarizePerformance } from '../../src/lib/codex-session/performance'
import type { RecordEnvelope } from '../../src/lib/codex-session/record-utils'
import { buildTokenUsage } from '../../src/lib/codex-session/token-usage'

function record(sequence: number, type: string, payload: Record<string, unknown>): RecordEnvelope {
	return {
		sequence,
		sourceRef: { line: sequence, byteStart: sequence * 10, byteEnd: sequence * 10 + 9 },
		record: { timestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`, type, payload }
	}
}

describe('Codex Session performance', () => {
	it('按用户消息、首条可见回复和回合结束计算日志性能', () => {
		const records = [
			record(1, 'turn_context', { turn_id: 'turn-1', cwd: 'C:\\demo', model: 'gpt-test' }),
			record(2, 'event_msg', { type: 'user_message', message: 'hello' }),
			record(4, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }),
			record(6, 'event_msg', {
				type: 'token_count',
				info: {
					total_token_usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
					last_token_usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 }
				}
			}),
			record(10, 'event_msg', { type: 'task_complete' })
		]
		const usage = buildTokenUsage(records, false, [])
		const performance = buildSessionPerformance(records, usage)
		const metrics = summarizePerformance(performance.turns)

		expect(performance.turns[0]).toMatchObject({ id: 'turn-1', startedAt: '2026-01-01T00:00:02.000Z', firstResponseAt: '2026-01-01T00:00:04.000Z', endedAt: '2026-01-01T00:00:10.000Z', requestCount: 1, outputTokens: 40 })
		expect(metrics).toMatchObject({ firstResponseP50Ms: 2000, firstResponseP95Ms: 2000, averageTurnDurationMs: 8000, outputTokensPerSecond: 5 })
	})

	it('没有可见回复时不伪造首字延时', () => {
		const records = [record(1, 'turn_context', { turn_id: 'turn-1' }), record(2, 'event_msg', { type: 'user_message' }), record(5, 'event_msg', { type: 'task_complete' })]
		const metrics = summarizePerformance(buildSessionPerformance(records, buildTokenUsage(records, false, [])).turns)
		expect(metrics.firstResponseCount).toBe(0)
		expect(metrics.firstResponseP50Ms).toBeUndefined()
	})

	it('优先采用 task_complete 直接记录的耗时', () => {
		const records = [
			record(1, 'event_msg', { type: 'task_started', turn_id: 'turn-1' }),
			record(2, 'event_msg', { type: 'user_message' }),
			record(9, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 4321, time_to_first_token_ms: 876 })
		]
		const performance = buildSessionPerformance(records, buildTokenUsage(records, false, []))
		expect(performance.turns[0]).toMatchObject({ durationMs: 4321, durationSource: 'recorded', firstResponseLatencyMs: 876, firstResponseSource: 'recorded' })
		expect(summarizePerformance(performance.turns)).toMatchObject({ averageTurnDurationMs: 4321, firstResponseP50Ms: 876 })
	})
})
