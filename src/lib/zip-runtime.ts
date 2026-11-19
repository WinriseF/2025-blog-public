const ZIP_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.25.0/index.min.js'
let pending: Promise<unknown> | undefined

export function loadZipModule<T>(): Promise<T> {
	if (!pending) {
		pending = import(/* webpackIgnore: true */ ZIP_RUNTIME_URL)
		pending.catch(() => { pending = undefined })
	}
	return pending as Promise<T>
}

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

export async function readZipBlob(entry: Entry, signal: AbortSignal, limit: number, password?: string, onprogress?: (current: number, total: number) => void) {
	if (entry.uncompressedSize > limit) throw new Error(`文件内部资源过大：${entry.filename}`)
	const chunks: Uint8Array<ArrayBuffer>[] = []
	let size = 0
	await entry.getData(new WritableStream<Uint8Array>({
		write(chunk) {
			signal.throwIfAborted()
			size += chunk.byteLength
			if (size > limit || size > entry.uncompressedSize) throw new Error('文件内部资源超出声明大小')
			chunks.push(new Uint8Array(chunk))
		}
	}), { signal, password, checkSignature: true, onprogress })
	if (size !== entry.uncompressedSize) throw new Error(`文件内部资源不完整：${entry.filename}`)
	return new Blob(chunks)
}
