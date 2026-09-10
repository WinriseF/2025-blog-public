import { loadZipModule } from '../zip-runtime'

export type Entry = {
	filename: string
	directory: boolean
	encrypted: boolean
	uncompressedSize: number
	compressedSize: number
	compressionMethod: number
	signature: number
	lastModDate: Date
	comment: string
	getData: (writer: unknown, options?: Record<string, unknown>) => Promise<unknown>
}
export type Zip = {
	BlobReader: new (blob: Blob) => unknown
	ZipReader: new (reader: unknown, options?: Record<string, unknown>) => {
		getEntriesGenerator: (options?: Record<string, unknown>) => AsyncGenerator<Entry>
		close: () => Promise<void>
	}
	ZipWriter: new (writer: unknown, options?: Record<string, unknown>) => {
		add: (name: string, reader: unknown, options?: Record<string, unknown>) => Promise<unknown>
		close: () => Promise<unknown>
	}
}
export function loadOfficeZip() {
	return loadZipModule<Zip>()
}

export async function readPart(entry: Entry, signal: AbortSignal, limit: number) {
	if (entry.uncompressedSize > limit) throw new Error(`文件内部资源过大：${entry.filename}`)
	const chunks: Uint8Array[] = []
	let size = 0
	await entry.getData(new WritableStream<Uint8Array>({
		write(chunk) {
			signal.throwIfAborted()
			size += chunk.byteLength
			if (size > limit || size > entry.uncompressedSize) throw new Error('文件内部资源超出声明大小')
			chunks.push(new Uint8Array(chunk))
		}
	}), { signal, checkSignature: true })
	if (size !== entry.uncompressedSize) throw new Error(`文件内部资源不完整：${entry.filename}`)
	return new Blob(chunks)
}
