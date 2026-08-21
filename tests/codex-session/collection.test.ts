import { describe, expect, it } from 'vitest'
import { buildCollectionAnalytics, normalizeProjectKey } from '../../src/lib/codex-session/collection'
import type { SessionSummary, SessionSummaryTokenSample } from '../../src/lib/codex-session/types'

function sample(total: number, timestamp: string, cwd: string): SessionSummaryTokenSample {
	return {
		input: total - 20,
		freshInput: total - 40,
		cachedInput: 20,
		cacheWriteInput: 0,
		output: 20,
		reasoningOutput: 5,
		total,
		timestamp,
		cwd,
		model: 'gpt-test'
	}
}

function summary(id: string, samples: SessionSummaryTokenSample[], inherited = false, recordedTotal?: number): SessionSummary {
	const cwd = samples.at(-1)?.cwd
	return {
		key: `key-${id}`,
		source: { name: `${id}.jsonl`, size: 100, lastModified: 1, recordCount: 5, lineCount: 5 },
		meta: {
			id,
			cwd,
			startedAt: samples[0]?.timestamp,
			endedAt: samples.at(-1)?.timestamp,
			model: 'gpt-test',
			models: ['gpt-test'],
			isSubagent: inherited
		},
		tokenUsage: {
			status: recordedTotal ? 'available' : 'missing',
			scope: inherited ? 'possibly-inherited' : 'session',
			total: recordedTotal ? { input: recordedTotal - 20, freshInput: recordedTotal - 40, cachedInput: 20, cacheWriteInput: 0, output: 20, reasoningOutput: 5, total: recordedTotal } : undefined,
			samples
		},
		performance: { turns: [] },
		projectKeys: [...new Set(samples.map(item => normalizeProjectKey(item.cwd)))],
		requestCount: samples.length,
		warningCount: 0
	}
}

describe('session collection analytics', () => {
	it('按本地日期和请求当时的项目汇总 Token', () => {
		const sessions = [
			summary('root', [
				sample(100, '2026-01-01T10:00:00', 'C:\\work\\alpha'),
				sample(200, '2026-01-02T10:00:00', 'C:\\work\\beta')
			], false, 350),
			summary('child', [sample(500, '2026-01-02T11:00:00', 'C:\\work\\alpha')], true, 900)
		]
		const analytics = buildCollectionAnalytics(sessions, {})

		expect(analytics.total.total).toBe(1250)
		expect(analytics.requestCount).toBe(3)
		expect(analytics.daily.map(day => [day.key, day.total])).toEqual([['2026-01-01', 100], ['2026-01-02', 1150]])
		expect(analytics.projects.map(project => [project.label, project.total])).toEqual([['alpha', 1000], ['beta', 250]])
		expect(analytics.unallocatedTokens).toBe(450)
	})

	it('每个选中 rollout 都按自己的累计总量统计', () => {
		const root = summary('root', [sample(100, '2026-01-01T10:00:00', 'C:\\work\\alpha')], false, 100)
		const child = summary('child', [sample(200, '2026-01-01T11:00:00', 'C:\\work\\alpha')], true, 900)
		const analytics = buildCollectionAnalytics([root, child], {})
		expect(analytics.total.total).toBe(1000)
		expect(analytics.sessions).toHaveLength(2)
		expect(analytics.unallocatedTokens).toBe(700)
	})

	it('项目筛选只统计归属于该项目的请求', () => {
		const session = summary('mixed', [
			sample(100, '2026-01-01T10:00:00', 'C:\\work\\alpha'),
			sample(200, '2026-01-02T10:00:00', 'C:\\work\\beta')
		])
		const analytics = buildCollectionAnalytics([session], { projectKey: normalizeProjectKey('C:\\work\\alpha') })
		expect(analytics.total.total).toBe(100)
		expect(analytics.requestCount).toBe(1)
		expect(analytics.projects).toHaveLength(1)
	})

	it('内部 Session ID 相同的不同 rollout 仍分别统计', () => {
		const first = summary('shared', [sample(100, '2026-01-01T10:00:00', 'C:\\work\\alpha')])
		const second = { ...summary('shared', [sample(200, '2026-01-01T11:00:00', 'C:\\work\\alpha')]), key: 'second-rollout' }
		const analytics = buildCollectionAnalytics([first, second], {})
		expect(analytics.sessions).toHaveLength(2)
		expect(analytics.total.total).toBe(300)
	})

	it('按筛选后的回合汇总响应性能', () => {
		const session = summary('timed', [sample(100, '2026-01-01T10:00:05', 'C:\\work\\alpha')])
		session.performance.turns = [{
			id: 'turn-1',
			startedAt: '2026-01-01T10:00:00',
			firstResponseAt: '2026-01-01T10:00:02',
			endedAt: '2026-01-01T10:00:10',
			cwd: 'C:\\work\\alpha',
			model: 'gpt-test',
			requestCount: 1,
			outputTokens: 20
		}]
		const analytics = buildCollectionAnalytics([session], { projectKey: normalizeProjectKey('C:\\work\\alpha') })
		expect(analytics.performance).toMatchObject({ firstResponseP50Ms: 2000, averageTurnDurationMs: 10000, outputTokensPerSecond: 2 })
	})
})
