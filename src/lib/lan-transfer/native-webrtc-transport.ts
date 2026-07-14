import { LAN_CHUNK_TIERS, LAN_LIMITS } from './types'
import type { LanConnectionRoute, LanReconnectTransport, LanTransportCreateOptions, LanTransportState } from './transport-types'
const CONTROL_LABEL = 'lan-control-v8'
const DATA_LABEL = 'lan-data-v8'
const transportControlPrefix = '__winrisef_lan_v8__:'
const THROUGHPUT_PROBE = 0xff
const PROBE_BYTES = 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2,
}
type TransportControl =
	| { type: 'hello'; generation: number }
	| { type: 'ping' | 'pong' | 'throughput-probe-ack'; generation: number; id: string }
type CandidatePairStats = RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; selected?: boolean; state?: string }
type CandidateStats = RTCStats & { address?: string; ip?: string; ipAddress?: string; candidateType?: string }
type TransportStats = RTCStats & { selectedCandidatePairId?: string }
type PendingCheck = { resolve: (alive: boolean) => void; timer: ReturnType<typeof setTimeout> }
type IncomingProbe = { chunks: Set<number>; total: number; timer: ReturnType<typeof setTimeout> }
class ByteRate {
	private total = 0
	private sampledBytes = 0
	private sampledAt = Date.now()
	private lastByteAt = 0
	private speed = 0

	add(bytes: number) {
		this.total += bytes
		this.lastByteAt = Date.now()
		this.sample()
	}

	read() {
		this.sample(true)
		return this.speed
	}

	private sample(force = false) {
		const now = Date.now()
		const elapsed = now - this.sampledAt
		if (elapsed >= 250 && (force || this.total !== this.sampledBytes)) {
			const instant = (this.total - this.sampledBytes) * 1000 / elapsed
			this.speed = this.speed ? this.speed * 0.35 + instant * 0.65 : instant
			this.sampledAt = now
			this.sampledBytes = this.total
		}
		if (this.lastByteAt && now - this.lastByteAt > 1500) this.speed = 0
	}
}
function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function parseTransportControl(value: string): TransportControl | null {
	if (!value.startsWith(transportControlPrefix)) return null
	try {
		const message = JSON.parse(value.slice(transportControlPrefix.length)) as TransportControl
		if (!message || typeof message !== 'object' || !['hello', 'ping', 'pong', 'throughput-probe-ack'].includes(message.type) || typeof message.generation !== 'number') return null
		if (message.type !== 'hello' && typeof message.id !== 'string') return null
		return message
	} catch {
		return null
	}
}

function selectedCandidatePair(stats: RTCStatsReport) {
	let selectedPairId = ''
	stats.forEach(report => {
		if (report.type === 'transport') selectedPairId ||= (report as TransportStats).selectedCandidatePairId || ''
	})
	if (selectedPairId) {
		const pair = stats.get(selectedPairId) as CandidatePairStats | undefined
		if (pair) return pair
	}
	let selected: CandidatePairStats | null = null
	let nominated: CandidatePairStats | null = null
	stats.forEach(report => {
		if (report.type !== 'candidate-pair') return
		const pair = report as CandidatePairStats
		if (pair.selected) selected = pair
		else if (!nominated && pair.nominated && pair.state === 'succeeded') nominated = pair
	})
	return selected || nominated
}

function candidateStats(stats: RTCStatsReport, id?: string) {
	return id ? stats.get(id) as CandidateStats | undefined : undefined
}

function addressFamily(candidate?: CandidateStats): LanConnectionRoute['family'] {
	const address = candidate?.address || candidate?.ip || candidate?.ipAddress || ''
	if (address.includes(':')) return 'ipv6'
	return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) ? 'ipv4' : 'unknown'
}

function routeFromPair(stats: RTCStatsReport, pair: CandidatePairStats): LanConnectionRoute {
	const local = candidateStats(stats, pair.localCandidateId)
	const remote = candidateStats(stats, pair.remoteCandidateId)
	const localType = local?.candidateType || ''
	const remoteType = remote?.candidateType || ''
	if (localType === 'relay' || remoteType === 'relay') throw new Error('当前网络无法直连，请换个网络后重试')
	const localFamily = addressFamily(local)
	const remoteFamily = addressFamily(remote)
	const family = localFamily === remoteFamily ? localFamily : localFamily === 'unknown' ? remoteFamily : remoteFamily === 'unknown' ? localFamily : 'unknown'
	if (family === 'ipv6') return { family, kind: 'direct' }
	if (family !== 'ipv4') return { family: 'unknown', kind: 'unknown' }
	if (localType === 'host' && remoteType === 'host') return { family, kind: 'lan' }
	if (['srflx', 'prflx'].includes(localType) || ['srflx', 'prflx'].includes(remoteType)) return { family, kind: 'nat' }
	return { family, kind: 'direct' }
}

export class NativeWebRtcTransport implements LanReconnectTransport {
	readonly id = randomId()
	readonly generation: number
	private readonly pc = new RTCPeerConnection(lanRtcConfig)
	private controlChannel: RTCDataChannel | null = null
	private dataChannel: RTCDataChannel | null = null
	private pendingCandidates: RTCIceCandidateInit[] = []
	private remoteDescriptionNegotiationId = ''
	private pendingChecks = new Map<string, PendingCheck>()
	private incomingProbes = new Map<string, IncomingProbe>()
	private negotiatedChunkSize: number | null = null
	private chunkNegotiation: Promise<number> | null = null
	private currentNegotiationId: string
	private makingOffer = false
	private helloReceived = false
	private ready = false
	private closed = false
	private transferActive = false
	private lastState: LanTransportState | null = null
	private sendRate = new ByteRate()
	private receiveRate = new ByteRate()
	private lastDataActivityAt = Date.now()
	lastInboundAt = Date.now()

	constructor(private readonly options: LanTransportCreateOptions) {
		this.generation = options.generation
		this.currentNegotiationId = options.negotiationId
		this.pc.onicecandidate = event => options.onCandidate(event.candidate?.toJSON() || null)
		this.pc.onconnectionstatechange = () => this.emitConnectionState()
		this.pc.oniceconnectionstatechange = () => this.emitConnectionState()
		if (options.role === 'host') {
			this.bindChannel(this.pc.createDataChannel(CONTROL_LABEL, { ordered: true }))
			this.bindChannel(this.pc.createDataChannel(DATA_LABEL, { ordered: false }))
		} else {
			this.pc.ondatachannel = event => this.bindChannel(event.channel)
		}
		this.emitState('connecting')
	}

	get negotiationId() {
		return this.currentNegotiationId
	}

	isOpen() {
		return !this.closed && this.controlChannel?.readyState === 'open' && this.dataChannel?.readyState === 'open'
	}

	sendControl(data: Uint8Array) {
		return this.sendBytes(this.controlChannel, data)
	}

	sendData(data: Uint8Array) {
		const sent = this.sendBytes(this.dataChannel, data)
		if (sent) {
			this.lastDataActivityAt = Date.now()
			this.sendRate.add(data.byteLength)
		}
		return sent
	}

	negotiateChunkSize(peerMaxChunkSize = LAN_LIMITS.dataChannelFallbackChunkSize) {
		const fast = LAN_CHUNK_TIERS[0]
		if (peerMaxChunkSize < fast.chunkSize || this.pc.sctp?.maxMessageSize && this.pc.sctp.maxMessageSize < fast.frameSize) return Promise.resolve(LAN_LIMITS.dataChannelFallbackChunkSize)
		if (this.negotiatedChunkSize !== null) return Promise.resolve(this.negotiatedChunkSize)
		this.chunkNegotiation ||= this.probeThroughput(fast.frameSize, 2000).then(ok => {
			this.negotiatedChunkSize = ok ? fast.chunkSize : LAN_LIMITS.dataChannelFallbackChunkSize
			return this.negotiatedChunkSize
		}).finally(() => {
			this.chunkNegotiation = null
		})
		return this.chunkNegotiation
	}

	waitUntilDataWritable(highWatermark: number, lowWatermark: number, timeoutMs: number) {
		return this.waitForBufferedAmount(highWatermark, lowWatermark, timeoutMs)
	}

	waitUntilDataDrained(lowWatermark: number, timeoutMs: number) {
		return this.waitForBufferedAmount(lowWatermark, lowWatermark, timeoutMs)
	}

	setTransferActive(active: boolean) {
		this.transferActive = active
	}

	isTransferActive() {
		return this.transferActive
	}

	getDiagnostics() {
		return {
			chunkSize: this.negotiatedChunkSize || LAN_LIMITS.defaultChunkSize,
			dataBufferedAmount: this.dataChannel?.bufferedAmount || 0,
			networkSendBps: this.sendRate.read(),
			networkReceiveBps: this.receiveRate.read(),
			lastDataActivityAt: this.lastDataActivityAt,
		}
	}

	async start() {
		if (this.options.role === 'host') await this.createOffer(false)
	}

	setNegotiationId(negotiationId: string) {
		if (this.currentNegotiationId === negotiationId) return
		this.currentNegotiationId = negotiationId
		this.pendingCandidates = []
		this.remoteDescriptionNegotiationId = ''
	}

	async restartIce(negotiationId: string) {
		if (this.options.role !== 'host' || this.closed) return
		this.setNegotiationId(negotiationId)
		this.pc.restartIce()
		await this.createOffer(true)
	}

	async acceptDescription(description: RTCSessionDescriptionInit) {
		if (this.closed) return
		await this.pc.setRemoteDescription(description)
		this.remoteDescriptionNegotiationId = this.currentNegotiationId
		await this.flushCandidates()
		if (description.type !== 'offer') return
		const answer = await this.pc.createAnswer()
		await this.pc.setLocalDescription(answer)
		if (this.pc.localDescription) this.options.onDescription(this.pc.localDescription.toJSON())
	}

	async addRemoteCandidate(candidate: RTCIceCandidateInit | null) {
		if (this.closed || !candidate) return
		if (!this.pc.remoteDescription || this.remoteDescriptionNegotiationId !== this.currentNegotiationId) return void this.pendingCandidates.push(candidate)
		await this.addCandidate(candidate)
	}

	probe(timeoutMs = 3000) {
		if (!this.isOpen()) return Promise.resolve(false)
		const id = randomId()
		return this.createCheck(id, timeoutMs, () => this.sendTransportControl({ type: 'ping', generation: this.generation, id }))
	}

	async inspectRoute(): Promise<LanConnectionRoute> {
		const stats = await this.pc.getStats()
		const pair = selectedCandidatePair(stats)
		return pair ? routeFromPair(stats, pair) : { family: 'unknown', kind: 'unknown' }
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.pendingChecks.forEach(check => {
			clearTimeout(check.timer)
			check.resolve(false)
		})
		this.pendingChecks.clear()
		this.incomingProbes.forEach(probe => clearTimeout(probe.timer))
		this.incomingProbes.clear()
		this.pendingCandidates = []
		this.closeChannel(this.controlChannel)
		this.closeChannel(this.dataChannel)
		this.controlChannel = null
		this.dataChannel = null
		this.pc.onicecandidate = null
		this.pc.onconnectionstatechange = null
		this.pc.oniceconnectionstatechange = null
		this.pc.ondatachannel = null
		this.pc.close()
		this.emitState('closed')
	}

	private async createOffer(iceRestart: boolean) {
		if (this.closed || this.makingOffer) return
		this.makingOffer = true
		try {
			const offer = await this.pc.createOffer({ iceRestart })
			await this.pc.setLocalDescription(offer)
			if (this.pc.localDescription) this.options.onDescription(this.pc.localDescription.toJSON())
		} finally {
			this.makingOffer = false
		}
	}

	private bindChannel(channel: RTCDataChannel) {
		if (this.closed || channel.label !== CONTROL_LABEL && channel.label !== DATA_LABEL) return channel.close()
		const kind = channel.label === CONTROL_LABEL ? 'control' : 'data'
		const previous = kind === 'control' ? this.controlChannel : this.dataChannel
		if (previous) this.closeChannel(previous)
		if (kind === 'control') this.controlChannel = channel
		else this.dataChannel = channel
		channel.binaryType = 'arraybuffer'
		channel.onopen = () => {
			if (kind === 'control') this.sendTransportControl({ type: 'hello', generation: this.generation })
			else if (this.controlChannel?.readyState === 'open') this.sendTransportControl({ type: 'hello', generation: this.generation })
			this.maybeReady()
		}
		channel.onclose = () => {
			if (!this.closed && (this.controlChannel === channel || this.dataChannel === channel)) this.emitState('failed')
		}
		channel.onerror = channel.onclose
		channel.onmessage = event => void this.handleChannelMessage(kind, channel, event.data)
	}

	private async handleChannelMessage(kind: 'control' | 'data', channel: RTCDataChannel, data: unknown) {
		if (kind === 'control' && this.controlChannel !== channel || kind === 'data' && this.dataChannel !== channel) return
		this.lastInboundAt = Date.now()
		if (kind === 'control' && typeof data === 'string') {
			const control = parseTransportControl(data)
			if (control) return this.handleTransportControl(control)
		}
		const payload = data instanceof Blob ? await data.arrayBuffer() : data
		if (kind === 'data') {
			const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : ArrayBuffer.isView(payload) ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength) : null
			if (bytes && this.handleThroughputProbe(bytes)) return
			if (bytes) {
				this.lastDataActivityAt = Date.now()
				this.receiveRate.add(bytes.byteLength)
			}
		}
		this.options.onData(kind, payload)
	}

	private handleTransportControl(message: TransportControl) {
		if (message.generation !== this.generation) return
		if (message.type === 'hello') {
			this.helloReceived = true
			return this.maybeReady()
		}
		if (message.type === 'ping') return void this.sendTransportControl({ type: 'pong', generation: this.generation, id: message.id })
		const pending = this.pendingChecks.get(message.id)
		if (!pending) return
		clearTimeout(pending.timer)
		this.pendingChecks.delete(message.id)
		pending.resolve(true)
	}

	private maybeReady() {
		if (this.ready || !this.helloReceived || !this.isOpen()) return
		this.ready = true
		this.options.onReady()
	}

	private sendTransportControl(message: TransportControl) {
		if (this.controlChannel?.readyState !== 'open') return false
		try {
			this.controlChannel.send(`${transportControlPrefix}${JSON.stringify(message)}`)
			return true
		} catch {
			return false
		}
	}

	private createCheck(id: string, timeoutMs: number, send: () => boolean) {
		return new Promise<boolean>(resolve => {
			const timer = setTimeout(() => {
				this.pendingChecks.delete(id)
				resolve(false)
			}, timeoutMs)
			this.pendingChecks.set(id, { resolve, timer })
			if (send()) return
			clearTimeout(timer)
			this.pendingChecks.delete(id)
			resolve(false)
		})
	}

	private probeThroughput(frameSize: number, timeoutMs: number) {
		if (!this.isOpen()) return Promise.resolve(false)
		const id = randomId()
		const idBytes = encoder.encode(id)
		const total = Math.ceil(PROBE_BYTES / frameSize)
		return this.createCheck(id, timeoutMs, () => {
			for (let index = 0; index < total; index += 1) {
				const frame = new Uint8Array(frameSize)
				frame[0] = THROUGHPUT_PROBE
				frame[1] = idBytes.byteLength
				frame.set(idBytes, 2)
				const view = new DataView(frame.buffer)
				view.setUint16(2 + idBytes.byteLength, index)
				view.setUint16(4 + idBytes.byteLength, total)
				if (!this.sendData(frame)) return false
			}
			return true
		})
	}

	private handleThroughputProbe(bytes: Uint8Array) {
		if (bytes[0] !== THROUGHPUT_PROBE || bytes.byteLength < 6) return false
		const idLength = bytes[1]
		if (!idLength || bytes.byteLength < idLength + 6) return true
		const id = decoder.decode(bytes.subarray(2, 2 + idLength))
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const index = view.getUint16(2 + idLength)
		const total = view.getUint16(4 + idLength)
		let probe = this.incomingProbes.get(id)
		if (!probe) {
			const timer = setTimeout(() => this.incomingProbes.delete(id), 3000)
			probe = { chunks: new Set(), total, timer }
			this.incomingProbes.set(id, probe)
		}
		if (probe.total === total && index < total) probe.chunks.add(index)
		if (probe.chunks.size === total) {
			clearTimeout(probe.timer)
			this.incomingProbes.delete(id)
			this.sendTransportControl({ type: 'throughput-probe-ack', generation: this.generation, id })
		}
		return true
	}

	private sendBytes(channel: RTCDataChannel | null, data: Uint8Array) {
		if (!channel || channel.readyState !== 'open' || this.closed) return false
		try {
			const payload = data.buffer instanceof ArrayBuffer && !data.byteOffset && data.byteLength === data.buffer.byteLength ? data.buffer : new Uint8Array(data).buffer
			channel.send(payload)
			return true
		} catch {
			return false
		}
	}

	private closeChannel(channel: RTCDataChannel | null) {
		if (!channel) return
		channel.onopen = null
		channel.onclose = null
		channel.onerror = null
		channel.onmessage = null
		channel.close()
	}

	private async flushCandidates() {
		const candidates = this.pendingCandidates
		this.pendingCandidates = []
		for (const candidate of candidates) await this.addCandidate(candidate)
	}

	private async addCandidate(candidate: RTCIceCandidateInit) {
		try {
			await this.pc.addIceCandidate(candidate)
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'OperationError')) throw error
		}
	}

	private emitConnectionState() {
		if (this.closed) return
		const state = this.pc.connectionState
		const ice = this.pc.iceConnectionState
		if (state === 'failed' || ice === 'failed') return this.emitState('failed')
		if (state === 'closed' || ice === 'closed') return this.emitState('closed')
		if (state === 'disconnected' || ice === 'disconnected') return this.emitState('disconnected')
		if (state === 'connected' || ice === 'connected' || ice === 'completed') return this.emitState('connected')
		this.emitState('connecting')
	}

	private emitState(state: LanTransportState) {
		if (this.lastState === state) return
		this.lastState = state
		this.options.onState(state)
	}

	private async waitForBufferedAmount(limit: number, lowWatermark: number, timeoutMs: number) {
		const startedAt = Date.now()
		while (true) {
			const channel = this.dataChannel
			if (!channel || channel.readyState !== 'open' || this.closed) throw new Error('连接已断开，请重新连接后再发送')
			const activeChannel = channel
			if (channel.bufferedAmount <= limit) return
			if (Date.now() - startedAt > timeoutMs) throw new Error('发送暂停，请保持两台设备页面打开')
			channel.bufferedAmountLowThreshold = lowWatermark
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(done, 250)
				function cleanup() {
					clearTimeout(timer)
					activeChannel.removeEventListener('bufferedamountlow', done)
					activeChannel.removeEventListener('close', fail)
					activeChannel.removeEventListener('error', fail)
				}
				function done() { cleanup(); resolve() }
				function fail() { cleanup(); reject(new Error('连接已断开，请重新连接后再发送')) }
				activeChannel.addEventListener('bufferedamountlow', done, { once: true })
				activeChannel.addEventListener('close', fail, { once: true })
				activeChannel.addEventListener('error', fail, { once: true })
			})
		}
	}
}

export function createNativeWebRtcTransport(options: LanTransportCreateOptions) {
	return new NativeWebRtcTransport(options)
}
