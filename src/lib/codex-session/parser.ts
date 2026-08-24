import { decodeExecSource } from './exec-parser'
import { buildSessionActivity } from './activity-analysis'
import { FileEvidenceCollector } from './file-evidence'
import { buildSessionPerformance } from './performance'
import { ProcessTracker } from './process-tracker'
import { asBoolean, asString, recordPayload, type RecordEnvelope } from './record-utils'
import { CODEX_RECORD_TYPES, collectSessionMetadata } from './session-metadata'
import { appendSourceRef, isCommandTool, parseToolResult, toolCallId, toolCallInput, toolResultValue } from './tool-record'
import { buildTokenUsage } from './token-usage'
import type { EventStatus, ParseDiagnostic, SessionParseResult, SessionSource, SourceRef } from './types'

type SourceDescriptor = Omit<SessionSource, 'recordCount'>

type CallState = {
	id: string
	name: string
	input: unknown
	parentCallId?: string
	sequence: number
	timestamp?: string
	turnId?: string
	sourceRefs: SourceRef[]
	nestedCallIds: string[]
	resultCount: number
	status: EventStatus
}

type ResultState = {
	envelope: RecordEnvelope
	value: unknown
}

export function parseCodexSession(source: SourceDescriptor, envelopes: RecordEnvelope[]): SessionParseResult {
	const collected = collectSessionMetadata(envelopes)
	const diagnostics: ParseDiagnostic[] = []
	const calls = new Map<string, CallState>()
	const pendingResults = new Map<string, ResultState[]>()
	const execDecodes = new Map<string, ReturnType<typeof decodeExecSource>>()
	const fileEvidence = new FileEvidenceCollector()
	const processTracker = new ProcessTracker()
	let currentTurnId: string | undefined
	let cwd: string | undefined

	const addDiagnostic = (envelope: RecordEnvelope, severity: ParseDiagnostic['severity'], code: string, message: string, processId?: string) => {
		diagnostics.push({ id: `diagnostic-${code}-${envelope.sequence}-${diagnostics.length}`, severity, code, message, sourceRef: envelope.sourceRef, processId })
	}

	const callContext = (call: CallState) => ({
		sequence: call.sequence,
		timestamp: call.timestamp,
		callId: call.id,
		cwd,
		sourceRefs: call.sourceRefs
	})

	const applyResultToCall = (call: CallState, result: ResultState) => {
		call.resultCount++
		if (call.resultCount > 1) addDiagnostic(result.envelope, 'warning', 'DUPLICATE_TOOL_RESULT', `调用 ${call.id} 出现多个结果`, isCommandTool(call.name) ? `process-${call.id}` : undefined)
		call.status = parseToolResult(result.value).status
		appendSourceRef(call.sourceRefs, result.envelope.sourceRef)
		processTracker.applyResult(call.id, result.value, [result.envelope.sourceRef])
		fileEvidence.applyCallStatus(call.id, call.status)

		if (call.nestedCallIds.length === 1) {
			const nested = calls.get(call.nestedCallIds[0])
			if (nested && !nested.resultCount) {
				nested.resultCount++
				nested.status = call.status
				appendSourceRef(nested.sourceRefs, result.envelope.sourceRef)
				processTracker.applyResult(nested.id, result.value, [result.envelope.sourceRef])
				fileEvidence.applyCallStatus(nested.id, nested.status)
			}
		} else if (call.nestedCallIds.length > 1) {
			for (const nestedCallId of call.nestedCallIds) {
				const nested = calls.get(nestedCallId)
				if (!nested || nested.resultCount) continue
				nested.resultCount++
				nested.status = 'unknown'
				appendSourceRef(nested.sourceRefs, result.envelope.sourceRef)
				processTracker.markSettledWithoutResult(nested.id, [result.envelope.sourceRef])
				fileEvidence.applyCallStatus(nested.id, 'unknown')
			}
		}
	}

	const flushPendingResults = (callId: string) => {
		const call = calls.get(callId)
		if (!call) return
		for (const result of pendingResults.get(callId) ?? []) applyResultToCall(call, result)
		pendingResults.delete(callId)
	}

	const registerCall = (envelope: RecordEnvelope, name: string, input: unknown, callId: string, parentCallId?: string, sequence = envelope.sequence) => {
		if (calls.has(callId)) {
			addDiagnostic(envelope, 'warning', 'DUPLICATE_TOOL_CALL', `调用 ID ${callId} 被重复使用`)
			return calls.get(callId)!
		}
		const call: CallState = {
			id: callId,
			name,
			input,
			parentCallId,
			sequence,
			timestamp: envelope.record?.timestamp,
			turnId: currentTurnId,
			sourceRefs: [envelope.sourceRef],
			nestedCallIds: [],
			resultCount: 0,
			status: 'pending'
		}
		calls.set(callId, call)
		const context = { ...callContext(call), turnId: call.turnId, parentCallId }
		processTracker.addToolCall(name, input, context)
		fileEvidence.addToolCall(name, input, context)
		return call
	}

	const registerResult = (envelope: RecordEnvelope, payload: Record<string, unknown>) => {
		const callId = toolCallId(payload, envelope.sequence)
		const result = { envelope, value: toolResultValue(payload) }
		const call = calls.get(callId)
		if (call) applyResultToCall(call, result)
		else pendingResults.set(callId, [...(pendingResults.get(callId) ?? []), result])
	}

	for (const envelope of envelopes) {
		if (!envelope.record) {
			addDiagnostic(envelope, 'warning', 'JSONL_LINE_INVALID', `第 ${envelope.sourceRef.line} 行无法解析：${envelope.parseError ?? '未知错误'}`)
			continue
		}

		const record = envelope.record
		const payload = recordPayload(record)
		const itemType = asString(payload.type)
		if (!CODEX_RECORD_TYPES.has(record.type)) continue

		if (record.type === 'session_meta') {
			cwd = asString(payload.cwd) ?? cwd
			continue
		}

		if (record.type === 'turn_context') {
			currentTurnId = asString(payload.turn_id) ?? currentTurnId
			cwd = asString(payload.cwd) ?? cwd
			continue
		}

		if (record.type === 'response_item') {
			if (itemType === 'function_call' || itemType === 'custom_tool_call' || itemType === 'local_shell_call') {
				const name = asString(payload.name) ?? itemType
				const callId = toolCallId(payload, envelope.sequence)
				const input = toolCallInput(payload, itemType)
				const outer = registerCall(envelope, name, input, callId)
				if (itemType === 'custom_tool_call' && name.toLowerCase() === 'exec' && typeof input === 'string') {
					const decoded = decodeExecSource(input, callId)
					execDecodes.set(callId, decoded)
					for (const message of decoded.diagnostics) addDiagnostic(envelope, 'warning', 'EXEC_STATIC_ANALYSIS', message)
					for (const nestedCall of decoded.calls) {
						const nestedInput = nestedCall.input ?? nestedCall.inputSource
						registerCall(envelope, nestedCall.name, nestedInput, nestedCall.id, callId, envelope.sequence + (nestedCall.ordinal + 1) / 1000)
						outer.nestedCallIds.push(nestedCall.id)
						flushPendingResults(nestedCall.id)
					}
				}
				flushPendingResults(callId)
				continue
			}
			if (itemType === 'function_call_output' || itemType === 'custom_tool_call_output' || itemType === 'local_shell_call_output') registerResult(envelope, payload)
			continue
		}

		if (record.type !== 'event_msg') continue
		if (itemType === 'task_started') currentTurnId = asString(payload.turn_id) ?? currentTurnId
		else if (itemType === 'turn_aborted') {
			processTracker.markInterrupted()
			fileEvidence.markUnsettled('interrupted')
		} else if (itemType === 'patch_apply_end') {
			fileEvidence.addPatchApplyEnd(payload.changes, asBoolean(payload.success) === true, {
				sequence: envelope.sequence,
				timestamp: record.timestamp,
				callId: asString(payload.call_id),
				cwd,
				sourceRefs: [envelope.sourceRef]
			})
		}
	}

	if (!collected.recognizedRecords) throw new Error('文件中没有可识别的 Codex Session 记录')

	let missingDiagnostics = 0
	for (const [callId, call] of calls) {
		if (call.resultCount) continue
		call.status = 'unknown'
		processTracker.markSettledWithoutResult(callId, call.sourceRefs)
		fileEvidence.applyCallStatus(callId, 'unknown')
		if (missingDiagnostics++ < 20) {
			const envelope = envelopes.find(item => item.sourceRef.line === call.sourceRefs[0]?.line) ?? envelopes[0]
			if (envelope) addDiagnostic(envelope, 'info', 'TOOL_RESULT_MISSING', `调用 ${callId} 没有可关联的结果`, isCommandTool(call.name) ? `process-${callId}` : undefined)
		}
	}
	for (const [callId, results] of pendingResults) {
		for (const result of results.slice(0, 20)) addDiagnostic(result.envelope, 'warning', 'TOOL_CALL_MISSING', `结果 ${callId} 没有可关联的调用`)
	}
	if (missingDiagnostics > 20 && envelopes[0]) addDiagnostic(envelopes[0], 'info', 'TOOL_RESULT_MISSING_SUMMARY', `另有 ${missingDiagnostics - 20} 个调用缺少可关联结果`)

	processTracker.settleUnfinished()
	fileEvidence.markUnsettled('unknown')
	const tokenUsage = buildTokenUsage(envelopes, Boolean(collected.meta.isSubagent || collected.meta.forkedFromId), diagnostics)
	const performance = buildSessionPerformance(envelopes, tokenUsage)

	return {
		source: { ...source, recordCount: envelopes.length },
		meta: collected.meta,
		processes: processTracker.list(),
		fileAudit: fileEvidence.result(),
		tokenUsage,
		activity: buildSessionActivity(envelopes, tokenUsage, performance, { execDecodes }),
		performance,
		diagnostics
	}
}
