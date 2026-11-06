import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseClient } from '../../src/lib/database/client'
import { DATABASE_OPERATION_TIMEOUT_MS } from '../../src/lib/database/types'

class WorkerStub {
	static instances: WorkerStub[] = []
	onmessage?: (event: { data: unknown }) => void
	terminate = vi.fn()
	constructor() {
		WorkerStub.instances.push(this)
	}
	postMessage(command: { id: number; type: string; sql?: string }) {
		if (command.sql === 'hang') return
		queueMicrotask(() => this.onmessage?.({ data: { id: command.id, ok: true, data: command.type === 'open' ? { name: 'test.sqlite' } : { rows: [[42]] } } }))
	}
}
let client: DatabaseClient
beforeEach(async () => {
	vi.useFakeTimers()
	WorkerStub.instances = []
	vi.stubGlobal('Worker', WorkerStub)
	vi.stubGlobal('navigator', {
		storage: {
			getDirectory: async () => ({
				getDirectoryHandle: async () => {
					throw new DOMException('', 'NotFoundError')
				}
			})
		},
		locks: { request: (_name: string, callback: () => unknown) => Promise.resolve(callback()) }
	})
	client = new DatabaseClient()
	await client.open({ name: 'test.sqlite' } as File)
})
afterEach(() => {
	client.dispose()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})
describe('database operation deadline', () => {
	it('terminates an unresponsive worker and reopens for the next query', async () => {
		const pending = client.call({ type: 'query', sql: 'hang' }).catch(error => error)
		await vi.advanceTimersByTimeAsync(DATABASE_OPERATION_TIMEOUT_MS)
		expect((await pending).message).toContain('120 秒')
		expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce()
		expect(await client.call({ type: 'query', sql: 'SELECT 42' })).toEqual({ rows: [[42]] })
		expect(WorkerStub.instances).toHaveLength(2)
	})
	it('clears completed and cancelled operation timers', async () => {
		await client.call({ type: 'query', sql: 'SELECT 42' })
		await vi.advanceTimersByTimeAsync(DATABASE_OPERATION_TIMEOUT_MS)
		expect(WorkerStub.instances[0].terminate).not.toHaveBeenCalled()
		const pending = client.call({ type: 'query', sql: 'hang' }).catch(error => error)
		client.cancel()
		expect((await pending).message).toContain('取消')
		await vi.advanceTimersByTimeAsync(DATABASE_OPERATION_TIMEOUT_MS)
		expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce()
	})
})
