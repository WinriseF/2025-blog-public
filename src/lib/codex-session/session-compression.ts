import { asNumber, asObject, asString, extractText, recordPayload, type CodexRecord, type RecordEnvelope } from './record-utils'
import { isResponseToolCallType, isResponseToolOutputType, toolCallId } from './tool-record'
import type {
	SessionCompressionAction,
	SessionCompressionReport,
	SessionCompressionRecordKind,
	SessionCompressionRecord,
	SessionCompressionRuleId,
	SessionCompressionRuleStat,
	SessionCompressionScan,
	SessionCompressionSelection,
	SessionCompressionTurn
} from './types'

const SESSION_COMPRESSION_RULES: ReadonlyArray<{
	id: SessionCompressionRuleId
	label: string
	description: string
	defaultSelected: boolean
}> = [
	{ id: 'record', label: '完整记录', description: '删除这条原始 JSONL 记录', defaultSelected: false },
	{ id: 'conversation-user', label: '用户消息', description: '删除这条用户消息记录', defaultSelected: false },
	{ id: 'conversation-assistant', label: '助手回复', description: '删除这条助手回复记录', defaultSelected: false },
	{ id: 'conversation-tools', label: '工具交互', description: '删除这条工具调用、结果或结束事件', defaultSelected: false },
	{ id: 'compaction-history', label: '历史上下文副本', description: '删除 compacted 中重复保存的 replacement_history，保留压缩摘要', defaultSelected: true },
	{ id: 'reasoning', label: 'AI 思考记录', description: '删除 reasoning 正文与镜像事件，保留 token_count 中的推理 Token 数量', defaultSelected: true },
	{ id: 'event-messages', label: '事件消息副本', description: '清除 user_message、agent_message 中重复保存的正文，保留事件时间', defaultSelected: true },
	{ id: 'runtime-snapshots', label: '运行时快照', description: '删除 world_state 和重复的 thread_settings_applied 记录', defaultSelected: true },
	{ id: 'runtime-context', label: '重复运行环境', description: '清除 turn_context 中反复出现的协作模式和权限配置正文', defaultSelected: true },
	{ id: 'internal-metadata', label: '内部透传元数据', description: '删除 internal_chat_message_metadata_passthrough 等内部字段', defaultSelected: true },
	{ id: 'duplicate-records', label: '完全重复记录', description: '删除内容相同的 developer 消息和累计 Token 未变化的样本', defaultSelected: true },
	{ id: 'rate-limits', label: '速率限制快照', description: '删除 token_count 中重复携带的 rate_limits 状态', defaultSelected: true },
	{ id: 'tool-outputs', label: '超长工具输出', description: '单段超过 64 KB 时只保留头部与尾部', defaultSelected: false },
	{ id: 'inline-media', label: '内嵌图片与媒体', description: '用包含类型和原始大小的占位文本替换 Base64 媒体', defaultSelected: false }
]

const RULE_IDS = SESSION_COMPRESSION_RULES.map(rule => rule.id)
const RUNTIME_CONTEXT_FIELDS = ['collaboration_mode', 'permission_profile', 'file_system_sandbox_policy']
const INTERNAL_FIELDS = new Set(['internal_chat_message_metadata_passthrough'])
const EXTRA_TOOL_CALL_TYPES = new Set(['tool_search_call', 'web_search_call'])
const EXTRA_TOOL_OUTPUT_TYPES = new Set(['tool_search_output'])
const TOOL_EVENT_TYPES = new Set(['exec_command_end', 'mcp_tool_call_end', 'web_search_end', 'patch_apply_end', 'image_generation_end'])
const TOOL_OUTPUT_LIMIT = 65_536
const TOOL_OUTPUT_HEAD = 49_152
const TOOL_OUTPUT_TAIL = 16_384
const encoder = new TextEncoder()

function isToolCallType(type?: string) {
	return isResponseToolCallType(type) || Boolean(type && EXTRA_TOOL_CALL_TYPES.has(type))
}

function isToolOutputType(type?: string) {
	return isResponseToolOutputType(type) || Boolean(type && EXTRA_TOOL_OUTPUT_TYPES.has(type))
}

type CompressionState = { developerMessages: Set<string>; userMessages: Set<string>; assistantMessages: Set<string>; previousTokenTotal?: number }
type RuleMatch = { occurrences: number; candidateBytes: number }
type RecordFacts = { matches: Map<SessionCompressionRuleId, RuleMatch>; duplicateDeveloper: boolean; duplicateToken: boolean }
type RewriteResult = { value: unknown; changed: boolean; occurrences: number; candidateBytes: number }

function createState(envelopes: RecordEnvelope[]): CompressionState {
	const userMessages = new Set<string>()
	const assistantMessages = new Set<string>()
	for (const envelope of envelopes) {
		if (envelope.record?.type !== 'response_item') continue
		const payload = recordPayload(envelope.record)
		if (asString(payload.type) !== 'message') continue
		const text = extractText(payload.content)
		if (!text) continue
		if (asString(payload.role) === 'user') userMessages.add(text)
		else if (asString(payload.role) === 'assistant') assistantMessages.add(text)
	}
	return { developerMessages: new Set(), userMessages, assistantMessages }
}

function jsonBytes(value: unknown) {
	try {
		return encoder.encode(JSON.stringify(value)).byteLength
	} catch {
		return 0
	}
}

function addMatch(matches: Map<SessionCompressionRuleId, RuleMatch>, id: SessionCompressionRuleId, occurrences: number, candidateBytes: number) {
	if (!occurrences) return
	const current = matches.get(id)
	matches.set(id, {
		occurrences: (current?.occurrences ?? 0) + occurrences,
		candidateBytes: (current?.candidateBytes ?? 0) + candidateBytes
	})
}

function rewriteTree(value: unknown, mode: 'media' | 'truncate'): RewriteResult {
	if (typeof value === 'string') {
		if (mode === 'media') {
			const match = value.match(/^data:((?:image|audio|video)\/[^;,]+)[^,]*;base64,/i)
			if (match) return {
				value: `[内嵌媒体已裁剪：${match[1]}，原始 ${encoder.encode(value).byteLength} 字节]`,
				changed: true,
				occurrences: 1,
				candidateBytes: encoder.encode(value).byteLength
			}
		}
		if (mode === 'truncate' && value.length > TOOL_OUTPUT_LIMIT) return {
			value: `${value.slice(0, TOOL_OUTPUT_HEAD)}\n…[工具输出已裁剪，原始 ${encoder.encode(value).byteLength} 字节]…\n${value.slice(-TOOL_OUTPUT_TAIL)}`,
			changed: true,
			occurrences: 1,
			candidateBytes: Math.max(encoder.encode(value).byteLength - TOOL_OUTPUT_LIMIT, 0)
		}
		return { value, changed: false, occurrences: 0, candidateBytes: 0 }
	}
	if (Array.isArray(value)) {
		let changed = false
		let occurrences = 0
		let candidateBytes = 0
		const next = value.map(item => {
			const result = rewriteTree(item, mode)
			changed ||= result.changed
			occurrences += result.occurrences
			candidateBytes += result.candidateBytes
			return result.value
		})
		return { value: changed ? next : value, changed, occurrences, candidateBytes }
	}
	const object = asObject(value)
	if (!object) return { value, changed: false, occurrences: 0, candidateBytes: 0 }
	let changed = false
	let occurrences = 0
	let candidateBytes = 0
	const next: Record<string, unknown> = {}
	for (const [key, child] of Object.entries(object)) {
		const result = rewriteTree(child, mode)
		changed ||= result.changed
		occurrences += result.occurrences
		candidateBytes += result.candidateBytes
		next[key] = result.value
	}
	return { value: changed ? next : value, changed, occurrences, candidateBytes }
}

function tokenTotal(payload: Record<string, unknown>) {
	const info = asObject(payload.info)
	return asNumber(asObject(info?.total_token_usage)?.total_tokens)
}

function isToolOutput(record: CodexRecord, payload: Record<string, unknown>) {
	return (record.type === 'response_item' && isToolOutputType(asString(payload.type)))
		|| (record.type === 'event_msg' && asString(payload.type) === 'mcp_tool_call_end')
}

function conversationRule(record: CodexRecord, payload: Record<string, unknown>): SessionCompressionRuleId | undefined {
	const type = asString(payload.type)
	if (record.type === 'response_item' && type === 'message') {
		if (asString(payload.role) === 'user') return 'conversation-user'
		if (asString(payload.role) === 'assistant') return 'conversation-assistant'
	}
	if (record.type === 'event_msg' && type === 'user_message') return 'conversation-user'
	if (record.type === 'event_msg' && type === 'agent_message') return 'conversation-assistant'
	if ((record.type === 'response_item' && (isToolCallType(type) || isToolOutputType(type))) || (record.type === 'event_msg' && TOOL_EVENT_TYPES.has(type ?? ''))) return 'conversation-tools'
	return
}

function recordFacts(record: CodexRecord, state: CompressionState, recordBytes: number): RecordFacts {
	const payload = recordPayload(record)
	const payloadType = asString(payload.type)
	const matches = new Map<SessionCompressionRuleId, RuleMatch>()
	addMatch(matches, 'record', 1, recordBytes)
	const conversation = conversationRule(record, payload)
	if (conversation) addMatch(matches, conversation, 1, recordBytes)

	if (record.type === 'compacted' && payload.replacement_history !== undefined) addMatch(matches, 'compaction-history', 1, jsonBytes(payload.replacement_history))
	if ((record.type === 'response_item' && payloadType === 'reasoning') || (record.type === 'event_msg' && payloadType === 'agent_reasoning')) addMatch(matches, 'reasoning', 1, recordBytes)

	if (record.type === 'event_msg' && (payloadType === 'user_message' || payloadType === 'agent_message')) {
		const message = asString(payload.message)
		const mirrored = Boolean(message && (payloadType === 'user_message' ? state.userMessages : state.assistantMessages).has(message))
		if (mirrored) {
			const fields = payloadType === 'user_message' ? ['message', 'images', 'local_images', 'text_elements'] : ['message', 'memory_citation']
			const present = fields.filter(field => payload[field] !== undefined)
			addMatch(matches, 'event-messages', present.length, present.reduce((total, field) => total + jsonBytes(payload[field]), 0))
		}
	}

	if (record.type === 'world_state' || (record.type === 'event_msg' && payloadType === 'thread_settings_applied')) addMatch(matches, 'runtime-snapshots', 1, recordBytes)
	if (record.type === 'turn_context') {
		const present = RUNTIME_CONTEXT_FIELDS.filter(field => payload[field] !== undefined)
		addMatch(matches, 'runtime-context', present.length, present.reduce((total, field) => total + jsonBytes(payload[field]), 0))
	}

	const internalFields = [...INTERNAL_FIELDS].filter(field => payload[field] !== undefined)
	addMatch(matches, 'internal-metadata', internalFields.length, internalFields.reduce((total, field) => total + jsonBytes(payload[field]), 0))

	let duplicateDeveloper = false
	if (record.type === 'response_item' && payloadType === 'message' && asString(payload.role) === 'developer') {
		const signature = JSON.stringify(payload.content ?? payload) ?? ''
		duplicateDeveloper = state.developerMessages.has(signature)
		state.developerMessages.add(signature)
		if (duplicateDeveloper) addMatch(matches, 'duplicate-records', 1, recordBytes)
	}

	let duplicateToken = false
	if (record.type === 'event_msg' && payloadType === 'token_count') {
		const total = tokenTotal(payload)
		duplicateToken = total !== undefined && total === state.previousTokenTotal
		if (total !== undefined) state.previousTokenTotal = total
		if (duplicateToken) addMatch(matches, 'duplicate-records', 1, recordBytes)
		if (payload.rate_limits !== undefined) addMatch(matches, 'rate-limits', 1, jsonBytes(payload.rate_limits))
	}

	if (isToolOutput(record, payload)) {
		const output = payload.output ?? payload.result
		const truncated = rewriteTree(output, 'truncate')
		addMatch(matches, 'tool-outputs', truncated.occurrences, truncated.candidateBytes)
	}

	const media = rewriteTree(record.type === 'compacted' ? { ...payload, replacement_history: undefined } : record, 'media')
	let mediaOccurrences = media.occurrences
	let mediaBytes = media.candidateBytes
	if (record.type === 'event_msg' && payloadType === 'image_generation_end' && typeof payload.result === 'string' && payload.result.length > 131_072 && !/^data:/i.test(payload.result)) {
		mediaOccurrences++
		mediaBytes += encoder.encode(payload.result).byteLength
	}
	addMatch(matches, 'inline-media', mediaOccurrences, mediaBytes)
	return { matches, duplicateDeveloper, duplicateToken }
}

function transformRecord(record: CodexRecord, facts: RecordFacts, selected: Set<SessionCompressionRuleId>) {
	const payload = recordPayload(record)
	const payloadType = asString(payload.type)
	if (selected.has('record')) return
	if (selected.has('conversation-user') && facts.matches.has('conversation-user')) return
	if (selected.has('conversation-assistant') && facts.matches.has('conversation-assistant')) return
	if (selected.has('conversation-tools') && facts.matches.has('conversation-tools')) return
	if (selected.has('reasoning') && facts.matches.has('reasoning')) return
	if (selected.has('runtime-snapshots') && facts.matches.has('runtime-snapshots')) return
	if (selected.has('duplicate-records') && (facts.duplicateDeveloper || facts.duplicateToken)) return

	let nextPayload: Record<string, unknown> = payload
	let changed = false
	const mutablePayload = () => {
		if (!changed) nextPayload = { ...payload }
		changed = true
		return nextPayload
	}

	if (selected.has('compaction-history') && record.type === 'compacted' && payload.replacement_history !== undefined) delete mutablePayload().replacement_history
	if (selected.has('event-messages') && facts.matches.has('event-messages') && record.type === 'event_msg') {
		const fields = payloadType === 'user_message' ? ['message', 'images', 'local_images', 'text_elements'] : payloadType === 'agent_message' ? ['message', 'memory_citation'] : []
		for (const field of fields) if (payload[field] !== undefined) delete mutablePayload()[field]
	}
	if (selected.has('runtime-context') && record.type === 'turn_context') for (const field of RUNTIME_CONTEXT_FIELDS) if (payload[field] !== undefined) delete mutablePayload()[field]
	if (selected.has('rate-limits') && record.type === 'event_msg' && payloadType === 'token_count' && payload.rate_limits !== undefined) delete mutablePayload().rate_limits

	if (selected.has('internal-metadata')) {
		for (const field of INTERNAL_FIELDS) if (nextPayload[field] !== undefined) delete mutablePayload()[field]
	}
	if (selected.has('inline-media')) {
		const result = rewriteTree(nextPayload, 'media')
		if (result.changed) {
			nextPayload = result.value as Record<string, unknown>
			changed = true
		}
		if (record.type === 'event_msg' && payloadType === 'image_generation_end' && typeof nextPayload.result === 'string' && nextPayload.result.length > 131_072 && !/^data:/i.test(nextPayload.result)) {
			nextPayload = { ...nextPayload, result: `[生成图片已裁剪，原始 ${encoder.encode(nextPayload.result).byteLength} 字节]` }
			changed = true
		}
	}
	if (selected.has('tool-outputs') && isToolOutput(record, nextPayload)) {
		const field = nextPayload.output !== undefined ? 'output' : nextPayload.result !== undefined ? 'result' : undefined
		if (field) {
			const result = rewriteTree(nextPayload[field], 'truncate')
			if (result.changed) {
				nextPayload = { ...nextPayload, [field]: result.value }
				changed = true
			}
		}
	}
	return changed ? { ...record, payload: nextPayload } : record
}

function accumulate(target: Map<SessionCompressionRuleId, SessionCompressionRuleStat>, facts: RecordFacts, selected?: Set<SessionCompressionRuleId>) {
	for (const [id, match] of facts.matches) {
		if (selected && !selected.has(id)) continue
		const stat = target.get(id) ?? { id, affectedRecords: 0, occurrences: 0, candidateBytes: 0 }
		stat.affectedRecords++
		stat.occurrences += match.occurrences
		stat.candidateBytes += match.candidateBytes
		target.set(id, stat)
	}
}

function orderedStats(stats: Map<SessionCompressionRuleId, SessionCompressionRuleStat>) {
	return RULE_IDS.map(id => stats.get(id) ?? { id, affectedRecords: 0, occurrences: 0, candidateBytes: 0 })
}

type ConversationBucket = { key: string; timestamp?: string; entries: RecordEnvelope[] }

const ACTION_RULE_ORDER: SessionCompressionRuleId[] = [
	'duplicate-records',
	'reasoning',
	'runtime-snapshots',
	'event-messages',
	'compaction-history',
	'runtime-context',
	'tool-outputs',
	'inline-media',
	'internal-metadata',
	'rate-limits',
	'conversation-user',
	'conversation-assistant',
	'conversation-tools',
	'record'
]
const DROP_RULES = new Set<SessionCompressionRuleId>(['record', 'conversation-user', 'conversation-assistant', 'conversation-tools', 'reasoning', 'runtime-snapshots', 'duplicate-records'])

function shortText(value: string, limit = 2000) {
	const normalized = value
		.replace(/data:((?:image|audio|video)\/[^;,]+)[^,]*;base64,[A-Za-z0-9+/=]+/gi, (_, type: string) => `[内嵌媒体 ${type}]`)
		.replace(/\s+/g, ' ')
		.trim()
	return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function valuePreview(value: unknown, depth = 0): string {
	if (value == null || depth > 2) return ''
	if (typeof value === 'string') return shortText(value)
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) return shortText(value.slice(0, 4).map(item => valuePreview(item, depth + 1)).filter(Boolean).join(' · '))
	const object = asObject(value)
	if (!object) return ''
	for (const key of ['text', 'message', 'content', 'output', 'cmd', 'command', 'query', 'path']) {
		const text = valuePreview(object[key], depth + 1)
		if (text) return text
	}
	return shortText(Object.entries(object).slice(0, 5).map(([key, child]) => `${key}: ${valuePreview(child, depth + 1) || '…'}`).join(' · '))
}

function recordKind(record: CodexRecord): SessionCompressionRecordKind {
	const payload = recordPayload(record)
	const type = asString(payload.type)
	if (record.type === 'response_item' && type === 'message') {
		const role = asString(payload.role)
		if (role === 'system') return 'system'
		if (role === 'developer') return 'developer'
		if (role === 'user') return 'user'
		if (role === 'assistant') return 'assistant'
	}
	if ((record.type === 'response_item' && type === 'reasoning') || (record.type === 'event_msg' && type === 'agent_reasoning')) return 'reasoning'
	if (record.type === 'response_item' && isToolOutputType(type)) return 'tool-result'
	if (record.type === 'response_item' && isToolCallType(type)) return 'tool-call'
	if (record.type === 'event_msg' && TOOL_EVENT_TYPES.has(type ?? '')) return 'tool-result'
	if (record.type === 'event_msg' && type === 'user_message') return 'user'
	if (record.type === 'event_msg' && type === 'agent_message') return 'assistant'
	if (record.type === 'event_msg' && type === 'token_count') return 'token'
	if (record.type === 'turn_context' || record.type === 'world_state' || type === 'thread_settings_applied') return 'context'
	if (record.type === 'session_meta') return 'metadata'
	if (record.type === 'compacted') return 'compaction'
	if (record.type === 'event_msg') return 'event'
	return 'unknown'
}

function recordLabel(record: CodexRecord, sequence: number, kind: SessionCompressionRecordKind, toolNames: Map<string, string>) {
	const payload = recordPayload(record)
	const type = asString(payload.type)
	const callId = toolCallId(payload, sequence)
	const toolName = asString(payload.name) ?? (callId ? toolNames.get(callId) : undefined)
	if (kind === 'tool-call') return toolName ? `工具调用 · ${toolName}` : '工具调用'
	if (kind === 'tool-result') return toolName ? `工具结果 · ${toolName}` : `工具结果 · ${type ?? record.type}`
	const labels: Record<SessionCompressionRecordKind, string> = {
		system: '系统提示', developer: '开发者指令', user: '用户消息', assistant: '助手回复', reasoning: 'AI 思考',
		'tool-call': '工具调用', 'tool-result': '工具结果', context: '运行上下文', token: 'Token 统计', event: `事件 · ${type ?? record.type}`,
		metadata: 'Session 元数据', compaction: '上下文压缩', unknown: `${record.type}${type ? ` · ${type}` : ''}`, invalid: '无法解析'
	}
	return labels[kind]
}

function recordPreview(record: CodexRecord, kind: SessionCompressionRecordKind) {
	const payload = recordPayload(record)
	if (kind === 'user' || kind === 'assistant' || kind === 'system' || kind === 'developer') return shortText(extractText(payload.content ?? payload.message)) || '空消息'
	if (kind === 'reasoning') {
		const text = shortText(extractText(payload.summary ?? payload.content ?? payload.text))
		return text || (payload.encrypted_content ? `加密思考内容 · ${formatByteLabel(jsonBytes(payload.encrypted_content))}` : '思考记录')
	}
	if (kind === 'tool-call') return valuePreview(payload.arguments ?? payload.input ?? payload.params) || asString(payload.name) || '无参数'
	if (kind === 'tool-result') return valuePreview(payload.output ?? payload.result) || asString(payload.call_id) || asString(payload.id) || '无结果正文'
	if (kind === 'token') {
		const usage = asObject(asObject(payload.info)?.total_token_usage)
		return usage ? `总计 ${asNumber(usage.total_tokens)?.toLocaleString('zh-CN') ?? '—'} · Output ${asNumber(usage.output_tokens)?.toLocaleString('zh-CN') ?? '—'} · Reasoning ${asNumber(usage.reasoning_output_tokens)?.toLocaleString('zh-CN') ?? '—'}` : 'Token 状态记录'
	}
	if (kind === 'context' || kind === 'metadata') {
		return [asString(payload.cwd), asString(payload.model), asString(payload.turn_id), asString(payload.id)].filter(Boolean).join(' · ') || valuePreview(payload)
	}
	if (kind === 'compaction') return shortText(extractText(payload.message ?? payload.summary)) || `replacement_history ${Array.isArray(payload.replacement_history) ? payload.replacement_history.length : 0} 项`
	return valuePreview(payload) || '无可预览正文'
}

function formatByteLabel(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function recordActions(sequence: number, facts: RecordFacts): SessionCompressionAction[] {
	const matched = ACTION_RULE_ORDER.filter(id => id !== 'record' && facts.matches.has(id))
	const defaultDrop = matched.find(id => DROP_RULES.has(id) && SESSION_COMPRESSION_RULES.find(rule => rule.id === id)?.defaultSelected)
	const hasSpecificDrop = matched.some(id => DROP_RULES.has(id))
	const ruleIds = defaultDrop ? [defaultDrop] : [...matched, ...(hasSpecificDrop ? [] : ['record' as const])]
	return ruleIds.map(ruleId => {
		const rule = SESSION_COMPRESSION_RULES.find(item => item.id === ruleId)!
		return {
			id: `record-${sequence}:${ruleId}`,
			label: rule.label,
			description: rule.description,
			candidateBytes: facts.matches.get(ruleId)?.candidateBytes ?? 0,
			defaultSelected: rule.defaultSelected,
			dropsRecord: DROP_RULES.has(ruleId),
			selection: { ruleId, sequence }
		}
	})
}

function buildConversationTurns(envelopes: RecordEnvelope[], factsBySequence: Map<number, RecordFacts>): SessionCompressionTurn[] {
	const toolNames = new Map<string, string>()
	for (const envelope of envelopes) {
		if (!envelope.record) continue
		const payload = recordPayload(envelope.record)
		const callId = toolCallId(payload, envelope.sequence)
		const name = asString(payload.name)
		if (callId && name) toolNames.set(callId, name)
	}

	const buckets = new Map<string, ConversationBucket>()
	let currentTurnId: string | undefined
	let syntheticTurn = 0
	for (const envelope of envelopes) {
		const record = envelope.record
		if (record) {
			const payload = recordPayload(record)
			const type = asString(payload.type)
			if (record.type === 'turn_context') currentTurnId = asString(payload.turn_id) ?? currentTurnId ?? `turn-${++syntheticTurn}`
			else if (record.type === 'event_msg' && type === 'task_started') currentTurnId = asString(payload.turn_id) ?? currentTurnId ?? `turn-${++syntheticTurn}`
			else if (!currentTurnId && ((record.type === 'event_msg' && type === 'user_message') || (record.type === 'response_item' && type === 'message' && asString(payload.role) === 'user'))) currentTurnId = `turn-${++syntheticTurn}`
		}
		const key = currentTurnId ?? '__session__'
		let bucket = buckets.get(key)
		if (!bucket) {
			bucket = { key, timestamp: record?.timestamp, entries: [] }
			buckets.set(key, bucket)
		}
		bucket.entries.push(envelope)
	}

	let turnNumber = 0
	return [...buckets.values()].map(bucket => {
		const records: SessionCompressionRecord[] = bucket.entries.map(envelope => {
			const byteSize = Math.max(envelope.sourceRef.byteEnd - envelope.sourceRef.byteStart, 0)
			if (!envelope.record) return {
				id: `record-${envelope.sequence}`,
				label: '无法解析的 JSONL 记录',
				detail: envelope.parseError ?? '原始行将在输出中保留',
				byteSize,
				kind: 'invalid',
				line: envelope.sourceRef.line,
				actions: []
			} satisfies SessionCompressionRecord
			const facts = factsBySequence.get(envelope.sequence)!
			const kind = recordKind(envelope.record)
			return {
				id: `record-${envelope.sequence}`,
				label: recordLabel(envelope.record, envelope.sequence, kind, toolNames),
				detail: recordPreview(envelope.record, kind),
				timestamp: envelope.record.timestamp,
				byteSize,
				kind,
				recordType: envelope.record.type,
				payloadType: asString(recordPayload(envelope.record).type),
				line: envelope.sourceRef.line,
				actions: recordActions(envelope.sequence, facts)
			} satisfies SessionCompressionRecord
		})
		const label = bucket.key === '__session__' ? 'Session 初始化' : `回合 #${++turnNumber}`
		const user = records.find(record => record.kind === 'user')
		return {
			id: bucket.key,
			label,
			detail: user?.detail || (bucket.key === '__session__' ? '系统提示、Session 元数据与初始化记录' : bucket.key),
			timestamp: bucket.timestamp,
			recordCount: records.length,
			byteSize: records.reduce((total, record) => total + record.byteSize, 0),
			records
		} satisfies SessionCompressionTurn
	})
}

export function scanSessionCompression(envelopes: RecordEnvelope[], sourceBytes: number): SessionCompressionScan {
	const state = createState(envelopes)
	const stats = new Map<SessionCompressionRuleId, SessionCompressionRuleStat>()
	const factsBySequence = new Map<number, RecordFacts>()
	for (const envelope of envelopes) {
		if (!envelope.record) continue
		const facts = recordFacts(envelope.record, state, envelope.sourceRef.byteEnd - envelope.sourceRef.byteStart)
		factsBySequence.set(envelope.sequence, facts)
		accumulate(stats, facts)
	}
	return {
		sourceBytes,
		recordCount: envelopes.length,
		invalidRecords: envelopes.filter(envelope => !envelope.record).length,
		rules: orderedStats(stats),
		turns: buildConversationTurns(envelopes, factsBySequence)
	}
}

export function compressSessionRecords(envelopes: RecordEnvelope[], sourceBytes: number, selections: SessionCompressionSelection[]) {
	const selectedBySequence = new Map<number, Set<SessionCompressionRuleId>>()
	for (const selection of selections) {
		const rules = selectedBySequence.get(selection.sequence) ?? new Set<SessionCompressionRuleId>()
		rules.add(selection.ruleId)
		selectedBySequence.set(selection.sequence, rules)
	}
	const state = createState(envelopes)
	const stats = new Map<SessionCompressionRuleId, SessionCompressionRuleStat>()
	const records: RecordEnvelope[] = []
	const rewrittenSequences = new Set<number>()
	let droppedRecords = 0
	let rewrittenRecords = 0
	for (const envelope of envelopes) {
		if (!envelope.record) {
			records.push(envelope)
			continue
		}
		const facts = recordFacts(envelope.record, state, envelope.sourceRef.byteEnd - envelope.sourceRef.byteStart)
		const selected = selectedBySequence.get(envelope.sequence) ?? new Set<SessionCompressionRuleId>()
		accumulate(stats, facts, selected)
		const record = transformRecord(envelope.record, facts, selected)
		if (!record) {
			droppedRecords++
			continue
		}
		if (record !== envelope.record) {
			rewrittenRecords++
			rewrittenSequences.add(envelope.sequence)
		}
		records.push({ ...envelope, record })
	}
	const report: SessionCompressionReport = {
		sourceBytes,
		outputBytes: 0,
		sourceRecords: envelopes.length,
		outputRecords: records.length + 1,
		droppedRecords,
		rewrittenRecords,
		invalidRecords: envelopes.filter(envelope => !envelope.record).length,
		rules: orderedStats(stats)
	}
	return { records, report, rewrittenSequences }
}
