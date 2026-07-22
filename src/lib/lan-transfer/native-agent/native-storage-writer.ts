import type { LanStorageEngine, TransferFileMeta, TransferManifest } from '../storage/types'

export const NATIVE_FILE_IO_BLOCK_BYTES = 4 * 1024 * 1024

type PartialChunk = { data: Uint8Array; filled: number }

export class NativeFileStorageWriter {
	private queue = Promise.resolve()
	private partial = new Map<number, PartialChunk>()
	private manifest: TransferManifest | null = null

	constructor(
		private readonly storage: LanStorageEngine,
		private readonly meta: TransferFileMeta
	) {}

	write(offset: number, value: ArrayBuffer | Uint8Array) {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
		const run = this.queue.then(() => this.writeBytes(offset, bytes))
		this.queue = run.then(() => undefined)
		return run
	}

	async finish() {
		await this.queue
		if (this.partial.size) throw new Error('极速文件接收覆盖不完整')
		const manifest = this.manifest
		if (!manifest || manifest.receivedBytes !== this.meta.size || manifest.receivedChunks !== this.meta.chunkCount) throw new Error('极速文件接收不完整')
		return manifest
	}

	private async writeBytes(initialOffset: number, bytes: Uint8Array) {
		let offset = initialOffset
		let sourceOffset = 0
		while (sourceOffset < bytes.byteLength) {
			const chunkIndex = Math.floor(offset / this.meta.chunkSize)
			const chunkStart = chunkIndex * this.meta.chunkSize
			const expected = Math.min(this.meta.chunkSize, this.meta.size - chunkStart)
			const withinChunk = offset - chunkStart
			const count = Math.min(bytes.byteLength - sourceOffset, expected - withinChunk)
			const source = bytes.subarray(sourceOffset, sourceOffset + count)
			if (withinChunk === 0 && count === expected) {
				this.manifest = await this.storage.writeChunk(this.meta, chunkIndex, source)
			} else {
				const partial = this.partial.get(chunkIndex) || { data: new Uint8Array(expected), filled: 0 }
				partial.data.set(source, withinChunk)
				partial.filled += count
				if (partial.filled === expected) {
					this.partial.delete(chunkIndex)
					this.manifest = await this.storage.writeChunk(this.meta, chunkIndex, partial.data)
				} else this.partial.set(chunkIndex, partial)
			}
			offset += count
			sourceOffset += count
		}
	}
}
