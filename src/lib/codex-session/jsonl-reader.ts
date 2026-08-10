import parserWebStream from 'stream-chain/jsonl/parserWebStream.js'
import type { RecordEnvelope } from './parser-internal'
import { codexRecordSchema, isObject } from './record-utils'
import type { SourceRef } from './types'

type JsonlErrorMarker = {
	__codexJsonlError: true
	message: string
}

type ReadProgress = {
	bytesRead: number
	records: number
	diagnostics: number
}

const isErrorMarker = (value: unknown): value is JsonlErrorMarker => isObject(value) && value.__codexJsonlError === true

async function bomOffset(file: File) {
	if (file.size < 3) return 0
	const prefix = new Uint8Array(await file.slice(0, 3).arrayBuffer())
	return prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf ? 3 : 0
}

export async function readJsonlFile(file: File, onProgress?: (progress: ReadProgress) => void, signal?: AbortSignal) {
	const startOffset = await bomOffset(file)
	const sourceRefs: SourceRef[] = []
	let byteOffset = startOffset
	let lineStart = startOffset
	let line = 1
	let previousByte: number | undefined
	let records = 0
	let diagnostics = 0
	let lastProgressAt = 0

	const report = (force = false) => {
		const now = performance.now()
		if (!force && now - lastProgressAt < 80) return
		lastProgressAt = now
		onProgress?.({ bytesRead: byteOffset, records, diagnostics })
	}

	const indexer = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			for (const byte of chunk) {
				if (byte === 0x0a) {
					const previousIsCarriageReturn = byteOffset > lineStart && previousByte === 0x0d
					const byteEnd = previousIsCarriageReturn ? byteOffset - 1 : byteOffset
					if (byteEnd > lineStart) sourceRefs.push({ line, byteStart: lineStart, byteEnd })
					line++
					lineStart = byteOffset + 1
				}
				previousByte = byte
				byteOffset++
			}
			controller.enqueue(chunk)
			report()
		},
		flush() {
			if (byteOffset > lineStart) sourceRefs.push({ line, byteStart: lineStart, byteEnd: byteOffset })
			report(true)
		}
	})

	const { readable, writable } = parserWebStream<unknown>({
		errorIndicator: (error: Error) => ({
			__codexJsonlError: true,
			message: error.message
		}) satisfies JsonlErrorMarker
	})
	const pipePromise = file.slice(startOffset).stream().pipeThrough(indexer).pipeTo(writable, { signal })
	const reader = readable.getReader()
	const envelopes: RecordEnvelope[] = []

	try {
		while (true) {
			const item = await reader.read()
			if (item.done) break
			const { key, value } = item.value
			const sourceRef = sourceRefs[key] ?? { line: key + 1, byteStart: 0, byteEnd: 0 }
			const sequence = key + 1
			records++
			if (isErrorMarker(value)) {
				diagnostics++
				envelopes.push({ sequence, sourceRef, parseError: value.message })
			} else {
				const parsed = codexRecordSchema.safeParse(value)
				if (parsed.success) envelopes.push({ sequence, sourceRef, record: parsed.data })
				else {
					diagnostics++
					envelopes.push({ sequence, sourceRef, parseError: parsed.error.issues[0]?.message ?? '记录结构无效' })
				}
			}
			report()
		}
		await pipePromise
	} catch (error) {
		void reader.cancel(error)
		await pipePromise.catch(() => undefined)
		throw error
	} finally {
		reader.releaseLock()
	}

	report(true)
	return {
		records: envelopes,
		lineCount: file.size === startOffset ? 0 : lineStart === byteOffset ? Math.max(line - 1, 0) : line,
		diagnosticCount: diagnostics
	}
}
