import { asString, payloadType, recordPayload, type RecordEnvelope } from './record-utils'
import type { PerformanceMetrics, SessionPerformance, SessionTokenUsage, TurnPerformance } from './types'

type MutableTurn = TurnPerformance & { startPriority: number }

function timestampMs(value?: string) {
	if (!value) return
	const time = new Date(value).getTime()
	return Number.isFinite(time) ? time : undefined
}

function setStart(turn: MutableTurn, timestamp: string | undefined, priority: number) {
	if (!timestamp) return
	if (!turn.startedAt || priority > turn.startPriority || (priority === turn.startPriority && timestamp < turn.startedAt)) {
		turn.startedAt = timestamp
		turn.startPriority = priority
	}
}

function setFirstResponse(turn: MutableTurn, timestamp?: string) {
	if (!timestamp) return
	if (!turn.firstResponseAt || timestamp < turn.firstResponseAt) turn.firstResponseAt = timestamp
}

export function buildSessionPerformance(envelopes: RecordEnvelope[], usage: SessionTokenUsage): SessionPerformance {
	const turns = new Map<string, MutableTurn>()
	let currentTurnId: string | undefined
	let syntheticId = 0

	const getTurn = (id = currentTurnId ?? `turn-${++syntheticId}`) => {
		currentTurnId = id
		let turn = turns.get(id)
		if (!turn) {
			turn = { id, requestCount: 0, outputTokens: 0, startPriority: -1 }
			turns.set(id, turn)
		}
		return turn
	}

	const enterTurn = (id: string | undefined, timestamp?: string) => {
		if (id && currentTurnId && currentTurnId !== id) {
			const previous = turns.get(currentTurnId)
			if (previous && !previous.endedAt) previous.endedAt = timestamp
		}
		return getTurn(id ?? currentTurnId)
	}

	for (const envelope of envelopes) {
		const record = envelope.record
		if (!record) continue
		const payload = recordPayload(record)
		const itemType = payloadType(record)
		const timestamp = record.timestamp

		if (record.type === 'turn_context') {
			const turn = enterTurn(asString(payload.turn_id), timestamp)
			turn.cwd = asString(payload.cwd) ?? turn.cwd
			turn.model = asString(payload.model) ?? turn.model
			setStart(turn, timestamp, 0)
			continue
		}

		if (record.type === 'response_item' && itemType === 'message') {
			const role = asString(payload.role)
			if (role === 'user') setStart(getTurn(), timestamp, 2)
			else if (role === 'assistant') setFirstResponse(getTurn(), timestamp)
			continue
		}

		if (record.type !== 'event_msg') continue
		if (itemType === 'task_started') {
			setStart(enterTurn(asString(payload.turn_id), timestamp), timestamp, 1)
		} else if (itemType === 'user_message') {
			setStart(getTurn(), timestamp, 3)
		} else if (itemType === 'agent_message') {
			setFirstResponse(getTurn(), timestamp)
		} else if (itemType === 'task_complete' || itemType === 'turn_aborted') {
			const turn = getTurn()
			turn.endedAt = timestamp ?? turn.endedAt
		}
	}

	const ordered = [...turns.values()].sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
	for (const sample of usage.samples) {
		let turn = sample.turnId ? turns.get(sample.turnId) : undefined
		if (!turn) {
			const sampleTime = timestampMs(sample.timestamp)
			turn = ordered.findLast(item => {
				const start = timestampMs(item.startedAt)
				return sampleTime !== undefined && start !== undefined && start <= sampleTime
			})
		}
		if (!turn && sample.turnId) turn = getTurn(sample.turnId)
		if (!turn) continue
		turn.cwd = sample.cwd ?? turn.cwd
		turn.model = sample.model ?? turn.model
		turn.requestCount++
		turn.outputTokens += sample.output
	}

	return {
		turns: [...turns.values()]
			.map(({ startPriority: _, ...turn }) => turn)
			.filter(turn => turn.startedAt || turn.firstResponseAt || turn.requestCount)
			.sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
	}
}

function percentile(values: number[], percentileValue: number) {
	if (!values.length) return
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.max(Math.ceil(sorted.length * percentileValue) - 1, 0)]
}

export function summarizePerformance(turns: TurnPerformance[]): PerformanceMetrics {
	const firstResponses = turns.flatMap(turn => {
		const start = timestampMs(turn.startedAt)
		const response = timestampMs(turn.firstResponseAt)
		return start !== undefined && response !== undefined && response >= start ? [response - start] : []
	})
	const completedTurns = turns.flatMap(turn => {
		const start = timestampMs(turn.startedAt)
		const end = timestampMs(turn.endedAt)
		return start !== undefined && end !== undefined && end > start ? [{ duration: end - start, outputTokens: turn.outputTokens }] : []
	})
	const totalDuration = completedTurns.reduce((sum, turn) => sum + turn.duration, 0)
	const completedOutputTokens = completedTurns.reduce((sum, turn) => sum + turn.outputTokens, 0)
	const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0)

	return {
		turnCount: turns.length,
		firstResponseCount: firstResponses.length,
		completedTurnCount: completedTurns.length,
		requestCount: turns.reduce((sum, turn) => sum + turn.requestCount, 0),
		outputTokens,
		firstResponseAverageMs: firstResponses.length ? firstResponses.reduce((sum, value) => sum + value, 0) / firstResponses.length : undefined,
		firstResponseP50Ms: percentile(firstResponses, 0.5),
		firstResponseP95Ms: percentile(firstResponses, 0.95),
		averageTurnDurationMs: completedTurns.length ? totalDuration / completedTurns.length : undefined,
		outputTokensPerSecond: totalDuration && completedOutputTokens ? completedOutputTokens / (totalDuration / 1000) : undefined
	}
}
