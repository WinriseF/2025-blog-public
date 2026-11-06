import { describe, expect, it, vi } from 'vitest'
import { createReadCache } from '../../src/lib/database/read-cache'

describe('SQLite file read coalescing', () => {
	it('reads adjacent SQLite pages once and preserves bytes across block boundaries', () => {
		const source = Uint8Array.from({ length: 600_000 }, (_, i) => (i * 37) % 251)
		const read = vi.fn((start: number, end: number) => source.slice(start, end).buffer)
		const cache = createReadCache(source.length, read)
		for (const offset of [0, 4096, 8192, 262100, 270000]) {
			const target = new Uint8Array(4096)
			expect(cache.readInto(offset, target)).toBe(target.length)
			expect(target).toEqual(source.slice(offset, offset + target.length))
		}
		expect(read).toHaveBeenCalledTimes(2)
	})
	it('preserves offsets beyond 4 GiB and zero-fills short reads', () => {
		const size = 2 ** 32 + 100
		const read = vi.fn((start: number, end: number) => Uint8Array.from({ length: end - start }, (_, i) => (start + i) % 251).buffer)
		const cache = createReadCache(size, read)
		const target = new Uint8Array(300).fill(255)
		expect(cache.readInto(2 ** 32 - 100, target)).toBe(200)
		expect(target.slice(0, 200)).toEqual(Uint8Array.from({ length: 200 }, (_, i) => (2 ** 32 - 100 + i) % 251))
		expect(target.slice(200)).toEqual(new Uint8Array(100))
		expect(read.mock.calls.at(-1)).toEqual([2 ** 32, size])
	})
	it('evicts old blocks at the fixed memory limit and releases cached data on close', () => {
		const read = vi.fn((start: number, end: number) => new ArrayBuffer(end - start))
		const cache = createReadCache(100_000_000, read)
		const target = new Uint8Array(1)
		for (let i = 0; i < 129; i++) cache.readInto(i * 262144, target)
		cache.readInto(128 * 262144, target)
		expect(read).toHaveBeenCalledTimes(129)
		cache.readInto(0, target)
		expect(read).toHaveBeenCalledTimes(130)
		cache.clear()
		cache.readInto(0, target)
		expect(read).toHaveBeenCalledTimes(131)
	})
})
