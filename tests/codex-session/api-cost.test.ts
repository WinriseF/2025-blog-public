import { describe, expect, it } from 'vitest'
import { estimateApiCost } from '../../src/lib/codex-session/api-cost'
import type { SessionTokenUsage, TokenUsageSample, TokenUsageNumbers } from '../../src/lib/codex-session/types'

function sample(index: number, model: string, input: number, cachedInput: number, cacheWriteInput: number, output: number): TokenUsageSample {
	return {
		id: `sample-${index}`,
		sequence: index,
		sourceRef: { line: index, byteStart: 0, byteEnd: 1 },
		model,
		input,
		freshInput: input - cachedInput,
		cachedInput,
		cacheWriteInput,
		output,
		reasoningOutput: output / 2,
		total: input + output
	}
}

function usage(samples: TokenUsageSample[]): SessionTokenUsage {
	const total = samples.reduce<TokenUsageNumbers>((sum, item) => ({
		input: sum.input + item.input,
		freshInput: sum.freshInput + item.freshInput,
		cachedInput: sum.cachedInput + item.cachedInput,
		cacheWriteInput: sum.cacheWriteInput + item.cacheWriteInput,
		output: sum.output + item.output,
		reasoningOutput: sum.reasoningOutput + item.reasoningOutput,
		total: sum.total + item.total
	}), { input: 0, freshInput: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 })
	return { status: 'available', scope: 'session', total, samples }
}

describe('estimateApiCost', () => {
	it('分别计价普通、缓存、写入和 Output，并在长上下文步骤切换单价', () => {
		const result = estimateApiCost(usage([
			sample(1, 'gpt-6-sol', 200_000, 140_000, 20_000, 10_000),
			sample(2, 'gpt-6-sol', 300_000, 0, 0, 10_000)
		]))
		expect(result?.steps[0].cost).toBeCloseTo(0.258)
		expect(result?.steps[1].cost).toBeCloseTo(1.35)
		expect(result?.total).toBeCloseTo(1.608)
	})

	it('识别清单中的模型别名', () => {
		const result = estimateApiCost(usage([sample(1, 'gpt-5.6', 100_000, 0, 0, 0)]))
		expect(result?.total).toBeCloseTo(0.4)
	})

	it('型号缺价或逐步样本不完整时不显示估算', () => {
		expect(estimateApiCost(usage([sample(1, 'unknown-model', 100, 0, 0, 10)]))).toBeUndefined()
		const incomplete = usage([sample(1, 'gpt-6-sol', 100, 0, 0, 10)])
		incomplete.total = { ...incomplete.total!, input: 101 }
		expect(estimateApiCost(incomplete)).toBeUndefined()
	})
})
