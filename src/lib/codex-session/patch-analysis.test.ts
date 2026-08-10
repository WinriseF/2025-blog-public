import { describe, expect, it } from 'vitest'
import { analyzeCodexPatch, normalizeCodexPatch } from './patch-analysis'
import type { PatchInput } from './patch-analysis'

function patch(diff: string | undefined, operation: PatchInput['operation'] = 'modify'): PatchInput {
	return { path: 'src/example.ts', operation, diff }
}

describe('Codex patch analysis', () => {
	it('使用 Pierre 解析完整 unified diff', () => {
		const result = analyzeCodexPatch(patch('--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n same'), 'full')
		expect(result).toMatchObject({ mode: 'parsed', additions: 1, deletions: 1 })
	})

	it('为缺少文件头的 hunk 补齐路径', () => {
		const input = patch('@@ -4,2 +4,2 @@\n-old\n+new\n same')
		expect(normalizeCodexPatch(input)).toBe('--- a/src/example.ts\n+++ b/src/example.ts\n@@ -4,2 +4,2 @@\n-old\n+new\n same')
		expect(analyzeCodexPatch(input, 'hunk')).toMatchObject({ mode: 'parsed', additions: 1, deletions: 1 })
	})

	it('为纯新增片段构造可解析 hunk', () => {
		const result = analyzeCodexPatch(patch('+const value = 1\n+export { value }', 'create'), 'create')
		expect(result).toMatchObject({ mode: 'parsed', additions: 2, deletions: 0 })
		expect(result.normalizedPatch).toContain('@@ -0,0 +1,2 @@')
	})

	it('为纯删除片段构造可解析 hunk', () => {
		const result = analyzeCodexPatch(patch('-const value = 1\n-export { value }', 'delete'), 'delete')
		expect(result).toMatchObject({ mode: 'parsed', additions: 0, deletions: 2 })
		expect(result.normalizedPatch).toContain('@@ -1,2 +0,0 @@')
	})

	it('无法恢复 hunk 时只统计明确的增删行', () => {
		const result = analyzeCodexPatch(patch('-old\n+new\n context'), 'fragment')
		expect(result).toMatchObject({ mode: 'fragment', additions: 1, deletions: 1 })
		expect(result.normalizedPatch).toBeUndefined()
	})

	it('不会把内容中的连续加减号误认为文件头', () => {
		const result = analyzeCodexPatch(patch('+++not-a-header\n---not-a-header'), 'content-prefix')
		expect(result).toMatchObject({ mode: 'fragment', additions: 1, deletions: 1 })
	})

	it('没有差异文本时标记为 missing', () => {
		expect(analyzeCodexPatch(patch(undefined), 'missing')).toMatchObject({ mode: 'missing', additions: 0, deletions: 0 })
	})
})
