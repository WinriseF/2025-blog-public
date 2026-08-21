import { summarizeSession } from './collection'
import type { RecordEnvelope } from './record-utils'
import { collectSessionMetadata } from './session-metadata'
import { buildSessionPerformance } from './performance'
import { buildTokenUsage } from './token-usage'
import type { ParseDiagnostic, SessionSource, SessionSummary } from './types'

type SourceDescriptor = Omit<SessionSource, 'recordCount'>

export function parseCodexSessionSummary(key: string, relativePath: string | undefined, source: SourceDescriptor, envelopes: RecordEnvelope[]): SessionSummary {
	const collected = collectSessionMetadata(envelopes)
	if (!collected.recognizedRecords) throw new Error('文件中没有可识别的 Codex Session 记录')
	const diagnostics: ParseDiagnostic[] = []
	for (const envelope of envelopes) if (!envelope.record) diagnostics.push({
		id: `diagnostic-jsonl-${envelope.sequence}`,
		severity: 'warning',
		code: 'JSONL_LINE_INVALID',
		message: `第 ${envelope.sourceRef.line} 行无法解析`,
		sourceRef: envelope.sourceRef
	})
	const tokenUsage = buildTokenUsage(envelopes, Boolean(collected.meta.isSubagent || collected.meta.forkedFromId), diagnostics)
	const performance = buildSessionPerformance(envelopes, tokenUsage)

	return summarizeSession(key, relativePath, {
		source: { ...source, recordCount: envelopes.length },
		meta: collected.meta,
		tokenUsage,
		performance,
		diagnostics
	})
}
