import { asObject, asString } from './record-utils'
import { appendSourceRefs, ContinuationIndex, isCommandTool, isContinuationTool, parseToolResult, toolLeafName } from './tool-record'
import type { ProcessRun, SourceRef } from './types'

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

function displayArgument(value: string) {
	if (value && !/[\s"'`;|&<>(){}\[\]]/.test(value)) return value
	return `"${value.replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`
}

function commandInput(input: unknown) {
	const object = asObject(input)
	const rawCommand = object?.cmd ?? object?.command
	const argv = Array.isArray(rawCommand) && rawCommand.every(item => typeof item === 'string') ? rawCommand : undefined
	return {
		command: asString(rawCommand) ?? argv?.map(displayArgument).join(' '),
		argv,
		cwd: asString(object?.workdir) ?? asString(object?.cwd) ?? asString(object?.working_directory),
		shell: asString(object?.shell)
	}
}

function appendOutput(current: string | undefined, next: string) {
	if (!next) return current
	const value = current ? `${current}\n${next}` : next
	return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n... 批次输出过长，已截断` : value
}

export class ProcessTracker {
	private processes: ProcessRun[] = []
	private callToProcess = new Map<string, ProcessRun>()
	private continuations = new ContinuationIndex<ProcessRun>()

	addToolCall(name: string, input: unknown, context: ToolContext) {
		const leafName = toolLeafName(name)
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
			this.continuations.add(process)
			return process
		}

		if (!isContinuationTool(name)) return
		const process = this.continuations.resolve(input, context.turnId)
		if (!process) return
		process.continuationCallIds.push(context.callId)
		appendSourceRefs(process.sourceRefs, context.sourceRefs)
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
		appendSourceRefs(process.sourceRefs, sourceRefs)
		this.continuations.remember(process, result)
		return process
	}

	markSettledWithoutResult(callId: string, sourceRefs: SourceRef[]) {
		const process = this.callToProcess.get(callId)
		if (!process) return
		if (process.status === 'pending' || process.status === 'running') process.status = 'unknown'
		appendSourceRefs(process.sourceRefs, sourceRefs)
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
