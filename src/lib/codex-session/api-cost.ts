import priceCatalog from '@/config/codex-api-pricing.json'
import type { SessionTokenUsage, TokenUsageNumbers } from './types'

type ApiRates = { input: number; cachedInput: number; cacheWriteInput: number; output: number }
type ModelPrice = { aliases?: string[]; rates: ApiRates; longContext?: { minInputTokens: number; rates: ApiRates } }
type CostParts = ApiRates

export type ApiCostStep = { step: number; model: string; cost: number; cumulative: number }
export type ApiCostEstimate = { total: number; parts: CostParts; steps: ApiCostStep[] }

const models = priceCatalog.models as Record<string, ModelPrice>

function modelPrice(name: string) {
	return models[name] ?? Object.values(models).find(model => model.aliases?.includes(name))
}

export function estimateApiCost(usage: SessionTokenUsage, fallbackModel?: string): ApiCostEstimate | undefined {
	const total = usage.total
	if (usage.status !== 'available' || usage.scope !== 'session' || usage.complete === false || !total || !usage.samples.length) return
	const fields: Array<keyof TokenUsageNumbers> = ['input', 'cachedInput', 'cacheWriteInput', 'output', 'total']
	if (fields.some(field => usage.samples.reduce((sum, sample) => sum + sample[field], 0) !== total[field])) return

	const parts: CostParts = { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0 }
	const steps: ApiCostStep[] = []
	let cumulative = 0
	for (const [index, sample] of usage.samples.entries()) {
		const name = sample.model || fallbackModel
		const price = name && modelPrice(name)
		if (!name || !price || sample.cachedInput + sample.cacheWriteInput > sample.input) return
		const rates = price.longContext && sample.input >= price.longContext.minInputTokens ? price.longContext.rates : price.rates
		const divisor = priceCatalog.unitTokens
		const cost = {
			input: (sample.input - sample.cachedInput - sample.cacheWriteInput) * rates.input / divisor,
			cachedInput: sample.cachedInput * rates.cachedInput / divisor,
			cacheWriteInput: sample.cacheWriteInput * rates.cacheWriteInput / divisor,
			output: sample.output * rates.output / divisor
		}
		const stepCost = cost.input + cost.cachedInput + cost.cacheWriteInput + cost.output
		for (const field of Object.keys(parts) as Array<keyof CostParts>) parts[field] += cost[field]
		cumulative += stepCost
		steps.push({ step: index + 1, model: name, cost: stepCost, cumulative })
	}
	return { total: cumulative, parts, steps }
}
