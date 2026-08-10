import stripAnsi from 'strip-ansi'
import { asBoolean, asNumber, asObject, extractText } from './record-utils'
import { commandInput, isCommandTool } from './tool-protocol'
import type { EventStatus, ProcessRun, SourceRef } from './types'

type ToolContext = {
	sequence: number
	timestamp?: string
	turnId?: string
	cwd?: string
	callId: string
	parentCallId?: string
	sourceRefs: SourceRef[]
}

const MAX_OUTPUT_CHARS = 300_000

function asIdentifier(value: unknown) {
	return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

function resultObjects(value: unknown) {
	const root = asObject(value)
	return [root, asObject(root?.output), asObject(root?.result), asObject(root?.data)].filter((item): item is Record<string, unknown> => Boolean(item))
}

export function parseToolResult(value: unknown) {
	const objects = resultObjects(value)
	const output = stripAnsi(extractText(value))
	const explicitError = objects.map(item => asBoolean(item.is_error) ?? asBoolean(item.isError)).find(item => item !== undefined)
	const success = objects.map(item => asBoolean(item.success)).find(item => item !== undefined)
	const structuredExitCode = objects.map(item => asNumber(item.exit_code) ?? asNumber(item.exitCode)).find(item => item !== undefined)
	const textExitCode = Number(output.match(/(?:exit[_ ]code|exited with code)["'=:\s]+(-?\d+)/i)?.[1] ?? Number.NaN)
	const exitCode = structuredExitCode ?? (Number.isFinite(textExitCode) ? textExitCode : undefined)
	const sessionId = objects.map(item => asIdentifier(item.session_id) ?? asIdentifier(item.sessionId)).find(Boolean) ?? output.match(/session[_ ]id["'=:\s]+([\w.-]+)/i)?.[1]
	const cellId = objects.map(item => asIdentifier(item.cell_id) ?? asIdentifier(item.cellId)).find(Boolean) ?? output.match(/(?:cell[_ ]id["'=:\s]+|Script running with cell ID\s+)([\w.-]+)/i)?.[1]
	const running = Boolean(sessionId || cellId || /process running|script running/i.test(output)) && exitCode === undefined
	let status: EventStatus = 'unknown'
	if (explicitError === true || success === false) status = 'failed'
	else if (exitCode !== undefined) status = exitCode === 0 ? 'completed' : 'failed'
	else if (running) status = 'running'
	else if (success === true) status = 'completed'
	return { output, exitCode, sessionId, cellId, status }
}

function appendOutput(current: string | undefined, next: string) {
	if (!next) return current
	const value = current ? `${current}\n${next}` : next
	return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n... 批次输出过长，已截断` : value
}

function pushRefs(target: SourceRef[], refs: SourceRef[]) {
	for (const ref of refs) if (!target.some(item => item.line === ref.line && item.byteStart === ref.byteStart)) target.push(ref)
}

export class ProcessTracker {
	private processes: ProcessRun[] = []
	private callToProcess = new Map<string, ProcessRun>()
	private sessionToProcess = new Map<string, ProcessRun>()
	private cellToProcess = new Map<string, ProcessRun>()

	addToolCall(name: string, input: unknown, context: ToolContext) {
		const lowerName = name.toLowerCase()
		const leafName = lowerName.split(/__|[.:/]/).at(-1)
		const parsed = commandInput(input)
		if (isCommandTool(name) && parsed.command) {
			const process: ProcessRun = {
				id: `process-${context.callId}`,
				sequence: context.sequence,
				callId: context.callId,
				parentCallId: context.parentCallId,
				turnId: context.turnId,
				timestamp: context.timestamp,
				toolName: name,
				command: parsed.command,
				argv: parsed.argv,
				executionMode: leafName === 'local_shell_call' ? 'argv' : 'shell',
				cwd: parsed.cwd ?? context.cwd,
				shellHint: parsed.shell,
				status: 'pending',
				continuationCallIds: [],
				sourceRefs: [...context.sourceRefs]
			}
			this.processes.push(process)
			this.callToProcess.set(context.callId, process)
			return process
		}

		const continuation = lowerName === 'write_stdin' || lowerName === 'wait' || lowerName === 'poll' || /(?:__|\.)(?:write_stdin|wait|poll)$/.test(lowerName)
		if (!continuation) return
		let process = (parsed.sessionId && this.sessionToProcess.get(parsed.sessionId)) || (parsed.cellId && this.cellToProcess.get(parsed.cellId))
		if (!process) {
			const running = this.processes.filter(item => item.status === 'running' && (!context.turnId || item.turnId === context.turnId))
			if (running.length === 1) process = running[0]
		}
		if (!process) return
		process.continuationCallIds.push(context.callId)
		pushRefs(process.sourceRefs, context.sourceRefs)
		this.callToProcess.set(context.callId, process)
	}

	applyResult(callId: string, value: unknown, sourceRefs: SourceRef[]) {
		const process = this.callToProcess.get(callId)
		if (!process) return
		const result = parseToolResult(value)
		process.output = appendOutput(process.output, result.output)
		process.status = result.status
		process.exitCode = result.exitCode ?? process.exitCode
		process.sessionId = result.sessionId ?? process.sessionId
		process.cellId = result.cellId ?? process.cellId
		pushRefs(process.sourceRefs, sourceRefs)
		if (process.sessionId) this.sessionToProcess.set(process.sessionId, process)
		if (process.cellId) this.cellToProcess.set(process.cellId, process)
		return process
	}

	markSettledWithoutResult(callId: string, sourceRefs: SourceRef[]) {
		const process = this.callToProcess.get(callId)
		if (!process) return
		if (process.status === 'pending' || process.status === 'running') process.status = 'unknown'
		pushRefs(process.sourceRefs, sourceRefs)
	}

	markInterrupted() {
		for (const process of this.processes) if (process.status === 'pending' || process.status === 'running') process.status = 'interrupted'
	}

	settleUnfinished() {
		for (const process of this.processes) if (process.status === 'pending' || process.status === 'running') process.status = 'unknown'
	}

	list() {
		return this.processes.sort((left, right) => left.sequence - right.sequence)
	}
}
