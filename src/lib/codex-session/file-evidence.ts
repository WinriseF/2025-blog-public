import { normalize } from 'pathe'
import { isReadCommandName, isSearchCommandName, normalizeCommandName, tokenizeCommand } from './command-semantics'
import { analyzeCodexPatch } from './patch-analysis'
import { asObject, asString, isObject } from './record-utils'
import type { EventStatus, FileAudit, FileChange, FileChangeOperation, FilePatch, FileRead, ProcessRun, SourceRef } from './types'

type EvidenceContext = {
	sequence: number
	timestamp?: string
	callId?: string
	cwd?: string
	sourceRefs: SourceRef[]
	operationId?: string
}

const PATH_KEYS = ['path', 'file_path', 'filePath', 'filepath', 'absolute_path', 'absolutePath']
const READ_TOOL_NAMES = new Set(['read_file', 'read_text_file', 'read_media_file', 'view_image'])
const SEARCH_TOOL_NAMES = new Set(['search_files', 'search_file', 'find_files', 'glob', 'grep'])
const POWERSHELL_VALUE_OPTIONS = new Set(['-encoding', '-delimiter', '-filter', '-include', '-exclude', '-totalcount', '-tail', '-readcount', '-stream'])

function leafToolName(name: string) {
	return name.toLowerCase().split(/__|[.:/]/).at(-1) ?? ''
}

function cleanPath(value: string) {
	return value.trim().replace(/^['"]|['"]$/g, '').replace(/[;,]$/, '')
}

function normalizedPath(value: string, cwd?: string) {
	const original = cleanPath(value)
	if (!original || /^(?:https?:|data:|--|-$)/i.test(original) || /[$*?]|%[^%]+%|![^!]+!/.test(original)) return
	const slashed = original.replace(/\\/g, '/')
	const base = cleanPath(cwd ?? '').replace(/\\/g, '/').replace(/\/$/, '')
	const path = normalize(base && !/^(?:[A-Za-z]:\/|\/)/.test(slashed) ? `${base}/${slashed}` : slashed).replace(/\/$/, '')
	if (!path || path === '.' || path === '..') return
	const looksLikePath = /[\\/]/.test(original) || /\.[A-Za-z0-9_-]{1,16}$/.test(original) || /^(?:Dockerfile|Makefile|LICENSE|README)$/i.test(original)
	if (!looksLikePath) return
	return { original, path, key: /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path }
}

function operationFromPatchType(type: string): FileChangeOperation {
	if (type === 'add') return 'create'
	if (type === 'delete') return 'delete'
	return 'modify'
}

function structuredPaths(input: unknown) {
	if (typeof input === 'string') return [input]
	if (!isObject(input)) return []
	return PATH_KEYS.flatMap(key => {
		const value = input[key]
		if (typeof value === 'string') return [value]
		if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
		return []
	})
}

function commandTokens(process: ProcessRun, raw: string) {
	return tokenizeCommand(raw, process.analysis?.dialect ?? 'generic')
}

function readCommandPaths(process: ProcessRun, raw: string, commandName: string) {
	const tokens = commandTokens(process, raw)
	const commandIndex = tokens.findIndex(token => normalizeCommandName(token.value) === commandName)
	const args = tokens.slice(commandIndex >= 0 ? commandIndex + 1 : 1)
	const paths: string[] = []
	const add = (value: string | undefined) => {
		if (value && normalizedPath(value, process.cwd)) paths.push(value)
	}

	if (commandName === 'sed') {
		let scriptSeen = false
		for (let index = 0; index < args.length; index++) {
			const value = args[index].value
			if (value === '-e' || value === '--expression') {
				scriptSeen = true
				index++
				continue
			}
			if (value === '-f' || value === '--file') {
				add(args[++index]?.value)
				scriptSeen = true
				continue
			}
			if (value.startsWith('-')) continue
			if (!scriptSeen) {
				scriptSeen = true
				continue
			}
			add(value)
		}
		return [...new Set(paths)]
	}

	for (let index = 0; index < args.length; index++) {
		const value = args[index].value
		const lower = value.toLowerCase()
		if (lower === '-path' || lower === '-literalpath') {
			add(args[++index]?.value)
			continue
		}
		if (POWERSHELL_VALUE_OPTIONS.has(lower) || ['-n', '--lines', '-c', '--bytes'].includes(lower)) {
			index++
			continue
		}
		if (value.startsWith('-') || value === '>' || value === '>>') continue
		add(value)
	}
	return [...new Set(paths)]
}

export class FileEvidenceCollector {
	private reads = new Map<string, FileRead>()
	private changes = new Map<string, FileChange>()
	private readOperations = 0
	private searchOperations = 0
	private patchAttempts = 0
	private failedPatchAttempts = 0
	private patchOrdinal = 0

	constructor(seed?: FileAudit) {
		if (!seed) return
		for (const read of seed.reads) this.reads.set(read.key, { ...read, occurrences: [...read.occurrences] })
		for (const change of seed.changes) this.changes.set(change.key, { ...change, originalPaths: [...change.originalPaths], operations: [...change.operations], patches: [...change.patches] })
		this.readOperations = seed.readOperations
		this.searchOperations = seed.searchOperations
		this.patchAttempts = seed.patchAttempts
		this.failedPatchAttempts = seed.failedPatchAttempts
	}

	private addRead(pathValue: string, status: EventStatus, context: EvidenceContext) {
		const normalized = normalizedPath(pathValue, context.cwd)
		if (!normalized) return
		const read = this.reads.get(normalized.key) ?? { key: normalized.key, path: normalized.path, count: 0, occurrences: [] }
		const operationId = context.operationId ?? context.callId ?? String(context.sequence)
		if (read.occurrences.some(item => item.id === `read-${operationId}-${normalized.key}`)) return
		read.occurrences.push({
			id: `read-${operationId}-${normalized.key}`,
			sequence: context.sequence,
			timestamp: context.timestamp,
			callId: context.callId,
			status,
			sourceRef: context.sourceRefs[0]
		})
		read.count = read.occurrences.length
		this.reads.set(normalized.key, read)
	}

	addToolCall(name: string, input: unknown, context: EvidenceContext) {
		const leaf = leafToolName(name)
		if (READ_TOOL_NAMES.has(leaf)) {
			this.readOperations++
			for (const path of structuredPaths(input)) this.addRead(path, 'pending', context)
		} else if (SEARCH_TOOL_NAMES.has(leaf)) this.searchOperations++
	}

	applyCallStatus(callId: string, status: EventStatus) {
		for (const read of this.reads.values()) for (const occurrence of read.occurrences) if (occurrence.callId === callId) occurrence.status = status
	}

	markUnsettled(status: 'unknown' | 'interrupted') {
		for (const read of this.reads.values()) for (const occurrence of read.occurrences) if (occurrence.status === 'pending' || occurrence.status === 'running') occurrence.status = status
	}

	addProcesses(processes: ProcessRun[]) {
		for (const process of processes) {
			for (const command of process.analysis?.commands ?? []) {
				if (isSearchCommandName(command.normalizedName)) {
					this.searchOperations++
					continue
				}
				if (!isReadCommandName(command.normalizedName)) continue
				this.readOperations++
				const context = { sequence: process.sequence, timestamp: process.timestamp, callId: process.callId, cwd: process.cwd, sourceRefs: process.sourceRefs, operationId: command.id }
				for (const path of readCommandPaths(process, command.raw, command.normalizedName)) this.addRead(path, process.status, context)
			}
		}
	}

	addPatchApplyEnd(changes: unknown, success: boolean, context: EvidenceContext) {
		this.patchAttempts++
		if (!success || !isObject(changes)) {
			this.failedPatchAttempts++
			return
		}
		for (const [pathValue, rawChange] of Object.entries(changes)) {
			const raw = asObject(rawChange)
			const type = asString(raw?.type)?.toLowerCase() ?? 'update'
			const movePath = asString(raw?.move_path) ?? asString(raw?.movePath)
			const target = normalizedPath(movePath ?? pathValue, context.cwd)
			if (!target) continue
			const old = movePath ? normalizedPath(pathValue, context.cwd) : undefined
			const operation: FileChangeOperation = movePath ? 'move' : operationFromPatchType(type)
			const diff = asString(raw?.unified_diff) ?? asString(raw?.unifiedDiff)
			const patchId = `patch-${context.sequence}-${this.patchOrdinal++}`
			const analysis = analyzeCodexPatch({ operation, path: target.path, oldPath: old?.path, diff }, patchId)
			const change = this.changes.get(target.key) ?? {
				key: target.key,
				path: target.path,
				originalPaths: [],
				operations: [],
				patches: [],
				additions: 0,
				deletions: 0
			}
			for (const original of [cleanPath(pathValue), cleanPath(movePath ?? '')]) if (original && !change.originalPaths.includes(original)) change.originalPaths.push(original)
			if (!change.operations.includes(operation)) change.operations.push(operation)
			const patch: FilePatch = {
				id: patchId,
				sequence: context.sequence,
				timestamp: context.timestamp,
				callId: context.callId,
				operation,
				path: target.path,
				oldPath: old?.path,
				diff,
				diffMode: analysis.mode,
				additions: analysis.additions,
				deletions: analysis.deletions,
				sourceRef: context.sourceRefs[0]
			}
			change.patches.push(patch)
			change.additions += analysis.additions
			change.deletions += analysis.deletions
			this.changes.set(target.key, change)
		}
	}

	result(): FileAudit {
		return {
			reads: [...this.reads.values()].map(read => ({ ...read, occurrences: read.occurrences.sort((left, right) => left.sequence - right.sequence) })).sort((left, right) => left.path.localeCompare(right.path)),
			changes: [...this.changes.values()].map(change => ({ ...change, patches: change.patches.sort((left, right) => left.sequence - right.sequence) })).sort((left, right) => left.path.localeCompare(right.path)),
			readOperations: this.readOperations,
			searchOperations: this.searchOperations,
			patchAttempts: this.patchAttempts,
			failedPatchAttempts: this.failedPatchAttempts
		}
	}
}
