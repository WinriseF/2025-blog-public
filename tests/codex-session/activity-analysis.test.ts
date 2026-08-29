import { describe, expect, it } from 'vitest'
import { buildSessionActivity } from '../../src/lib/codex-session/activity-analysis'
import { buildSessionPerformance } from '../../src/lib/codex-session/performance'
import type { RecordEnvelope } from '../../src/lib/codex-session/record-utils'
import { buildTokenUsage } from '../../src/lib/codex-session/token-usage'

function record(sequence: number, type: string, payload: Record<string, unknown>): RecordEnvelope {
	return {
		sequence,
		sourceRef: { line: sequence, byteStart: sequence * 10, byteEnd: sequence * 10 + 9 },
		record: { timestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`, type, payload }
	}
}

function tokenRecord(sequence: number, output = 30, reasoning = 10): RecordEnvelope {
	return record(sequence, 'event_msg', {
		type: 'token_count',
		info: {
			total_token_usage: { input_tokens: 100, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: 100 + output },
			last_token_usage: { input_tokens: 100, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: 100 + output }
		}
	})
}

function analyze(records: RecordEnvelope[], decodeExec = true) {
	const usage = buildTokenUsage(records, false, [])
	const performance = buildSessionPerformance(records, usage)
	return buildSessionActivity(records, usage, performance, { decodeExec })
}

describe('Codex Session activity analysis', () => {
	it('计算思考占比、工具请求率和记录耗时', () => {
		const activity = analyze([
			record(1, 'turn_context', { turn_id: 'turn-1' }),
			record(2, 'event_msg', { type: 'user_message' }),
			record(3, 'response_item', { type: 'reasoning', content: [], summary: [] }),
			record(4, 'response_item', { type: 'function_call', name: 'apply_patch', call_id: 'patch-1', arguments: '{}' }),
			record(5, 'response_item', { type: 'function_call_output', call_id: 'patch-1', output: { wall_time_seconds: 0.5, success: true } }),
			tokenRecord(6),
			record(7, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 5000 })
		])

		expect(activity.metrics).toMatchObject({
			requestCount: 1,
			reasoningShareOfOutput: 1 / 3,
			toolRequestCount: 1,
			toolRequestRate: 1,
			logicalToolCallCount: 1,
			toolExecutionCount: 1,
			timedToolExecutionCount: 1,
			toolDurationMs: 500,
			toolTimeShare: 0.1
		})
		expect(activity.requests[0]).toMatchObject({ reasoningItemCount: 1, toolCallCount: 1, toolDurationMs: 500 })
	})

	it('解包单个 exec 内嵌调用而不重复统计外层包装', () => {
		const activity = analyze([
			record(1, 'turn_context', { turn_id: 'turn-1' }),
			record(2, 'event_msg', { type: 'user_message' }),
			record(3, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'outer', input: "await tools.web__run({ search_query: [{ q: 'demo' }] })" }),
			record(5, 'response_item', { type: 'custom_tool_call_output', call_id: 'outer', output: [{ type: 'input_text', text: 'Script completed\nWall time 2.0 seconds' }] }),
			tokenRecord(6),
			record(7, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 5000 })
		])

		expect(activity.tools.filter(tool => tool.logical).map(tool => tool.name)).toEqual(['web__run'])
		expect(activity.metrics).toMatchObject({ logicalToolCallCount: 1, toolExecutionCount: 1, timedToolExecutionCount: 1, toolDurationMs: 2000 })
	})

	it('并行内嵌工具共享批次耗时但不伪造每个工具耗时', () => {
		const activity = analyze([
			record(1, 'turn_context', { turn_id: 'turn-1' }),
			record(2, 'event_msg', { type: 'user_message' }),
			record(3, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'outer', input: "await Promise.all([tools.exec_command({ cmd: 'a' }), tools.web__run({ search_query: [{ q: 'b' }] })])" }),
			record(6, 'response_item', { type: 'custom_tool_call_output', call_id: 'outer', output: [{ type: 'input_text', text: 'Script completed\nWall time 3.0 seconds' }] }),
			tokenRecord(7),
			record(8, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 6000 })
		])

		const logical = activity.tools.filter(tool => tool.logical)
		expect(logical).toHaveLength(2)
		expect(logical.every(tool => tool.durationMs === undefined && tool.status === 'unknown')).toBe(true)
		expect(activity.metrics).toMatchObject({ logicalToolCallCount: 2, toolExecutionCount: 1, timedToolExecutionCount: 1, toolDurationMs: 3000 })
	})

	it('工具并行执行时按区间并集计算墙钟时间', () => {
		const activity = analyze([
			record(1, 'turn_context', { turn_id: 'turn-1' }),
			record(2, 'event_msg', { type: 'user_message' }),
			record(3, 'response_item', { type: 'function_call', name: 'shell_command', call_id: 'a', arguments: '{}' }),
			record(4, 'response_item', { type: 'function_call', name: 'shell_command', call_id: 'b', arguments: '{}' }),
			record(7, 'response_item', { type: 'function_call_output', call_id: 'b', output: { success: true } }),
			record(8, 'response_item', { type: 'function_call_output', call_id: 'a', output: { success: true } }),
			tokenRecord(9),
			record(10, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 10_000 })
		])

		expect(activity.metrics.toolDurationMs).toBe(5000)
		expect(activity.metrics.toolTimeShare).toBe(0.5)
	})

})
