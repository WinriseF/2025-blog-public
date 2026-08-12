import { describe, expect, it } from 'vitest'
import { parseCodexSession } from '../../src/lib/codex-session/parser'
import type { RecordEnvelope } from '../../src/lib/codex-session/record-utils'

function record(sequence: number, type: string, payload: Record<string, unknown>): RecordEnvelope {
	return { sequence, sourceRef: { line: sequence, byteStart: sequence * 100, byteEnd: sequence * 100 + 90 }, record: { timestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`, type, payload } }
}

const source = { name: 'synthetic.jsonl', size: 1000, lastModified: 0, lineCount: 20 }

describe('parseCodexSession', () => {
	it('按 call_id 关联结果先出现的明确读取工具', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'response_item', { type: 'function_call_output', call_id: 'late', output: 'done' }),
			record(3, 'response_item', { type: 'function_call', name: 'read_file', call_id: 'late', arguments: '{"path":"src/b.ts"}' })
		])

		expect(result.fileAudit.reads).toMatchObject([{ path: 'src/b.ts', count: 1 }])
		expect(result.diagnostics.some(item => item.code === 'TOOL_CALL_MISSING')).toBe(false)
	})

	it('将唯一的内层 exec_command 结果聚合为一次进程', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'turn_context', { turn_id: 't1' }),
			record(3, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'outer', input: "await tools.exec_command({ cmd: 'echo ok', workdir: 'C:\\\\demo' })" }),
			record(4, 'response_item', { type: 'custom_tool_call_output', call_id: 'outer', output: [{ type: 'input_text', text: 'Process exited with code 0\\nok' }] })
		])

		expect(result.processes).toHaveLength(1)
		expect(result.processes[0]).toMatchObject({ command: 'echo ok', status: 'completed', exitCode: 0 })
	})

	it('并行内层调用共享结果时不伪造每条命令成功', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'outer', input: "await Promise.all([tools.shell_command({ command: 'git status' }), tools.shell_command({ command: 'docker ps' })])" }),
			record(3, 'response_item', { type: 'custom_tool_call_output', call_id: 'outer', output: 'both tools returned' })
		])

		expect(result.processes.map(process => process.command)).toEqual(['git status', 'docker ps'])
		expect(result.processes.every(process => process.status === 'unknown')).toBe(true)
	})

	it('保留 local_shell_call 的 argv 边界，并在无退出码时保持未知', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'response_item', { type: 'local_shell_call', call_id: 'local', action: { type: 'exec', command: ['git', 'commit', '-m', 'fix; docker ps'], working_directory: 'C:\\demo' } }),
			record(3, 'response_item', { type: 'local_shell_call_output', call_id: 'local', output: 'created commit' })
		])

		expect(result.processes[0]).toEqual(expect.objectContaining({ argv: ['git', 'commit', '-m', 'fix; docker ps'], executionMode: 'argv', status: 'unknown' }))
	})

	it('按 cell_id 合并启动、轮询和退出状态', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'response_item', { type: 'function_call', name: 'exec_command', call_id: 'start', arguments: '{"cmd":"long-job"}' }),
			record(3, 'response_item', { type: 'function_call_output', call_id: 'start', output: 'Script running with cell ID cell-1' }),
			record(4, 'response_item', { type: 'function_call', name: 'wait', call_id: 'poll', arguments: '{"cell_id":"cell-1"}' }),
			record(5, 'response_item', { type: 'function_call_output', call_id: 'poll', output: 'Process exited with code 0' })
		])

		expect(result.processes).toHaveLength(1)
		expect(result.processes[0]).toMatchObject({ status: 'completed', exitCode: 0, cellId: 'cell-1', continuationCallIds: ['poll'] })
	})

	it('保留缺失结果并生成诊断，而不是伪造成功', () => {
		const result = parseCodexSession(source, [record(1, 'session_meta', { id: 's1' }), record(2, 'response_item', { type: 'function_call', name: 'exec_command', call_id: 'missing', arguments: '{"cmd":"git status"}' })])
		expect(result.processes[0]?.status).toBe('unknown')
		expect(result.diagnostics.some(item => item.code === 'TOOL_RESULT_MISSING')).toBe(true)
	})

	it('失败 patch_apply_end 只计尝试，不计入修改文件', () => {
		const result = parseCodexSession(source, [
			record(1, 'session_meta', { id: 's1' }),
			record(2, 'event_msg', { type: 'patch_apply_end', success: false, changes: { 'src/rejected.ts': { type: 'update', unified_diff: '+bad' } } }),
			record(3, 'event_msg', { type: 'patch_apply_end', success: true, changes: { 'src/ok.ts': { type: 'update', unified_diff: '+ok' } } })
		])
		expect(result.fileAudit.changes.map(file => file.path)).toEqual(['src/ok.ts'])
		expect(result.fileAudit.failedPatchAttempts).toBe(1)
	})
})
