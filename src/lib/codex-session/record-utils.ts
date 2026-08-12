import { z } from 'zod'
import type { SourceRef } from './types'

export const codexRecordSchema = z
	.object({
		timestamp: z.string().optional(),
		type: z.string(),
		payload: z.unknown().optional()
	})
	.passthrough()

export const tokenUsageSchema = z
	.object({
		input_tokens: z.number().int().nonnegative().optional(),
		cached_input_tokens: z.number().int().nonnegative().optional(),
		cache_write_input_tokens: z.number().int().nonnegative().optional(),
		output_tokens: z.number().int().nonnegative().optional(),
		reasoning_output_tokens: z.number().int().nonnegative().optional(),
		total_tokens: z.number().int().nonnegative()
	})
	.passthrough()

export type CodexRecord = z.infer<typeof codexRecordSchema>
export type UnknownRecord = Record<string, unknown>

export type RecordEnvelope = {
	sequence: number
	sourceRef: SourceRef
	record?: CodexRecord
	parseError?: string
}

export function isObject(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asObject(value: unknown): UnknownRecord | undefined {
	return isObject(value) ? value : undefined
}

export function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined
}

export function parseJsonObject(value: unknown): UnknownRecord | undefined {
	if (isObject(value)) return value
	if (typeof value !== 'string') return
	try {
		return asObject(JSON.parse(value))
	} catch {
		return
	}
}

export function extractText(value: unknown, depth = 0): string {
	if (depth > 5 || value == null) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) return value.map(item => extractText(item, depth + 1)).filter(Boolean).join('\n')
	if (!isObject(value)) return ''

	for (const key of ['text', 'message', 'content', 'output']) {
		if (key in value) {
			const text = extractText(value[key], depth + 1)
			if (text) return text
		}
	}
	return ''
}

export function recordPayload(record: CodexRecord): UnknownRecord {
	return asObject(record.payload) ?? {}
}

export function payloadType(record: CodexRecord): string | undefined {
	return asString(recordPayload(record).type)
}
