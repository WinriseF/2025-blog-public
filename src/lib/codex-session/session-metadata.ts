import { asObject, asString, recordPayload, type RecordEnvelope } from './record-utils'
import type { SessionMetadata } from './types'

export const CODEX_RECORD_TYPES = new Set(['session_meta', 'turn_context', 'response_item', 'event_msg', 'compacted', 'world_state', 'rollback'])

function metaContainsSubagent(payload: Record<string, unknown>) {
	return /subagent|sub_agent|fork/.test(JSON.stringify([payload.source, payload.thread_source, payload.originator]).toLowerCase())
}

export function collectSessionMetadata(envelopes: RecordEnvelope[]): { meta: SessionMetadata; recognizedRecords: number } {
	const models = new Set<string>()
	let recognizedRecords = 0
	let sessionId: string | undefined
	let cwd: string | undefined
	let startedAt: string | undefined
	let endedAt: string | undefined
	let cliVersion: string | undefined
	let gitBranch: string | undefined
	let forkedFromId: string | undefined
	let isSubagent = false

	for (const envelope of envelopes) {
		const record = envelope.record
		if (!record) continue
		const payload = recordPayload(record)
		if (record.timestamp) {
			startedAt ??= record.timestamp
			endedAt = record.timestamp
		}
		if (!CODEX_RECORD_TYPES.has(record.type)) continue
		recognizedRecords++
		if (record.type === 'session_meta') {
			sessionId = asString(payload.id) ?? asString(payload.session_id) ?? sessionId
			cwd = asString(payload.cwd) ?? cwd
			startedAt = asString(payload.timestamp) ?? record.timestamp ?? startedAt
			cliVersion = asString(payload.cli_version) ?? cliVersion
			gitBranch = asString(asObject(payload.git)?.branch) ?? gitBranch
			const threadSource = asObject(payload.thread_source)
			forkedFromId = asString(payload.forked_from_id) ?? asString(payload.parent_session_id) ?? asString(threadSource?.parent_thread_id) ?? asString(threadSource?.parent_session_id) ?? forkedFromId
			isSubagent ||= metaContainsSubagent(payload)
		} else if (record.type === 'turn_context') {
			cwd = asString(payload.cwd) ?? cwd
			const model = asString(payload.model)
			if (model) models.add(model)
		}
	}

	const modelList = [...models]
	return {
		meta: {
			id: sessionId,
			cwd,
			startedAt,
			endedAt,
			model: modelList.at(-1),
			models: modelList,
			cliVersion,
			gitBranch,
			forkedFromId,
			isSubagent
		},
		recognizedRecords
	}
}
