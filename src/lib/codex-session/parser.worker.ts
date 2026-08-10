import { readJsonlFile } from './jsonl-reader'
import { isAuditCommand } from './command-semantics'
import { FileEvidenceCollector } from './file-evidence'
import { parseCodexSession } from './parser'
import { analyzeShellProcesses } from './shell-analysis'
import type { ParserWorkerRequest, ParserWorkerResponse } from './types'

let active: { id: number; controller: AbortController } | undefined

function post(message: ParserWorkerResponse) {
	self.postMessage(message)
}

self.onmessage = async (event: MessageEvent<ParserWorkerRequest>) => {
	const request = event.data
	if (request.type === 'cancel') {
		if (active?.id === request.id) active.controller.abort()
		return
	}

	active?.controller.abort()
	const controller = new AbortController()
	active = { id: request.id, controller }

	try {
		const parsed = await readJsonlFile(
			request.file,
			progress => {
				if (active?.id === request.id && !controller.signal.aborted) post({ type: 'progress', id: request.id, bytesRead: progress.bytesRead, records: progress.records })
			},
			controller.signal
		)
		if (active?.id !== request.id || controller.signal.aborted) return
		const result = parseCodexSession(
			{
				name: request.file.name,
				size: request.file.size,
				lastModified: request.file.lastModified,
				lineCount: parsed.lineCount
			},
			parsed.records
		)
		await analyzeShellProcesses(result.processes, new URL('/wasm/codex-session/', self.location.origin).href, controller.signal)
		const fileEvidence = new FileEvidenceCollector(result.fileAudit)
		fileEvidence.addProcesses(result.processes)
		result.fileAudit = fileEvidence.result()
		for (const process of result.processes) if (process.analysis) process.analysis.commands = process.analysis.commands.filter(isAuditCommand)
		result.processes = result.processes.filter(process => process.analysis?.commands.length)
		let shellDiagnostics = 0
		for (const process of result.processes) {
			if (!process.analysis || process.analysis.status === 'complete') continue
			if (shellDiagnostics++ >= 20) continue
			result.diagnostics.push({
				id: `diagnostic-shell-${process.id}`,
				severity: process.analysis.status === 'opaque' || process.analysis.structuralIssue ? 'warning' : 'info',
				code: process.analysis.status === 'opaque' ? 'SHELL_PARSE_OPAQUE' : process.analysis.structuralIssue ? 'SHELL_STRUCTURE_ERROR' : 'SHELL_PARSE_FALLBACK',
				message: process.analysis.notes.join('；') || 'Shell 脚本只能部分解析',
				sourceRef: process.sourceRefs[0],
				processId: process.id
			})
		}
		if (shellDiagnostics > 20) result.diagnostics.push({
			id: 'diagnostic-shell-overflow',
			severity: 'info',
			code: 'SHELL_DIAGNOSTIC_SUMMARY',
			message: `另有 ${shellDiagnostics - 20} 个 Shell 批次只能部分解析`
		})
		if (active?.id !== request.id || controller.signal.aborted) return
		post({ type: 'success', id: request.id, result })
	} catch (error) {
		if (!controller.signal.aborted && active?.id === request.id) post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : 'Session 解析失败' })
	} finally {
		if (active?.id === request.id) active = undefined
	}
}
