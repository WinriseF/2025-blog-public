import stripAnsi from 'strip-ansi'
import { asBoolean, asNumber, asObject, asString, extractText, parseJsonObject } from './record-utils'
import type { EventStatus, SourceRef } from './types'

const COMMAND_TOOLS = new Set(['exec_command', 'shell_command', 'local_shell_call'])
const CONTINUATION_TOOLS = new Set(['wait', 'poll', 'write_stdin'])
const RESPONSE_TOOL_CALL_TYPES = new Set(['function_call', 'custom_tool_call', 'local_shell_call'])
const RESPONSE_TOOL_OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output'])

function asIdentifier(value: unknown) {
	return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

function resultObjects(value: unknown) {
	const root = asObject(value)
	return [root, asObject(root?.output), asObject(root?.result), asObject(root?.data)].filter((item): item is Record<string, unknown> => Boolean(item))
}

export function appendSourceRef(refs: SourceRef[], ref: SourceRef) {
	if (!refs.some(item => item.line === ref.line && item.byteStart === ref.byteStart)) refs.push(ref)
}

export function appendSourceRefs(refs: SourceRef[], additions: SourceRef[]) {
	for (const ref of additions) appendSourceRef(refs, ref)
}

export function toolLeafName(name: string) {
	return name.trim().toLowerCase().split(/__|[.:/]/).filter(Boolean).at(-1) ?? name.trim().toLowerCase()
}

export function isCommandTool(name: string) {
	return COMMAND_TOOLS.has(toolLeafName(name))
}

export function isContinuationTool(name: string) {
	return CONTINUATION_TOOLS.has(toolLeafName(name))
}

export function isResponseToolCallType(type?: string): type is string {
	return Boolean(type && RESPONSE_TOOL_CALL_TYPES.has(type))
}

export function isResponseToolOutputType(type?: string): type is string {
	return Boolean(type && RESPONSE_TOOL_OUTPUT_TYPES.has(type))
}

export function toolCallId(payload: Record<string, unknown>, sequence: number) {
	return asString(payload.call_id) ?? asString(payload.id) ?? `missing-call-id-${sequence}`
}

export function toolCallInput(payload: Record<string, unknown>, itemType: string) {
	if (itemType === 'local_shell_call') return payload.action ?? payload
	const raw = payload.arguments ?? payload.input ?? payload.params
	return parseJsonObject(raw) ?? raw
}

export function toolResultValue(payload: Record<string, unknown>) {
	return 'output' in payload ? payload : payload.result ?? payload
}

export function toolIdentifiers(value: unknown) {
	const object = asObject(value)
	return {
		sessionId: asIdentifier(object?.session_id) ?? asIdentifier(object?.sessionId),
		cellId: asIdentifier(object?.cell_id) ?? asIdentifier(object?.cellId)
	}
}

export function parseToolResult(value: unknown, inspectText = true) {
	const objects = resultObjects(value)
	const text = inspectText ? stripAnsi(extractText(value)) : ''
	const explicitError = objects.map(item => asBoolean(item.is_error) ?? asBoolean(item.isError)).find(item => item !== undefined)
	const success = objects.map(item => asBoolean(item.success)).find(item => item !== undefined)
	const structuredExitCode = objects.map(item => asNumber(item.exit_code) ?? asNumber(item.exitCode)).find(item => item !== undefined)
	const textExitCode = Number(text.match(/(?:exit[_ ]code|exited with code)["'=:\s]+(-?\d+)/i)?.[1] ?? Number.NaN)
	const exitCode = structuredExitCode ?? (Number.isFinite(textExitCode) ? textExitCode : undefined)
	const sessionId = objects.map(item => toolIdentifiers(item).sessionId).find(Boolean) ?? text.match(/session[_ ]id["'=:\s]+([\w.-]+)/i)?.[1]
	const cellId = objects.map(item => toolIdentifiers(item).cellId).find(Boolean) ?? text.match(/(?:cell[_ ]id["'=:\s]+|Script running with cell ID\s+)([\w.-]+)/i)?.[1]
	const explicitStatus = objects.map(item => asString(item.status)?.toLowerCase()).find(Boolean)
	const running = Boolean(sessionId || cellId || /process running|script running/i.test(text)) && exitCode === undefined
	let status: EventStatus = 'unknown'
	if (explicitError === true || success === false) status = 'failed'
	else if (exitCode !== undefined) status = exitCode === 0 ? 'completed' : 'failed'
	else if (explicitStatus === 'failed' || explicitStatus === 'error') status = 'failed'
	else if (explicitStatus === 'interrupted' || explicitStatus === 'cancelled') status = 'interrupted'
	else if (explicitStatus === 'running' || explicitStatus === 'pending' || running) status = 'running'
	else if (explicitStatus === 'completed' || explicitStatus === 'success' || success === true) status = 'completed'
	else if (/^(?:error|failed)\b|\n(?:error|failed):/i.test(text)) status = 'failed'
	else if (/\b(?:script completed|completed successfully)\b/i.test(text)) status = 'completed'
	return { output: text, exitCode, sessionId, cellId, status }
}

type LinkableExecution = { status: EventStatus; turnId?: string }

export class ContinuationIndex<T extends LinkableExecution> {
	private candidates: T[] = []
	private sessions = new Map<string, T>()
	private cells = new Map<string, T>()

	add(value: T) {
		this.candidates.push(value)
	}

	resolve(input: unknown, turnId?: string) {
		const { sessionId, cellId } = toolIdentifiers(input)
		const linked = (sessionId && this.sessions.get(sessionId)) || (cellId && this.cells.get(cellId))
		if (linked) return linked
		const running = this.candidates.filter(item => item.status === 'running' && (!turnId || item.turnId === turnId))
		return running.length === 1 ? running[0] : undefined
	}

	remember(value: T, result: Pick<ReturnType<typeof parseToolResult>, 'sessionId' | 'cellId'>) {
		if (result.sessionId) this.sessions.set(result.sessionId, value)
		if (result.cellId) this.cells.set(result.cellId, value)
	}
}
