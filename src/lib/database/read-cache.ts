// FileReaderSync has significant per-call cost. Coalesce SQLite page reads into
// 256 KiB file ranges, keeping at most 32 MiB regardless of the database size.
const BLOCK_BYTES = 256 * 1024
const MAX_BLOCKS = 128

export function createReadCache(size: number, read: (start: number, end: number) => ArrayBuffer) {
	const blocks = new Map<number, Uint8Array>()
	return {
		readInto(offset: number, target: Uint8Array) {
			let copied = 0
			while (copied < target.length && offset + copied < size) {
				const position = offset + copied
				const start = Math.floor(position / BLOCK_BYTES) * BLOCK_BYTES
				let block = blocks.get(start)
				if (block) blocks.delete(start)
				else {
					block = new Uint8Array(read(start, Math.min(size, start + BLOCK_BYTES)))
					if (blocks.size >= MAX_BLOCKS) blocks.delete(blocks.keys().next().value!)
				}
				blocks.set(start, block)
				const within = position - start
				const length = Math.min(target.length - copied, block.length - within)
				if (length <= 0) break
				target.set(block.subarray(within, within + length), copied)
				copied += length
			}
			if (copied < target.length) target.fill(0, copied)
			return copied
		},
		clear: () => blocks.clear()
	}
}
