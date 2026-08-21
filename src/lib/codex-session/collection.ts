import type {
	ProjectTokenBucket,
	SessionCollectionAnalytics,
	SessionCollectionFilters,
	SessionParseResult,
	SessionSummary,
	TokenTimeBucket,
	TokenUsageNumbers
} from './types'
import { summarizePerformance } from './performance'

export const UNKNOWN_PROJECT = '__unknown_project__'

const emptyUsage = (): TokenUsageNumbers => ({
	input: 0,
	freshInput: 0,
	cachedInput: 0,
	cacheWriteInput: 0,
	output: 0,
	reasoningOutput: 0,
	total: 0
})

function addUsage(target: TokenUsageNumbers, value: TokenUsageNumbers) {
	target.input += value.input
	target.freshInput += value.freshInput
	target.cachedInput += value.cachedInput
	target.cacheWriteInput += value.cacheWriteInput
	target.output += value.output
	target.reasoningOutput += value.reasoningOutput
	target.total += value.total
}

export function normalizeProjectKey(cwd?: string) {
	const normalized = cwd?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
	if (!normalized) return UNKNOWN_PROJECT
	return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function projectLabel(key: string) {
	if (key === UNKNOWN_PROJECT) return '未知项目'
	return key.split('/').filter(Boolean).at(-1) ?? key
}

export function summarizeSession(key: string, relativePath: string | undefined, result: Pick<SessionParseResult, 'source' | 'meta' | 'tokenUsage' | 'performance' | 'diagnostics'>): SessionSummary {
	const samples = result.tokenUsage.samples.map(sample => ({
		input: sample.input,
		freshInput: sample.freshInput,
		cachedInput: sample.cachedInput,
		cacheWriteInput: sample.cacheWriteInput,
		output: sample.output,
		reasoningOutput: sample.reasoningOutput,
		total: sample.total,
		timestamp: sample.timestamp,
		turnId: sample.turnId,
		cwd: sample.cwd,
		model: sample.model
	}))
	let projectKeys = [...new Set([
		...samples.map(sample => normalizeProjectKey(sample.cwd)),
		normalizeProjectKey(result.meta.cwd)
	])]
	if (projectKeys.length > 1) projectKeys = projectKeys.filter(key => key !== UNKNOWN_PROJECT)

	return {
		key,
		relativePath,
		source: result.source,
		meta: result.meta,
		tokenUsage: {
			status: result.tokenUsage.status,
			scope: result.tokenUsage.scope,
			total: result.tokenUsage.total,
			samples
		},
		performance: result.performance,
		projectKeys,
		requestCount: samples.length,
		warningCount: result.diagnostics.filter(item => item.severity !== 'info').length
	}
}

export function localDateKey(timestamp?: string) {
	if (!timestamp) return
	const date = new Date(timestamp)
	if (Number.isNaN(date.getTime())) return
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function sessionMatchesDate(session: SessionSummary, filters: SessionCollectionFilters) {
	if (!filters.dateFrom && !filters.dateTo) return true
	const start = localDateKey(session.meta.startedAt)
	const end = localDateKey(session.meta.endedAt) ?? start
	if (!start || !end) return false
	return !(filters.dateFrom && end < filters.dateFrom) && !(filters.dateTo && start > filters.dateTo)
}

function sampleMatchesDate(timestamp: string | undefined, filters: SessionCollectionFilters) {
	if (!filters.dateFrom && !filters.dateTo) return true
	const key = localDateKey(timestamp)
	if (!key) return false
	return !(filters.dateFrom && key < filters.dateFrom) && !(filters.dateTo && key > filters.dateTo)
}

export function buildCollectionAnalytics(allSessions: SessionSummary[], filters: SessionCollectionFilters): SessionCollectionAnalytics {
	const sessions = allSessions.filter(session => {
		if (!sessionMatchesDate(session, filters)) return false
		if (filters.projectKey && !session.projectKeys.includes(filters.projectKey)) return false
		if (filters.model && !session.meta.models.includes(filters.model) && !session.tokenUsage.samples.some(sample => sample.model === filters.model)) return false
		return true
	})
	const total = emptyUsage()
	let requestCount = 0
	const daily = new Map<string, TokenTimeBucket & { sessionIds: Set<string> }>()
	const projects = new Map<string, ProjectTokenBucket & { sessionIds: Set<string> }>()
	let unallocatedTokens = 0
	const performanceTurns = sessions.flatMap(session => session.performance.turns.filter(turn => {
		if (!sampleMatchesDate(turn.startedAt ?? turn.endedAt, filters)) return false
		if (filters.projectKey && normalizeProjectKey(turn.cwd ?? session.meta.cwd) !== filters.projectKey) return false
		if (filters.model && (turn.model ?? session.meta.model) !== filters.model) return false
		return true
	}))

	for (const session of sessions) {
		for (const sample of session.tokenUsage.samples) {
			const projectKey = normalizeProjectKey(sample.cwd ?? session.meta.cwd)
			const model = sample.model ?? session.meta.model
			if (!sampleMatchesDate(sample.timestamp, filters) || (filters.projectKey && projectKey !== filters.projectKey) || (filters.model && model !== filters.model)) continue
			addUsage(total, sample)
			requestCount++

			const dayKey = localDateKey(sample.timestamp)
			if (dayKey) {
				const bucket = daily.get(dayKey) ?? { ...emptyUsage(), key: dayKey, sessionCount: 0, unallocated: 0, sessionIds: new Set<string>() }
				addUsage(bucket, sample)
				bucket.sessionIds.add(session.key)
				daily.set(dayKey, bucket)
			}

			const bucket = projects.get(projectKey) ?? {
				...emptyUsage(),
				key: projectKey,
				label: projectLabel(projectKey),
				sessionCount: 0,
				unallocated: 0,
				lastUsedAt: sample.timestamp,
				sessionIds: new Set<string>()
			}
			addUsage(bucket, sample)
			bucket.sessionIds.add(session.key)
			if (sample.timestamp && (!bucket.lastUsedAt || sample.timestamp > bucket.lastUsedAt)) bucket.lastUsedAt = sample.timestamp
			projects.set(projectKey, bucket)
		}

		if (session.tokenUsage.status !== 'available' || !session.tokenUsage.total) continue
		const attributed = session.tokenUsage.samples.reduce((sum, sample) => sum + sample.total, 0)
		const unallocated = Math.max(session.tokenUsage.total.total - attributed, 0)
		if (!unallocated) continue
		const timestamp = session.meta.endedAt ?? session.meta.startedAt
		const projectKey = normalizeProjectKey(session.meta.cwd)
		if (!sampleMatchesDate(timestamp, filters) || (filters.projectKey && projectKey !== filters.projectKey) || (filters.model && session.meta.model !== filters.model)) continue
		unallocatedTokens += unallocated
		total.total += unallocated

		const dayKey = localDateKey(timestamp)
		if (dayKey) {
			const bucket = daily.get(dayKey) ?? { ...emptyUsage(), key: dayKey, sessionCount: 0, unallocated: 0, sessionIds: new Set<string>() }
			bucket.total += unallocated
			bucket.unallocated += unallocated
			bucket.sessionIds.add(session.key)
			daily.set(dayKey, bucket)
		}

		const bucket = projects.get(projectKey) ?? {
			...emptyUsage(),
			key: projectKey,
			label: projectLabel(projectKey),
			sessionCount: 0,
			unallocated: 0,
			lastUsedAt: timestamp,
			sessionIds: new Set<string>()
		}
		bucket.total += unallocated
		bucket.unallocated += unallocated
		bucket.sessionIds.add(session.key)
		projects.set(projectKey, bucket)
	}

	return {
		sessions,
		total,
		requestCount,
		daily: [...daily.values()].map(({ sessionIds, ...bucket }) => ({ ...bucket, sessionCount: sessionIds.size })).sort((left, right) => left.key.localeCompare(right.key)),
		projects: [...projects.values()].map(({ sessionIds, ...bucket }) => ({ ...bucket, sessionCount: sessionIds.size })).sort((left, right) => right.total - left.total || left.key.localeCompare(right.key)),
		performance: summarizePerformance(performanceTurns),
		unallocatedTokens,
		activeDays: daily.size
	}
}
