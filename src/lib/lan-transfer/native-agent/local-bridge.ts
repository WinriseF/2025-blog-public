import type { LanNativeAgentCallback, LanNativeAgentTicket } from './types'
import { NATIVE_AGENT_BENCHMARK_VERSION, NATIVE_AGENT_BRIDGE_VERSION } from './types'
import { bytesHex, createPinnedWebTransport, ExactStreamReader, hexBytes, readU64, withTimeout, type WebTransportLike } from './webtransport'

const HELLO_MAGIC = new TextEncoder().encode('WRNFBH01')
const ACK_MAGIC = new TextEncoder().encode('WRNFBA01')
const TICKET_REQUEST_MAGIC = new TextEncoder().encode('WRNFTR01')
const TICKET_RESPONSE_MAGIC = new TextEncoder().encode('WRNFTS01')

export class LanNativeLocalBridge {
	private requestId = 0
	private requestQueue = Promise.resolve()

	private constructor(
		private readonly transport: WebTransportLike,
		private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
		private readonly reader: ExactStreamReader,
		readonly callback: LanNativeAgentCallback
	) {}

	static async connect(callback: LanNativeAgentCallback) {
		const transport = createPinnedWebTransport(callback.bridgeEndpoint, callback.certificateSha256)
		await withTimeout(transport.ready, 8_000, '连接本机加速组件超时')
		const control = await transport.createBidirectionalStream()
		const writer = control.writable.getWriter()
		const reader = new ExactStreamReader(control.readable)
		const hello = new Uint8Array(32)
		hello.set(HELLO_MAGIC)
		new DataView(hello.buffer).setUint16(8, NATIVE_AGENT_BRIDGE_VERSION)
		hello.set(hexBytes(callback.launchToken, 16, '启动凭据'), 16)
		await writer.write(hello)
		const ack = await reader.readExact(16)
		assertMagic(ack, ACK_MAGIC, 'Bridge 应答')
		const view = new DataView(ack.buffer, ack.byteOffset, ack.byteLength)
		if (view.getUint16(8) !== NATIVE_AGENT_BRIDGE_VERSION) throw new Error('本机加速组件版本不兼容')
		if (ack[10] !== 0) throw new Error('本机加速组件拒绝了启动凭据，请重新开启极速模式')
		return new LanNativeLocalBridge(transport, writer, reader, callback)
	}

	issueTicket(ownerDeviceId: string): Promise<LanNativeAgentTicket> {
		const run = this.requestQueue.then(async () => {
			const requestId = (this.requestId = (this.requestId + 1) >>> 0)
			const request = new Uint8Array(16)
			request.set(TICKET_REQUEST_MAGIC)
			const view = new DataView(request.buffer)
			view.setUint16(8, NATIVE_AGENT_BRIDGE_VERSION)
			view.setUint32(12, requestId)
			await this.writer.write(request)
			const response = await this.reader.readExact(40)
			assertMagic(response, TICKET_RESPONSE_MAGIC, 'Ticket 应答')
			const responseView = new DataView(response.buffer, response.byteOffset, response.byteLength)
			if (responseView.getUint16(8) !== NATIVE_AGENT_BRIDGE_VERSION || responseView.getUint32(12) !== requestId) throw new Error('Ticket 应答与请求不匹配')
			if (response[10] !== 0) throw new Error('本机加速组件暂时无法签发测试凭据')
			const expiresAt = readU64(responseView, 32)
			if (expiresAt <= Date.now()) throw new Error('测试凭据已过期')
			return {
				bridgeVersion: NATIVE_AGENT_BRIDGE_VERSION,
				benchmarkVersion: NATIVE_AGENT_BENCHMARK_VERSION,
				ownerDeviceId,
				endpoints: this.callback.benchmarkEndpoints,
				certificateSha256: this.callback.certificateSha256,
				token: bytesHex(response.subarray(16, 32)),
				expiresAt
			}
		})
		this.requestQueue = run.then(
			() => undefined,
			() => undefined
		)
		return run
	}

	close() {
		void this.writer.close().catch(() => {})
		this.reader.release()
		this.transport.close({ closeCode: 0, reason: 'speed mode disabled' })
	}
}

function assertMagic(actual: Uint8Array, expected: Uint8Array, label: string) {
	if (expected.some((byte, index) => actual[index] !== byte)) throw new Error(`${label}格式错误`)
}
