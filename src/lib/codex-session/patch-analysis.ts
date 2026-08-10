import { parsePatchFiles } from '@pierre/diffs'
import type { FilePatch } from './types'

export type PatchInput = Pick<FilePatch, 'path' | 'oldPath' | 'operation' | 'diff'>

export type PatchAnalysis = {
	mode: FilePatch['diffMode']
	additions: number
	deletions: number
	normalizedPatch?: string
}

function headerPath(prefix: 'a' | 'b', path: string) {
	return `${prefix}/${path.replace(/\\/g, '/').replace(/[\r\n]/g, '')}`
}

function patchHeaders(input: PatchInput) {
	const oldPath = input.operation === 'create' ? '/dev/null' : headerPath('a', input.oldPath ?? input.path)
	const newPath = input.operation === 'delete' ? '/dev/null' : headerPath('b', input.path)
	return `--- ${oldPath}\n+++ ${newPath}`
}

export function normalizeCodexPatch(input: PatchInput) {
	const diff = input.diff?.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
	if (!diff?.trim()) return
	if (/^--- .+\n\+\+\+ /m.test(diff)) return diff

	const hunkStart = diff.search(/^@@ /m)
	if (hunkStart >= 0) return `${patchHeaders(input)}\n${diff.slice(hunkStart)}`

	const lines = diff.split('\n').filter(line => line !== '\\ No newline at end of file')
	if (input.operation === 'create' && lines.length && lines.every(line => line.startsWith('+'))) {
		return `${patchHeaders(input)}\n@@ -0,0 +1,${lines.length} @@\n${diff}`
	}
	if (input.operation === 'delete' && lines.length && lines.every(line => line.startsWith('-'))) {
		return `${patchHeaders(input)}\n@@ -1,${lines.length} +0,0 @@\n${diff}`
	}
}

function fragmentStats(diff: string | undefined) {
	let additions = 0
	let deletions = 0
	for (const line of diff?.split(/\r?\n/) ?? []) {
		if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('@@')) continue
		if (line.startsWith('+')) additions++
		else if (line.startsWith('-')) deletions++
	}
	return { additions, deletions }
}

export function analyzeCodexPatch(input: PatchInput, cacheKey: string): PatchAnalysis {
	const normalizedPatch = normalizeCodexPatch(input)
	if (normalizedPatch) {
		try {
			const files = parsePatchFiles(normalizedPatch, cacheKey, true).flatMap(group => group.files)
			if (files.length === 1) {
				const metadata = files[0]
				return {
					mode: 'parsed',
					additions: metadata.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
					deletions: metadata.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
					normalizedPatch
				}
			}
		} catch {
			// Some Codex records contain only loose changed lines, without recoverable hunk structure.
		}
	}

	const counts = fragmentStats(input.diff)
	return { mode: input.diff?.trim() ? 'fragment' : 'missing', ...counts }
}
