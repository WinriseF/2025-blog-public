import { decodeExecSource, type ExecDecodeResult } from './exec-parser'
import { asBoolean, asNumber, asObject, asString, extractText, recordPayload, type RecordEnvelope } from './record-utils'
import {
	appendSourceRef,
	ContinuationIndex,
	isCommandTool,
	isContinuationTool,
	parseToolResult,
	toolCallId,
	toolCallInput,
	toolLeafName,
	toolResultValue
} from './tool-record'
import type {
	EventStatus,
	MetricSource,
	RequestActivity,
	SessionActivity,
	SessionActivityMetrics,
	SessionActivityRequestSummary,
	SessionActivitySummary,
	SessionPerformance,
	SessionTokenUsage,
	ToolActivity,
	ToolActivityCategory,
	ToolCategoryMetrics
} from './types'

type MutableTool = ToolActivity & { continuationTargetId?: string; nestedIds: string[] }
type PendingResult = { envelope: RecordEnvelope; value: unknown }
type SegmentState = { reasoningItems: number; assistantMessages: number; startedAt?: string }
type ToolInterval = { start: number; end: number }
type MetricTool = Pick<ToolActivity, 'id' | 'executionId' | 'logical' | 'sequence' | 'startedAt' | 'endedAt' | 'durationMs' | 'turnId'>
type MetricRequest = Pick<RequestActivity, 'sequence' | 'startedAt' | 'timestamp' | 'reasoningOutputTokens' | 'visibleOutputTokens' | 'toolCallCount' | 'toolExecutionCount' | 'timedToolExecutionCount' | 'toolDurationMs'> & { toolCallIds?: string[] }
type SummaryTool = MetricTool & {
	callId?: string
	continuationTargetId?: string
	name: string
	category: ToolActivityCategory
	status: EventStatus
}

const TOOL_CALL_TYPES = new Set(['function_call', 'custom_tool_call', 'local_shell_call'])
const TOOL_OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output'])

function timestampMs(value?: string) {
	if (!value) return
	const time = new Date(value).getTime()
	return Number.isFinite(time) ? time : undefined
}

function timestampBefore(value: string | undefined, durationMs: number) {
	const end = timestampMs(value)
	return end === undefined ? undefined : new Date(end - durationMs).toISOString()
}

export function normalizeToolName(name: string) {
	return toolLeafName(name)
}

export function toolActivityCategory(name: string, forced?: ToolActivityCategory): ToolActivityCategory {
	if (forced) return forced
	const lower = name.toLowerCase()
	const leaf = normalizeToolName(name)
	if (lower.includes('mcp__') || lower.startsWith('mcp:')) return 'mcp'
	if (['exec_command', 'shell_command', 'local_shell_call', 'write_stdin', 'wait', 'poll'].includes(leaf)) return 'shell'
	if (['apply_patch', 'read_file', 'write_file', 'edit_file', 'view_image', 'read_mcp_resource'].includes(leaf) || /(?:file|patch|image)/.test(leaf)) return 'file'
	if (lower.includes('web__') || /(?:web|browser|firecrawl|search_query)/.test(leaf)) return 'web'
	if (['update_plan', 'create_goal', 'update_goal', 'get_goal'].includes(leaf)) return 'planning'
	if (['request_user_input'].includes(leaf)) return 'interaction'
	if (/(?:agent|message|followup|interrupt)/.test(leaf)) return 'collaboration'
	return 'other'
}

function explicitDurationMs(value: unknown, depth = 0): number | undefined {
	if (depth > 5 || value == null) return
	if (Array.isArray(value)) {
		for (const item of value) {
			const duration = explicitDurationMs(item, depth + 1)
			if (duration !== undefined) return duration
		}
		return
	}
	const object = asObject(value)
	if (!object) return
	const seconds = asNumber(object.wall_time_seconds) ?? asNumber(object.wallTimeSeconds)
	if (seconds !== undefined && seconds >= 0) return seconds * 1000
	for (const child of Object.values(object)) {
		const duration = explicitDurationMs(child, depth + 1)
		if (duration !== undefined) return duration
	}
	return
}

function recordedDurationMs(value: unknown) {
	const explicit = explicitDurationMs(value)
	if (explicit !== undefined) return explicit
	const text = extractText(value)
	const seconds = Number(text.match(/\bWall time\s+([0-9]+(?:\.[0-9]+)?)\s+seconds?\b/i)?.[1] ?? Number.NaN)
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

function durationObjectMs(value: unknown) {
	const object = asObject(value)
	if (!object) return
	const seconds = asNumber(object.secs) ?? 0
	const nanos = asNumber(object.nanos) ?? 0
	const duration = seconds * 1000 + nanos / 1_000_000
	return duration >= 0 ? duration : undefined
}

function eventStatus(payload: Record<string, unknown>, inspectText = true): EventStatus {
	const exitCode = asNumber(payload.exit_code) ?? asNumber(payload.exitCode)
	if (exitCode !== undefined) return exitCode === 0 ? 'completed' : 'failed'
	const success = asBoolean(payload.success)
	if (success !== undefined) return success ? 'completed' : 'failed'
	return parseToolResult(payload, inspectText).status
}

function intervalFor(tool: Pick<MetricTool, 'startedAt' | 'endedAt' | 'durationMs'>): ToolInterval | undefined {
	const end = timestampMs(tool.endedAt)
	const start = timestampMs(tool.startedAt)
	if (end !== undefined && tool.durationMs !== undefined) return { start: end - tool.durationMs, end }
	if (start !== undefined && end !== undefined && end >= start) return { start, end }
	return
}

function unionDuration(intervals: ToolInterval[], clipStart?: number, clipEnd?: number) {
	const normalized = intervals
		.map(interval => ({ start: Math.max(interval.start, clipStart ?? interval.start), end: Math.min(interval.end, clipEnd ?? interval.end) }))
		.filter(interval => interval.end >= interval.start)
		.sort((left, right) => left.start - right.start || left.end - right.end)
	let total = 0
	let current: ToolInterval | undefined
	for (const interval of normalized) {
		if (!current) current = { ...interval }
		else if (interval.start <= current.end) current.end = Math.max(current.end, interval.end)
		else {
			total += current.end - current.start
			current = { ...interval }
		}
	}
	return total + (current ? current.end - current.start : 0)
}

function preferredUnitTool<T extends Pick<MetricTool, 'logical' | 'durationMs'>>(tools: T[]) {
	const logical = tools.filter(tool => tool.logical)
	return (logical.length === 1 ? logical[0] : undefined)?.durationMs !== undefined ? logical[0]
		: tools.find(tool => !tool.logical && tool.durationMs !== undefined)
		?? tools.find(tool => tool.durationMs !== undefined)
		?? tools.find(tool => !tool.logical)
		?? tools[0]
}

function executionUnitMap(tools: MetricTool[]) {
	const units = new Map<string, MetricTool[]>()
	for (const tool of tools) {
		const unit = units.get(tool.executionId)
		if (unit) unit.push(tool)
		else units.set(tool.executionId, [tool])
	}
	return units
}

function assignToolsToRequests(requests: MetricRequest[], tools: MetricTool[]) {
	const executionUnits = executionUnitMap(tools)
	const unitMetrics = new Map([...executionUnits].map(([id, unit]) => [id, {
		logical: unit.some(tool => tool.logical),
		preferred: preferredUnitTool(unit)
	}]))
	let toolIndex = 0
	for (const request of requests) {
		const requestTools: MetricTool[] = []
		while (toolIndex < tools.length && tools[toolIndex].sequence <= request.sequence) requestTools.push(tools[toolIndex++])
		const logical = requestTools.filter(tool => tool.logical)
		const executions = [...new Set(requestTools.map(tool => tool.executionId))]
			.flatMap(id => unitMetrics.get(id)?.logical ? [unitMetrics.get(id)!] : [])
		const timed = executions.map(unit => unit.preferred).filter(tool => tool?.durationMs !== undefined)
		if (request.toolCallIds) request.toolCallIds = logical.map(tool => tool.id)
		request.toolCallCount = logical.length
		request.toolExecutionCount = executions.length
		request.timedToolExecutionCount = timed.length
		request.toolDurationMs = unionDuration(
			timed.flatMap(tool => {
				const interval = intervalFor(tool)
				return interval ? [interval] : []
			}),
			timestampMs(request.startedAt),
			timestampMs(request.timestamp)
		)
	}
}

function activityMetrics(requests: MetricRequest[], tools: MetricTool[], performance: SessionPerformance): SessionActivityMetrics {
	const executionUnits = executionUnitMap(tools)
	const unitTools = [...executionUnits.values()].filter(unit => unit.some(tool => tool.logical)).map(preferredUnitTool)
	const timedUnitTools = unitTools.filter(tool => tool.durationMs !== undefined && intervalFor(tool))
	const intervalsByTurn = new Map<string, ToolInterval[]>()
	for (const tool of timedUnitTools) {
		const interval = intervalFor(tool)
		if (!interval) continue
		const key = tool.turnId ?? '__unknown_turn__'
		const intervals = intervalsByTurn.get(key)
		if (intervals) intervals.push(interval)
		else intervalsByTurn.set(key, [interval])
	}
	const toolDurationMs = [...intervalsByTurn.values()].reduce((total, intervals) => total + unionDuration(intervals), 0)
	const observedDurationMs = performance.turns.reduce((total, turn) => {
		if (turn.durationMs !== undefined) return total + turn.durationMs
		const start = timestampMs(turn.startedAt)
		const end = timestampMs(turn.endedAt)
		return total + (start !== undefined && end !== undefined && end >= start ? end - start : 0)
	}, 0)
	const reasoningOutputTokens = requests.reduce((total, request) => total + request.reasoningOutputTokens, 0)
	const visibleOutputTokens = requests.reduce((total, request) => total + request.visibleOutputTokens, 0)
	const outputTokens = reasoningOutputTokens + visibleOutputTokens
	const logicalTools = tools.filter(tool => tool.logical)
	const toolRequestCount = requests.filter(request => request.toolCallCount > 0).length
	const toolExecutionCount = new Set(logicalTools.map(tool => tool.executionId)).size
	const timedExecutionIds = new Set(timedUnitTools.map(tool => tool.executionId))
	return {
		requestCount: requests.length,
		reasoningOutputTokens,
		visibleOutputTokens,
		reasoningShareOfOutput: outputTokens ? reasoningOutputTokens / outputTokens : undefined,
		toolRequestCount,
		toolRequestRate: requests.length ? toolRequestCount / requests.length : undefined,
		logicalToolCallCount: logicalTools.length,
		toolExecutionCount,
		timedToolExecutionCount: timedExecutionIds.size,
		toolDurationMs,
		toolTimeCoverage: toolExecutionCount ? timedExecutionIds.size / toolExecutionCount : undefined,
		observedDurationMs,
		toolTimeShare: observedDurationMs ? Math.min(toolDurationMs / observedDurationMs, 1) : undefined,
		nonToolDurationMs: Math.max(observedDurationMs - toolDurationMs, 0)
	}
}

function buildCategoryMetrics(tools: ToolActivity[]): ToolCategoryMetrics[] {
	const categories = new Map<ToolActivityCategory, ToolCategoryMetrics>()
	for (const tool of tools) {
		if (!tool.logical) continue
		const bucket = categories.get(tool.category) ?? {
			category: tool.category,
			callCount: 0,
			completedCount: 0,
			failedCount: 0,
			unknownCount: 0,
			timedCallCount: 0,
			durationMs: 0
		}
		bucket.callCount++
		if (tool.status === 'completed') bucket.completedCount++
		else if (tool.status === 'failed' || tool.status === 'interrupted') bucket.failedCount++
		else bucket.unknownCount++
		if (tool.durationMs !== undefined) {
			bucket.timedCallCount++
			bucket.durationMs += tool.durationMs
		}
		categories.set(tool.category, bucket)
	}
	return [...categories.values()].sort((left, right) => right.callCount - left.callCount || right.durationMs - left.durationMs)
}

export function buildSessionActivity(
	envelopes: RecordEnvelope[],
	usage: SessionTokenUsage,
	performance: SessionPerformance,
	options: { decodeExec?: boolean; inspectToolResults?: boolean; execDecodes?: Map<string, ExecDecodeResult> } = {}
): SessionActivity {
	const tools: MutableTool[] = []
	const byCallId = new Map<string, MutableTool>()
	const byId = new Map<string, MutableTool>()
	const pendingResults = new Map<string, PendingResult[]>()
	const sampleBySequence = new Map(usage.samples.map(sample => [sample.sequence, sample]))
	const segments = new Map<string, SegmentState>()
	const requests: RequestActivity[] = []
	const continuations = new ContinuationIndex<MutableTool>()
	let currentTurnId: string | undefined

	const segmentKey = (turnId?: string) => turnId ?? '__unknown_turn__'
	const getSegment = (turnId = currentTurnId) => {
		const key = segmentKey(turnId)
		let segment = segments.get(key)
		if (!segment) {
			segment = { reasoningItems: 0, assistantMessages: 0 }
			segments.set(key, segment)
		}
		return segment
	}

	const register = (tool: MutableTool) => {
		tools.push(tool)
		byId.set(tool.id, tool)
		if (tool.callId) byCallId.set(tool.callId, tool)
		if (tool.logical && isCommandTool(tool.name)) continuations.add(tool)
		return tool
	}

	const applyTiming = (tool: MutableTool, endedAt: string | undefined, durationMs: number | undefined, durationSource: MetricSource) => {
		if (durationMs === undefined && tool.durationSource === 'recorded') return
		tool.endedAt = endedAt ?? tool.endedAt
		if (durationMs !== undefined) {
			tool.durationMs = durationMs
			tool.durationSource = durationSource
			tool.startedAt = timestampBefore(tool.endedAt, durationMs) ?? tool.startedAt
			return
		}
		const start = timestampMs(tool.startedAt)
		const end = timestampMs(tool.endedAt)
		if (start !== undefined && end !== undefined && end >= start) {
			tool.durationMs = end - start
			tool.durationSource = 'correlated'
		}
	}

	const applyContinuationResult = (tool: MutableTool, result: ReturnType<typeof parseToolResult>, envelope: RecordEnvelope) => {
		tool.status = result.status
		appendSourceRef(tool.sourceRefs, envelope.sourceRef)
		tool.endedAt = envelope.record?.timestamp ?? tool.endedAt
		const start = timestampMs(tool.startedAt)
		const end = timestampMs(tool.endedAt)
		if (start !== undefined && end !== undefined && end >= start) {
			tool.durationMs = end - start
			tool.durationSource = 'correlated'
		}
		continuations.remember(tool, result)
	}

	const applyResult = (tool: MutableTool, result: PendingResult) => {
		const parsed = parseToolResult(result.value, options.inspectToolResults !== false)
		tool.status = parsed.status
		appendSourceRef(tool.sourceRefs, result.envelope.sourceRef)
		applyTiming(tool, result.envelope.record?.timestamp, options.inspectToolResults === false ? undefined : recordedDurationMs(result.value), 'recorded')
		let executionTool = tool
		if (tool.nestedIds.length === 1) {
			const nested = byId.get(tool.nestedIds[0])
			if (nested) {
				nested.status = tool.status
				appendSourceRef(nested.sourceRefs, result.envelope.sourceRef)
				applyTiming(nested, tool.endedAt, tool.durationMs, tool.durationSource ?? 'correlated')
				executionTool = nested
			}
		} else if (tool.nestedIds.length > 1) {
			for (const nestedId of tool.nestedIds) {
				const nested = byId.get(nestedId)
				if (!nested) continue
				nested.status = 'unknown'
				appendSourceRef(nested.sourceRefs, result.envelope.sourceRef)
				nested.endedAt = tool.endedAt
			}
		}
		if (executionTool.logical && isCommandTool(executionTool.name)) continuations.remember(executionTool, parsed)
		const continuationTarget = executionTool.continuationTargetId ? byId.get(executionTool.continuationTargetId) : undefined
		if (continuationTarget) applyContinuationResult(continuationTarget, parsed, result.envelope)
	}

	const flushPending = (callId: string) => {
		const tool = byCallId.get(callId)
		if (!tool) return
		for (const result of pendingResults.get(callId) ?? []) applyResult(tool, result)
		pendingResults.delete(callId)
	}

	const registerCall = (envelope: RecordEnvelope, payload: Record<string, unknown>, itemType: string) => {
		const callId = toolCallId(payload, envelope.sequence)
		const name = asString(payload.name) ?? itemType
		const input = toolCallInput(payload, itemType)
		const continuation = isContinuationTool(name)
		const continuationTarget = continuation ? continuations.resolve(input, currentTurnId) : undefined
		const outer = register({
			id: `tool-${callId}`,
			executionId: continuationTarget?.executionId ?? callId,
			sequence: envelope.sequence,
			callId,
			continuationTargetId: continuationTarget?.id,
			turnId: currentTurnId,
			name,
			normalizedName: normalizeToolName(name),
			category: toolActivityCategory(name),
			origin: 'direct',
			logical: !continuation,
			status: 'pending',
			startedAt: envelope.record?.timestamp,
			sourceRefs: [envelope.sourceRef],
			nestedIds: []
		})

		if (itemType === 'custom_tool_call' && name.toLowerCase() === 'exec' && typeof input === 'string' && options.decodeExec !== false) {
			const decoded = options.execDecodes?.get(callId) ?? decodeExecSource(input, callId)
			if (decoded.calls.length) {
				outer.logical = false
				for (const decodedCall of decoded.calls) {
					const nestedInput = decodedCall.input ?? decodedCall.inputSource
					const nestedContinuationTarget = isContinuationTool(decodedCall.name) ? continuations.resolve(nestedInput, currentTurnId) : undefined
					const nested = register({
						id: `tool-${decodedCall.id}`,
						executionId: nestedContinuationTarget?.executionId ?? callId,
						sequence: envelope.sequence + (decodedCall.ordinal + 1) / 1000,
						callId: decodedCall.id,
						parentCallId: callId,
						continuationTargetId: nestedContinuationTarget?.id,
						turnId: currentTurnId,
						name: decodedCall.name,
						normalizedName: normalizeToolName(decodedCall.name),
						category: toolActivityCategory(decodedCall.name),
						origin: 'exec-nested',
						logical: !isContinuationTool(decodedCall.name),
						status: 'pending',
						startedAt: envelope.record?.timestamp,
						sourceRefs: [envelope.sourceRef],
						nestedIds: []
					})
					outer.nestedIds.push(nested.id)
					if (decoded.calls.length === 1 && nestedContinuationTarget) {
						outer.executionId = nestedContinuationTarget.executionId
						outer.continuationTargetId = nestedContinuationTarget.id
					}
				}
			}
		}
		flushPending(callId)
	}

	const registerResult = (envelope: RecordEnvelope, payload: Record<string, unknown>) => {
		const callId = toolCallId(payload, envelope.sequence)
		const result = { envelope, value: toolResultValue(payload) }
		const tool = byCallId.get(callId)
		if (tool) applyResult(tool, result)
		else pendingResults.set(callId, [...(pendingResults.get(callId) ?? []), result])
	}

	const updateFromEvent = (
		envelope: RecordEnvelope,
		payload: Record<string, unknown>,
		name: string,
		category: ToolActivityCategory,
		durationMs?: number
	) => {
		const callId = asString(payload.call_id)
		let tool = callId ? byCallId.get(callId) : undefined
		if (!tool && category === 'web') tool = tools.findLast(item => item.category === 'web' && item.durationMs === undefined && (item.status === 'pending' || item.origin === 'direct'))
		if (!tool) {
			const id = callId ?? `event-${name}-${envelope.sequence}`
			tool = register({
				id: `tool-${id}`,
				executionId: id,
				sequence: envelope.sequence,
				callId,
				turnId: asString(payload.turn_id) ?? currentTurnId,
				name,
				normalizedName: normalizeToolName(name),
				category,
				origin: 'event',
				logical: true,
				status: eventStatus(payload, options.inspectToolResults !== false),
				endedAt: envelope.record?.timestamp,
				sourceRefs: [envelope.sourceRef],
				nestedIds: []
			})
		} else {
			tool.status = eventStatus(payload, options.inspectToolResults !== false)
			appendSourceRef(tool.sourceRefs, envelope.sourceRef)
		}
		applyTiming(tool, envelope.record?.timestamp, durationMs, durationMs === undefined ? 'correlated' : 'recorded')
		if (tool.nestedIds.length === 1) {
			const nested = byId.get(tool.nestedIds[0])
			if (nested) {
				nested.status = tool.status
				appendSourceRef(nested.sourceRefs, envelope.sourceRef)
				applyTiming(nested, tool.endedAt, tool.durationMs, tool.durationSource ?? 'correlated')
			}
		}
	}

	for (const envelope of envelopes) {
		const record = envelope.record
		if (!record) continue
		const payload = recordPayload(record)
		const itemType = asString(payload.type)

		if (record.type === 'turn_context') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			const segment = getSegment()
			segment.startedAt ??= record.timestamp
			continue
		}

		if (record.type === 'response_item') {
			if (itemType === 'message') {
				const role = asString(payload.role)
				if (role === 'user') getSegment().startedAt = record.timestamp ?? getSegment().startedAt
				else if (role === 'assistant') getSegment().assistantMessages++
			} else if (itemType === 'reasoning') getSegment().reasoningItems++

			if (itemType && TOOL_CALL_TYPES.has(itemType)) registerCall(envelope, payload, itemType)
			else if (itemType && TOOL_OUTPUT_TYPES.has(itemType)) registerResult(envelope, payload)
			else if (itemType === 'tool_search_call') {
				registerCall(envelope, { ...payload, name: 'tool_search' }, itemType)
			} else if (itemType === 'tool_search_output') registerResult(envelope, payload)
			else if (itemType === 'web_search_call') {
				register({
					id: `tool-web-search-${envelope.sequence}`,
					executionId: `web-search-${envelope.sequence}`,
					sequence: envelope.sequence,
					turnId: currentTurnId,
					name: 'web_search',
					normalizedName: 'web_search',
					category: 'web',
					origin: 'direct',
					logical: true,
					status: parseToolResult(payload).status,
					endedAt: record.timestamp,
					sourceRefs: [envelope.sourceRef],
					nestedIds: []
				})
			}
			continue
		}

		if (record.type !== 'event_msg') continue
		if (itemType === 'task_started') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			getSegment().startedAt ??= asString(payload.started_at) ?? record.timestamp
		} else if (itemType === 'user_message') getSegment().startedAt = record.timestamp ?? getSegment().startedAt
		else if (itemType === 'exec_command_end') updateFromEvent(envelope, payload, 'exec_command', 'shell', durationObjectMs(payload.duration))
		else if (itemType === 'mcp_tool_call_end') {
			const invocation = asObject(payload.invocation)
			const name = [asString(invocation?.server), asString(invocation?.tool)].filter(Boolean).join('/') || 'mcp_tool'
			updateFromEvent(envelope, payload, name, 'mcp', durationObjectMs(payload.duration))
		} else if (itemType === 'web_search_end') updateFromEvent(envelope, payload, 'web_search', 'web')
		else if (itemType === 'patch_apply_end') updateFromEvent(envelope, payload, 'apply_patch', 'file')

		const sample = sampleBySequence.get(envelope.sequence)
		if (!sample) continue
		const key = segmentKey(sample.turnId ?? currentTurnId)
		const segment = segments.get(key) ?? { reasoningItems: 0, assistantMessages: 0 }
		const outputTokens = sample.output
		const reasoningOutputTokens = sample.reasoningOutput
		requests.push({
			id: `request-${sample.id}`,
			tokenSampleId: sample.id,
			sequence: sample.sequence,
			timestamp: sample.timestamp,
			startedAt: segment.startedAt,
			turnId: sample.turnId ?? currentTurnId,
			cwd: sample.cwd,
			model: sample.model,
			totalTokens: sample.total,
			outputTokens,
			reasoningOutputTokens,
			visibleOutputTokens: Math.max(outputTokens - reasoningOutputTokens, 0),
			reasoningShareOfOutput: outputTokens ? reasoningOutputTokens / outputTokens : undefined,
			spanMs: (() => {
				const start = timestampMs(segment.startedAt)
				const end = timestampMs(sample.timestamp)
				return start !== undefined && end !== undefined && end >= start ? end - start : undefined
			})(),
			reasoningItemCount: segment.reasoningItems,
			assistantMessageCount: segment.assistantMessages,
			toolCallIds: [],
			toolCallCount: 0,
			toolExecutionCount: 0,
			timedToolExecutionCount: 0,
			toolDurationMs: 0,
			sourceRef: sample.sourceRef
		})
		segments.set(key, { reasoningItems: 0, assistantMessages: 0, startedAt: sample.timestamp })
	}

	for (const tool of tools) if (tool.status === 'pending' || tool.status === 'running') tool.status = 'unknown'
	assignToolsToRequests(requests, tools)

	return {
		requests,
		tools: tools.map(({ continuationTargetId: _, nestedIds: __, ...tool }) => tool),
		categories: buildCategoryMetrics(tools),
		metrics: activityMetrics(requests, tools, performance)
	}
}

export function buildSessionActivitySummary(
	envelopes: RecordEnvelope[],
	usage: SessionTokenUsage,
	performance: SessionPerformance
): SessionActivitySummary {
	const tools: SummaryTool[] = []
	const byCallId = new Map<string, SummaryTool>()
	const byId = new Map<string, SummaryTool>()
	const pendingResults = new Map<string, PendingResult[]>()
	const sampleBySequence = new Map(usage.samples.map(sample => [sample.sequence, sample]))
	const segmentStarts = new Map<string, string | undefined>()
	const requests: SessionActivityRequestSummary[] = []
	const continuations = new ContinuationIndex<SummaryTool>()
	let currentTurnId: string | undefined

	const segmentKey = (turnId?: string) => turnId ?? '__unknown_turn__'
	const register = (tool: SummaryTool) => {
		tools.push(tool)
		byId.set(tool.id, tool)
		if (tool.callId) byCallId.set(tool.callId, tool)
		if (tool.logical && isCommandTool(tool.name)) continuations.add(tool)
		return tool
	}
	const applyTiming = (tool: SummaryTool, endedAt: string | undefined, durationMs?: number) => {
		tool.endedAt = endedAt ?? tool.endedAt
		if (durationMs !== undefined) {
			tool.durationMs = durationMs
			tool.startedAt = timestampBefore(tool.endedAt, durationMs) ?? tool.startedAt
			return
		}
		const start = timestampMs(tool.startedAt)
		const end = timestampMs(tool.endedAt)
		if (start !== undefined && end !== undefined && end >= start) tool.durationMs = end - start
	}
	const applyContinuation = (target: SummaryTool, parsed: ReturnType<typeof parseToolResult>, envelope: RecordEnvelope) => {
		target.status = parsed.status
		target.endedAt = envelope.record?.timestamp ?? target.endedAt
		const start = timestampMs(target.startedAt)
		const end = timestampMs(target.endedAt)
		if (start !== undefined && end !== undefined && end >= start) target.durationMs = end - start
		continuations.remember(target, parsed)
	}
	const applyResult = (tool: SummaryTool, result: PendingResult) => {
		const parsed = parseToolResult(result.value, false)
		tool.status = parsed.status
		applyTiming(tool, result.envelope.record?.timestamp, explicitDurationMs(result.value))
		if (tool.logical && isCommandTool(tool.name)) continuations.remember(tool, parsed)
		const target = tool.continuationTargetId ? byId.get(tool.continuationTargetId) : undefined
		if (target) applyContinuation(target, parsed, result.envelope)
	}
	const flushPending = (callId: string) => {
		const tool = byCallId.get(callId)
		if (!tool) return
		for (const result of pendingResults.get(callId) ?? []) applyResult(tool, result)
		pendingResults.delete(callId)
	}
	const registerCall = (envelope: RecordEnvelope, payload: Record<string, unknown>, itemType: string) => {
		const callId = toolCallId(payload, envelope.sequence)
		const name = asString(payload.name) ?? itemType
		const input = toolCallInput(payload, itemType)
		const continuation = isContinuationTool(name)
		const target = continuation ? continuations.resolve(input, currentTurnId) : undefined
		register({
			id: `tool-${callId}`,
			executionId: target?.executionId ?? callId,
			sequence: envelope.sequence,
			callId,
			continuationTargetId: target?.id,
			turnId: currentTurnId,
			name,
			category: toolActivityCategory(name),
			logical: !continuation,
			status: 'pending',
			startedAt: envelope.record?.timestamp
		})
		flushPending(callId)
	}
	const registerResult = (envelope: RecordEnvelope, payload: Record<string, unknown>) => {
		const callId = toolCallId(payload, envelope.sequence)
		const result = { envelope, value: toolResultValue(payload) }
		const tool = byCallId.get(callId)
		if (tool) applyResult(tool, result)
		else pendingResults.set(callId, [...(pendingResults.get(callId) ?? []), result])
	}
	const updateFromEvent = (envelope: RecordEnvelope, payload: Record<string, unknown>, name: string, category: ToolActivityCategory, durationMs?: number) => {
		const callId = asString(payload.call_id)
		let tool = callId ? byCallId.get(callId) : undefined
		if (!tool && category === 'web') tool = tools.findLast(item => item.category === 'web' && item.durationMs === undefined)
		if (!tool) {
			const id = callId ?? `event-${name}-${envelope.sequence}`
			tool = register({
				id: `tool-${id}`,
				executionId: id,
				sequence: envelope.sequence,
				callId,
				turnId: asString(payload.turn_id) ?? currentTurnId,
				name,
				category,
				logical: true,
				status: eventStatus(payload, false),
				endedAt: envelope.record?.timestamp
			})
		} else tool.status = eventStatus(payload, false)
		applyTiming(tool, envelope.record?.timestamp, durationMs)
	}

	for (const envelope of envelopes) {
		const record = envelope.record
		if (!record) continue
		const payload = recordPayload(record)
		const itemType = asString(payload.type)
		if (record.type === 'turn_context') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			const key = segmentKey(currentTurnId)
			if (!segmentStarts.has(key)) segmentStarts.set(key, record.timestamp)
			continue
		}
		if (record.type === 'response_item') {
			if (itemType === 'message' && asString(payload.role) === 'user') segmentStarts.set(segmentKey(currentTurnId), record.timestamp)
			if (itemType && TOOL_CALL_TYPES.has(itemType)) registerCall(envelope, payload, itemType)
			else if (itemType && TOOL_OUTPUT_TYPES.has(itemType)) registerResult(envelope, payload)
			else if (itemType === 'tool_search_call') registerCall(envelope, { ...payload, name: 'tool_search' }, itemType)
			else if (itemType === 'tool_search_output') registerResult(envelope, payload)
			else if (itemType === 'web_search_call') register({
				id: `tool-web-search-${envelope.sequence}`,
				executionId: `web-search-${envelope.sequence}`,
				sequence: envelope.sequence,
				turnId: currentTurnId,
				name: 'web_search',
				category: 'web',
				logical: true,
				status: parseToolResult(payload, false).status,
				endedAt: record.timestamp
			})
			continue
		}
		if (record.type !== 'event_msg') continue
		if (itemType === 'task_started') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			const key = segmentKey(currentTurnId)
			if (!segmentStarts.has(key)) segmentStarts.set(key, asString(payload.started_at) ?? record.timestamp)
		} else if (itemType === 'user_message') segmentStarts.set(segmentKey(currentTurnId), record.timestamp)
		else if (itemType === 'exec_command_end') updateFromEvent(envelope, payload, 'exec_command', 'shell', durationObjectMs(payload.duration))
		else if (itemType === 'mcp_tool_call_end') {
			const invocation = asObject(payload.invocation)
			const name = [asString(invocation?.server), asString(invocation?.tool)].filter(Boolean).join('/') || 'mcp_tool'
			updateFromEvent(envelope, payload, name, 'mcp', durationObjectMs(payload.duration))
		} else if (itemType === 'web_search_end') updateFromEvent(envelope, payload, 'web_search', 'web')
		else if (itemType === 'patch_apply_end') updateFromEvent(envelope, payload, 'apply_patch', 'file')

		const sample = sampleBySequence.get(envelope.sequence)
		if (!sample) continue
		const key = segmentKey(sample.turnId ?? currentTurnId)
		const startedAt = segmentStarts.get(key)
		const start = timestampMs(startedAt)
		const end = timestampMs(sample.timestamp)
		requests.push({
			tokenSampleId: sample.id,
			sequence: sample.sequence,
			timestamp: sample.timestamp,
			startedAt,
			reasoningOutputTokens: sample.reasoningOutput,
			visibleOutputTokens: Math.max(sample.output - sample.reasoningOutput, 0),
			spanMs: start !== undefined && end !== undefined && end >= start ? end - start : undefined,
			toolCallCount: 0,
			toolExecutionCount: 0,
			timedToolExecutionCount: 0,
			toolDurationMs: 0
		})
		segmentStarts.set(key, sample.timestamp)
	}

	for (const tool of tools) if (tool.status === 'pending' || tool.status === 'running') tool.status = 'unknown'
	assignToolsToRequests(requests, tools)
	return { requests, metrics: activityMetrics(requests, tools, performance) }
}
