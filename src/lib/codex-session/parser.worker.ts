import { readJsonlFile } from './jsonl-reader'
import { isAuditCommand } from './command-semantics'
import { FileEvidenceCollector } from './file-evidence'
import { parseCodexSession } from './parser'
import { compressSessionRecords, scanSessionCompression } from './session-compression'
import { analyzeShellProcesses } from './shell-analysis'
import { parseCodexSessionSummary } from './summary-parser'
import type { CodexSessionWorkerRequest, CodexSessionWorkerResponse, SessionBatchFailure, SessionSummary } from './types'

let active: { id: number; controller: AbortController } | undefined

function post(message: CodexSessionWorkerResponse) {
	self.postMessage(message)
}

self.onmessage = async (event: MessageEvent<CodexSessionWorkerRequest>) => {
	const request = event.data
	if (request.type === 'cancel') {
		if (active?.id === request.id) active.controller.abort()
		return
	}

	active?.controller.abort()
	const controller = new AbortController()
	active = { id: request.id, controller }

	try {
		if (request.type === 'scan-compression' || request.type === 'compress-session') {
			const phase = request.type === 'scan-compression' ? 'scan' : 'compress'
			const parsed = await readJsonlFile(
				request.file,
				progress => {
					if (active?.id === request.id && !controller.signal.aborted) post({ type: 'compression-progress', id: request.id, phase, bytesRead: progress.bytesRead, records: progress.records })
				},
				controller.signal
			)
			if (active?.id !== request.id || controller.signal.aborted) return
			if (request.type === 'scan-compression') {
				post({ type: 'compression-scan-success', id: request.id, scan: scanSessionCompression(parsed.records, request.file.size) })
				return
			}

			const compressed = compressSessionRecords(parsed.records, request.file.size, request.selections)
			const selectionCounts = new Map<string, number>()
			for (const selection of request.selections) selectionCounts.set(selection.ruleId, (selectionCounts.get(selection.ruleId) ?? 0) + 1)
			const manifest = {
				type: 'audit_compaction_meta',
				payload: {
					version: 1,
					generated_at: new Date().toISOString(),
					source_name: request.file.name,
					source_bytes: request.file.size,
					selections: [...selectionCounts].map(([rule_id, records]) => ({ rule_id, records }))
				}
			}
			const parts: BlobPart[] = [`${JSON.stringify(manifest)}\n`]
			for (const envelope of compressed.records) {
				if (envelope.record && compressed.rewrittenSequences.has(envelope.sequence)) parts.push(`${JSON.stringify(envelope.record)}\n`)
				else parts.push(request.file.slice(envelope.sourceRef.byteStart, envelope.sourceRef.byteEnd), '\n')
			}
			const blob = new Blob(parts, { type: 'application/x-ndjson;charset=utf-8' })
			compressed.report.outputBytes = blob.size
			const fileName = request.file.name.replace(/\.jsonl$/i, '') + '.audit-compact.jsonl'
			post({ type: 'compression-success', id: request.id, blob, fileName, report: compressed.report })
			return
		}

		if (request.type === 'parse-batch') {
			const sessions: SessionSummary[] = []
			const failures: SessionBatchFailure[] = []
			const totalBytes = request.sources.reduce((total, source) => total + source.file.size, 0)
			let completedBytes = 0
			let completedRecords = 0

			for (let index = 0; index < request.sources.length; index++) {
				const source = request.sources[index]
				if (controller.signal.aborted || active?.id !== request.id) return
				try {
					const parsed = await readJsonlFile(
						source.file,
						progress => {
							if (active?.id !== request.id || controller.signal.aborted) return
							post({
								type: 'batch-progress',
								id: request.id,
								completedFiles: index,
								totalFiles: request.sources.length,
								currentName: source.relativePath ?? source.file.name,
								bytesRead: completedBytes + progress.bytesRead,
								totalBytes,
								records: completedRecords + progress.records
							})
						},
						controller.signal
					)
					const summary = parseCodexSessionSummary(
						source.key,
						source.relativePath,
						{
							name: source.file.name,
							size: source.file.size,
							lastModified: source.file.lastModified,
							lineCount: parsed.lineCount
						},
						parsed.records
					)
					sessions.push(summary)
					completedRecords += parsed.records.length
				} catch (error) {
					if (controller.signal.aborted) throw error
					failures.push({
						key: source.key,
						name: source.file.name,
						relativePath: source.relativePath,
						message: error instanceof Error ? error.message : 'Session 解析失败'
					})
				}
				completedBytes += source.file.size
			}

			if (active?.id !== request.id || controller.signal.aborted) return
			post({ type: 'batch-success', id: request.id, result: { sessions, failures } })
			return
		}

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
