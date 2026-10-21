import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore } from '@edgeone/pages-blob'
import { onRequest } from '../../edge-functions/api/transfer/[[default]].js'

vi.mock('@edgeone/pages-blob', () => ({ getStore: vi.fn() }))

const id = 'A'.repeat(24)
const token = 'B'.repeat(43)
const marker = `transfer/items/${id}/consumed.json`
const chunkKey = (index: number) => `transfer/items/${id}/chunks/part-${String(index).padStart(5, '0')}.bin`

async function fixture() {
	const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url')
	const objects = new Set([marker, ...Array.from({ length: 200 }, (_, index) => chunkKey(index)), 'transfer/items/other/chunks/part-00000.bin'])
	const failures = new Set<string>()
	let active = 0
	let maxActive = 0
	const store = {
		get: vi.fn(async (key: string) => key === marker ? { chunkCount: 200, receiptHash: hash } : null),
		delete: vi.fn(async (key: string) => {
			maxActive = Math.max(maxActive, ++active)
			await Promise.resolve()
			active--
			if (failures.has(key)) throw new Error('Temporary Blob failure')
			objects.delete(key)
		})
	}
	vi.mocked(getStore).mockReturnValue(store as unknown as ReturnType<typeof getStore>)
	return { store, objects, failures, maxActive: () => maxActive }
}

function receive(input: object) {
	return onRequest({ request: new Request('https://relay.example/api/transfer/received', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
	}), env: {} })
}

beforeEach(() => vi.mocked(getStore).mockReset())

describe('received transfer cleanup', () => {
	it('deletes all 200 chunks with bounded requests while retaining the consume-once marker and other transfers', async () => {
		const data = await fixture()
		let startIndex: number | null = 0
		while (startIndex !== null) {
			const before = data.store.delete.mock.calls.length
			const response = await receive({ id, token, startIndex })
			expect(response.status).toBe(200)
			expect(data.store.delete.mock.calls.length - before).toBeLessThanOrEqual(20)
			startIndex = (await response.json()).nextIndex
		}
		expect(data.maxActive()).toBeLessThanOrEqual(8)
		expect([...data.objects]).toEqual([marker, 'transfer/items/other/chunks/part-00000.bin'])
	})

	it('rejects another token or transfer ID before deleting anything', async () => {
		const { store } = await fixture()
		expect((await receive({ id, token: 'C'.repeat(43), startIndex: 0 })).status).toBe(401)
		expect((await receive({ id: 'D'.repeat(24), token, startIndex: 0 })).status).toBe(401)
		expect((await receive({ id: '../other-transfer', token, startIndex: 0 })).status).toBe(400)
		expect(store.delete).not.toHaveBeenCalled()
	})

	it.each([-1, 1.5, 200])('rejects invalid cleanup position %s', async startIndex => {
		const { store } = await fixture()
		expect((await receive({ id, token, startIndex })).status).toBe(400)
		expect(store.delete).not.toHaveBeenCalled()
	})

	it('reports failed deletion and permits retrying the same partially deleted page', async () => {
		const data = await fixture()
		data.failures.add(chunkKey(3))
		expect((await receive({ id, token, startIndex: 0 })).status).toBe(503)
		expect(data.objects.has(chunkKey(3))).toBe(true)
		data.failures.clear()
		expect(await (await receive({ id, token, startIndex: 0 })).json()).toEqual({ nextIndex: 20 })
		expect(Array.from({ length: 20 }, (_, index) => data.objects.has(chunkKey(index))).some(Boolean)).toBe(false)
		expect(data.objects.has(chunkKey(20))).toBe(true)
	})
})
