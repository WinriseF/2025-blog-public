import { describe, expect, it } from 'vitest'
import { compressSessionRecords, scanSessionCompression } from '../../src/lib/codex-session/session-compression'
import { recordPayload, type RecordEnvelope } from '../../src/lib/codex-session/record-utils'
import type { SessionCompressionRuleId, SessionCompressionSelection, SessionCompressionTurn } from '../../src/lib/codex-session/types'

function record(sequence: number, type: string, payload: Record<string, unknown>): RecordEnvelope {
	return {
		sequence,
		sourceRef: { line: sequence, byteStart: sequence * 1000, byteEnd: sequence * 1000 + 900 },
		record: { timestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`, type, payload }
	}
}

function records() {
	const usage = { total_token_usage: { total_tokens: 100, output_tokens: 20, reasoning_output_tokens: 10 } }
	return [
		record(1, 'compacted', { message: 'summary', replacement_history: [{ type: 'message', role: 'user', content: 'old context' }] }),
		record(2, 'response_item', { type: 'reasoning', summary: [{ text: 'thinking' }], encrypted_content: 'secret-thinking' }),
		record(3, 'event_msg', { type: 'agent_reasoning', text: 'thinking mirror' }),
		record(4, 'turn_context', { turn_id: 'turn-1', cwd: 'C:\\work', model: 'gpt-test', collaboration_mode: 'large instructions', permission_profile: { large: true } }),
		record(5, 'event_msg', { type: 'token_count', info: usage, rate_limits: { primary: { used_percent: 10 } } }),
		record(6, 'event_msg', { type: 'token_count', info: usage, rate_limits: { primary: { used_percent: 10 } } }),
		record(7, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/png;base64,${'a'.repeat(1000)}` }], internal_chat_message_metadata_passthrough: { duplicate: true } }),
		record(8, 'response_item', { type: 'custom_tool_call_output', call_id: 'tool-1', output: 'x'.repeat(80_000) }),
		record(9, 'world_state', { cwd: 'C:\\work', state: 'snapshot' }),
		record(10, 'event_msg', { type: 'thread_settings_applied', thread_settings: { instructions: 'runtime settings' } })
	]
}

function sessionRecords(turns: SessionCompressionTurn[]) {
	return turns.flatMap(turn => turn.records)
}

function selections(input: RecordEnvelope[], rules?: SessionCompressionRuleId[]): SessionCompressionSelection[] {
	return sessionRecords(scanSessionCompression(input, 100_000).turns)
		.flatMap(record => record.actions)
		.filter(action => rules ? rules.includes(action.selection.ruleId) : action.defaultSelected)
		.map(action => action.selection)
}

describe('Codex Session compression', () => {
	it('扫描当前 Session 中实际存在的可裁剪内容', () => {
		const scan = scanSessionCompression(records(), 100_000)
		const stats = new Map(scan.rules.map(rule => [rule.id, rule]))
		const nodes = sessionRecords(scan.turns)

		expect(stats.get('reasoning')).toMatchObject({ affectedRecords: 2, occurrences: 2 })
		expect(stats.get('runtime-snapshots')).toMatchObject({ affectedRecords: 2, occurrences: 2 })
		expect(stats.get('duplicate-records')).toMatchObject({ affectedRecords: 1, occurrences: 1 })
		expect(stats.get('tool-outputs')?.candidateBytes).toBeGreaterThan(0)
		expect(stats.get('inline-media')).toMatchObject({ affectedRecords: 1, occurrences: 1 })
		expect(nodes).toHaveLength(records().length)
		expect(nodes.map(node => node.line)).toEqual(records().map(item => item.sourceRef.line))
		expect(nodes.map(node => node.kind)).toEqual(expect.arrayContaining(['reasoning', 'user', 'tool-result', 'context', 'token']))
		expect(nodes.find(node => node.line === 7)?.actions.map(action => action.selection.ruleId)).toEqual(expect.arrayContaining(['inline-media', 'internal-metadata', 'conversation-user']))
	})

	it('默认删除思考和冗余记录但保留推理 Token 与媒体', () => {
		const input = records()
		const compressed = compressSessionRecords(input, 100_000, selections(input))
		const payloads = compressed.records.flatMap(item => item.record ? [recordPayload(item.record)] : [])

		expect(payloads.some(payload => payload.type === 'reasoning' || payload.type === 'agent_reasoning')).toBe(false)
		expect(compressed.records.some(item => item.record?.type === 'world_state')).toBe(false)
		expect(payloads.filter(payload => payload.type === 'token_count')).toHaveLength(1)
		expect(payloads.find(payload => payload.type === 'token_count')).toMatchObject({ info: { total_token_usage: { reasoning_output_tokens: 10 } } })
		const message = payloads.find(payload => payload.type === 'message')
		expect(message).toMatchObject({ content: [{ image_url: expect.stringMatching(/^data:image/) }] })
		expect(message).not.toHaveProperty('internal_chat_message_metadata_passthrough')
		expect(payloads.find(payload => payload.type === 'custom_tool_call_output')).toMatchObject({ output: expect.stringMatching(/^x+$/) })
		expect(recordPayload(compressed.records.find(item => item.record?.type === 'compacted')!.record!)).not.toHaveProperty('replacement_history')
		expect(compressed.rewrittenSequences.has(7)).toBe(true)
		expect(compressed.rewrittenSequences.has(8)).toBe(false)
	})

	it('深度规则替换媒体并截断超长工具输出', () => {
		const input = records()
		const compressed = compressSessionRecords(input, 100_000, selections(input, ['inline-media', 'tool-outputs']))
		const payloads = compressed.records.flatMap(item => item.record ? [recordPayload(item.record)] : [])
		const message = payloads.find(payload => payload.type === 'message')
		const output = payloads.find(payload => payload.type === 'custom_tool_call_output')?.output

		expect(message).toMatchObject({ content: [{ image_url: expect.stringContaining('内嵌媒体已裁剪') }] })
		expect(typeof output).toBe('string')
		expect((output as string).length).toBeLessThan(80_000)
	})

	it('只清理能够和主消息精确匹配的事件正文', () => {
		const input = [
			record(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }),
			record(2, 'event_msg', { type: 'user_message', message: 'hello' }),
			record(3, 'event_msg', { type: 'user_message', message: 'only-event' })
		]
		const compressed = compressSessionRecords(input, 3000, selections(input, ['event-messages']))
		const events = compressed.records.flatMap(item => item.record?.type === 'event_msg' ? [recordPayload(item.record)] : [])

		expect(events[0]).not.toHaveProperty('message')
		expect(events[1]).toMatchObject({ message: 'only-event' })
	})

	it('复用共享调用 ID 规范关联工具名称', () => {
		const input = [
			record(1, 'response_item', { type: 'function_call', id: 'call-by-id', name: 'read_file', arguments: '{}' }),
			record(2, 'response_item', { type: 'function_call_output', id: 'call-by-id', output: 'done' })
		]
		const nodes = sessionRecords(scanSessionCompression(input, 2000).turns)

		expect(nodes[0].label).toBe('工具调用 · read_file')
		expect(nodes[1].label).toBe('工具结果 · read_file')
	})
})
