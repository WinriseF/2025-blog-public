import { describe, expect, it } from 'vitest'
import { readJsonlFile } from '../../src/lib/codex-session/jsonl-reader'

describe('readJsonlFile', () => {
	it('保留物理行号并在 BOM、空行和损坏行后继续', async () => {
		const file = new File(['\ufeff{"type":"session_meta","payload":{}}\r\n\r\nnot-json\n{"type":"event_msg","payload":{"type":"task_complete"}}'], 'session.jsonl')
		const parsed = await readJsonlFile(file)

		expect(parsed.records).toHaveLength(3)
		expect(parsed.records.map(item => item.sourceRef.line)).toEqual([1, 3, 4])
		expect(parsed.records[1].parseError).toBeTruthy()
		expect(parsed.records[2].record?.type).toBe('event_msg')
	})
})
