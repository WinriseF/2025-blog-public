import { describe, expect, it } from 'vitest'
import { FileEvidenceCollector } from '../../src/lib/codex-session/file-evidence'
import type { ParsedCommand, ProcessRun } from '../../src/lib/codex-session/types'

const context = { sequence: 1, callId: 'patch', sourceRefs: [{ line: 1, byteStart: 0, byteEnd: 10 }] }

function processWithCommands(commands: ParsedCommand[]): ProcessRun {
	return {
		id: 'process-1',
		sequence: 1,
		command: 'rg ...; Get-Content src/a.ts',
		status: 'completed',
		continuationCallIds: [],
		sourceRefs: [],
		analysis: { dialect: 'powershell', status: 'complete', commands, errorCount: 0, notes: [] }
	}
}

function command(id: string, normalizedName: string, raw: string): ParsedCommand {
	return { id, name: normalizedName, normalizedName, category: normalizedName === 'rg' ? 'search' : 'file', summary: normalizedName, raw, start: 0, end: raw.length, depth: 0, confidence: 'confirmed', inLoop: false, conditional: false, inPipeline: false }
}

describe('file evidence', () => {
	it('只把成功 patch_apply_end 的文件计入修改', () => {
		const collector = new FileEvidenceCollector()
		collector.addPatchApplyEnd({ 'C:\\Demo\\a.ts': { type: 'add', unified_diff: '+x' } }, true, context)
		collector.addPatchApplyEnd({ 'C:\\Demo\\rejected.ts': { type: 'update', unified_diff: '+bad' } }, false, { ...context, sequence: 2 })
		const result = collector.result()

		expect(result.changes).toHaveLength(1)
		expect(result.changes[0]).toMatchObject({ path: 'C:/Demo/a.ts', additions: 1 })
		expect(result.patchAttempts).toBe(2)
		expect(result.failedPatchAttempts).toBe(1)
	})

	it('搜索命令只计搜索操作，不读取搜索输出中的路径', () => {
		const collector = new FileEvidenceCollector()
		collector.addProcesses([processWithCommands([
			command('search', 'rg', 'rg -n TODO src'),
			command('read', 'get-content', 'Get-Content -LiteralPath src/a.ts')
		])])
		const result = collector.result()

		expect(result.searchOperations).toBe(1)
		expect(result.readOperations).toBe(1)
		expect(result.reads.map(file => file.path)).toEqual(['src/a.ts'])
	})

	it('明确读取工具保留状态并按路径合并', () => {
		const collector = new FileEvidenceCollector()
		collector.addToolCall('read_file', { path: 'src/a.ts' }, context)
		collector.addToolCall('read_file', { path: 'src/a.ts' }, { ...context, sequence: 2, callId: 'read-2' })
		collector.applyCallStatus('patch', 'completed')
		collector.applyCallStatus('read-2', 'failed')
		const file = collector.result().reads[0]

		expect(file).toMatchObject({ path: 'src/a.ts', count: 2 })
		expect(file.occurrences.map(item => item.status)).toEqual(['completed', 'failed'])
	})
})
