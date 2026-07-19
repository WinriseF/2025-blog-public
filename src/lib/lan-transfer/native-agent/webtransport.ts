export type WebTransportLike = {
	ready: Promise<void>
	closed: Promise<{ closeCode?: number; reason?: string }>
	incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>
	createBidirectionalStream: () => Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>
	createUnidirectionalStream: () => Promise<WritableStream<Uint8Array>>
	close: (info?: { closeCode?: number; reason?: string }) => void
}

type WebTransportConstructor = new (
	url: string,
	options?: {
		serverCertificateHashes?: Array<{ algorithm: 'sha-256'; value: ArrayBuffer }>
	}
) => WebTransportLike

export function createPinnedWebTransport(endpoint: string, certificateSha256: string) {
	const Constructor = (window as unknown as { WebTransport?: WebTransportConstructor }).WebTransport
	if (!Constructor) throw new Error('当前浏览器不支持 WebTransport')
	const hash = hexBytes(certificateSha256, 32, '证书摘要')
	return new Constructor(endpoint, {
		serverCertificateHashes: [{ algorithm: 'sha-256', value: Uint8Array.from(hash).buffer }]
	})
}

export function hexBytes(value: string, expectedBytes: number, label: string) {
	if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) throw new Error(`${label}格式错误`)
	const bytes = new Uint8Array(expectedBytes)
	for (let index = 0; index < expectedBytes; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
	return bytes
}

export function bytesHex(bytes: Uint8Array) {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs)
			})
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

export class ExactStreamReader {
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>
	private buffered = new Uint8Array()
	private offset = 0

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader()
	}

	async readExact(length: number) {
		const output = new Uint8Array(length)
		let written = 0
		while (written < length) {
			if (this.offset >= this.buffered.byteLength) {
				const next = await this.reader.read()
				if (next.done) throw new Error('WebTransport 数据流提前结束')
				this.buffered = next.value
				this.offset = 0
			}
			const count = Math.min(length - written, this.buffered.byteLength - this.offset)
			output.set(this.buffered.subarray(this.offset, this.offset + count), written)
			written += count
			this.offset += count
		}
		return output
	}

	async discard(length: number, onBytes?: (bytes: number) => void) {
		let remaining = length
		while (remaining > 0) {
			if (this.offset >= this.buffered.byteLength) {
				const next = await this.reader.read()
				if (next.done) throw new Error('WebTransport 数据流提前结束')
				this.buffered = next.value
				this.offset = 0
			}
			const count = Math.min(remaining, this.buffered.byteLength - this.offset)
			this.offset += count
			remaining -= count
			onBytes?.(count)
		}
	}

	release() {
		this.reader.releaseLock()
	}
}

export function writeU64(view: DataView, offset: number, value: number) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('协议数值超出安全范围')
	view.setUint32(offset, Math.floor(value / 0x1_0000_0000))
	view.setUint32(offset + 4, value >>> 0)
}

export function readU64(view: DataView, offset: number) {
	return view.getUint32(offset) * 0x1_0000_0000 + view.getUint32(offset + 4)
}
