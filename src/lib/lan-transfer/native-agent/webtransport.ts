import { endpointAddressKind, summarizeNativeEndpoints } from './endpoint-validation'
import { logLanConnection } from '../connection-diagnostics'

export type WebTransportLike = {
	ready: Promise<void>
	incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>
	createBidirectionalStream: () => Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>
	createUnidirectionalStream: () => Promise<WritableStream<Uint8Array>>
	close: (info?: { closeCode?: number; reason?: string }) => void
}

type WebTransportConstructor = new (
	url: string,
	options?: {
		serverCertificateHashes?: Array<{ algorithm: 'sha-256'; value: ArrayBuffer }>
		congestionControl?: 'default' | 'throughput' | 'low-latency'
		requireUnreliable?: boolean
		anticipatedConcurrentIncomingUnidirectionalStreams?: number
	}
) => WebTransportLike

export function createPinnedWebTransport(endpoint: string, certificateSha256: string) {
	const Constructor = (window as unknown as { WebTransport?: WebTransportConstructor }).WebTransport
	if (!Constructor) throw new Error('当前浏览器不支持 WebTransport')
	const hash = hexBytes(certificateSha256, 32, '证书摘要')
	return new Constructor(endpoint, {
		serverCertificateHashes: [{ algorithm: 'sha-256', value: Uint8Array.from(hash).buffer }],
		congestionControl: 'throughput',
		requireUnreliable: true,
		anticipatedConcurrentIncomingUnidirectionalStreams: 4
	})
}

const endpointWinners = new Map<string, string>()

export async function selectPinnedWebTransportEndpoint(options: {
	endpoints: string[]
	certificateSha256: string
	networkEpoch: string
	validate: (endpoint: string) => boolean
	signal?: AbortSignal
}) {
	const candidates = [...new Set(options.endpoints.filter(options.validate))]
	if (!candidates.length) throw new Error('加速电脑没有发布可用的 WebTransport 地址')
	const cacheKey = `${options.certificateSha256}:${options.networkEpoch}`
	const cached = endpointWinners.get(cacheKey)
	const ordered = candidates.sort((left, right) => endpointPriority(left, cached) - endpointPriority(right, cached))
	logLanConnection('NATIVE-WT', 'endpoint-race-started', { networkEpoch: options.networkEpoch, endpoints: summarizeNativeEndpoints(ordered), cachedEndpointAvailable: Boolean(cached) })
	const transports = new Set<WebTransportLike>()
	return new Promise<string>((resolve, reject) => {
		let settled = false
		let finished = 0
		let lastError: unknown = null
		for (const endpoint of ordered) {
			const priority = endpointPriority(endpoint, cached)
			const delayMs = priority <= 1 ? 0 : 200
			const addressKind = endpointAddressKind(endpoint)
			void (async () => {
				let transport: WebTransportLike | null = null
				try {
					await abortableDelay(delayMs, options.signal)
					if (settled) return
					logLanConnection('NATIVE-WT', 'endpoint-attempt-started', { addressKind, priority, delayMs })
					transport = createPinnedWebTransport(endpoint, options.certificateSha256)
					transports.add(transport)
					await abortable(withTimeout(transport.ready, 4_000, 'WebTransport 连接在 4 秒内未就绪'), options.signal)
					if (settled) return transport.close({ closeCode: 0, reason: 'endpoint race lost' })
					settled = true
					endpointWinners.set(cacheKey, endpoint)
					for (const candidate of transports) candidate.close({ closeCode: 0, reason: candidate === transport ? 'endpoint selected' : 'endpoint race lost' })
					logLanConnection('NATIVE-WT', 'endpoint-selected', { addressKind, priority })
					resolve(endpoint)
				} catch (error) {
					lastError = error
					logLanConnection('NATIVE-WT', 'endpoint-attempt-failed', { addressKind, priority, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }, 'warn')
					transport?.close({ closeCode: 1, reason: 'endpoint connection failed' })
				} finally {
					finished += 1
					if (!settled && finished === ordered.length) {
						const classified = classifyWebTransportError(lastError, ordered.some(endpoint => endpointAddressKind(endpoint) === 'gua-ipv6'))
						logLanConnection('NATIVE-WT', 'endpoint-race-failed', { attempts: finished, error: classified.message }, 'error')
						reject(classified)
					}
				}
			})()
		}
	})
}

export function invalidatePinnedWebTransportEndpoint(certificateSha256: string, networkEpoch: string) {
	endpointWinners.delete(`${certificateSha256}:${networkEpoch}`)
}

export function classifyWebTransportError(error: unknown, publicIpv6 = false) {
	const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
	const message = error instanceof Error ? error.message : String(error || '')
	if (name === 'AbortError') return new Error('极速连接已取消')
	if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(message)) return new Error('浏览器拒绝了网络访问权限')
	if (/certificate|sha-?256|tls|security/i.test(message)) return new Error('WebTransport TLS 或证书摘要校验失败')
	if (/token|授权|认证|凭据|reject/i.test(message)) return new Error('Agent 拒绝了本次短期授权')
	if (/4 秒|timeout|timed out/i.test(message)) return new Error(publicIpv6 ? '公网 IPv6 UDP 连接超时，可能被 Windows、路由器或运营商防火墙拦截' : 'WebTransport UDP 连接超时，可能被防火墙拦截')
	return new Error(publicIpv6 ? '公网 IPv6 地址不可达，正在回退普通直连' : 'WebTransport 地址不可达')
}

function endpointPriority(endpoint: string, cached?: string) {
	if (endpoint === cached) return 0
	return endpointAddressKind(endpoint) === 'gua-ipv6' ? 1 : 2
}

function abortableDelay(ms: number, signal?: AbortSignal) {
	if (!ms) return signal?.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve()
	return abortable(new Promise<void>(resolve => setTimeout(resolve, ms)), signal)
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
	if (!signal) return promise
	if (signal.aborted) return Promise.reject<T>(new DOMException('Aborted', 'AbortError'))
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
	])
}

export function hexBytes(value: string, expectedBytes: number, label: string) {
	if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) throw new Error(`${label}格式错误`)
	const bytes = new Uint8Array(expectedBytes)
	for (let index = 0; index < expectedBytes; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
	return bytes
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
		let unreported = 0
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
			unreported += count
			if (unreported >= 4 * 1024 * 1024 || remaining === 0) {
				onBytes?.(unreported)
				unreported = 0
			}
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
