import type { LanConnectionRoute, LanReconnectTransport, LanTransportCreateOptions, LanTransportState } from './transport-types'

const transportControlPrefix = '__winrisef_lan_v8__:'

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2,
}

type TransportControl = { type: 'hello'; generation: number } | { type: 'ping' | 'pong'; generation: number; id: string }
type CandidatePairStats = RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; selected?: boolean; state?: string }
type CandidateStats = RTCStats & { address?: string; ip?: string; ipAddress?: string; candidateType?: string }
type TransportStats = RTCStats & { selectedCandidatePairId?: string }

function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseTransportControl(value: string): TransportControl | null {
	if (!value.startsWith(transportControlPrefix)) return null
	try {
		const message = JSON.parse(value.slice(transportControlPrefix.length)) as TransportControl
		if (!message || typeof message !== 'object' || !['hello', 'ping', 'pong'].includes(message.type) || typeof message.generation !== 'number') return null
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

function candidateStats(stats: RTCStatsReport, id: string | undefined) {
	return id ? stats.get(id) as CandidateStats | undefined : undefined
}

function addressFamily(candidate?: CandidateStats): LanConnectionRoute['family'] {
	const address = candidate?.address || candidate?.ip || candidate?.ipAddress || ''
	if (address.includes(':')) return 'ipv6'
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 'ipv4'
	return 'unknown'
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
	private channel: RTCDataChannel | null = null
	private pendingCandidates: RTCIceCandidateInit[] = []
	private remoteDescriptionNegotiationId = ''
	private pendingProbes = new Map<string, { resolve: (alive: boolean) => void; timer: ReturnType<typeof setTimeout> }>()
	private currentNegotiationId: string
	private makingOffer = false
	private ready = false
	private closed = false
	private lastState: LanTransportState | null = null
	lastInboundAt = Date.now()

	constructor(private readonly options: LanTransportCreateOptions) {
		this.generation = options.generation
		this.currentNegotiationId = options.negotiationId
		this.pc.onicecandidate = event => options.onCandidate(event.candidate?.toJSON() || null)
		this.pc.onconnectionstatechange = () => this.emitConnectionState()
		this.pc.oniceconnectionstatechange = () => this.emitConnectionState()
		if (options.role === 'host') this.bindChannel(this.pc.createDataChannel('lan-session-v8', { ordered: true }))
		else this.pc.ondatachannel = event => this.bindChannel(event.channel)
		this.emitState('connecting')
	}

	get negotiationId() {
		return this.currentNegotiationId
	}

	isOpen() {
		const iceConnected = this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed'
		return !this.closed && this.channel?.readyState === 'open' && (this.pc.connectionState === 'connected' || iceConnected)
	}

	send(data: Uint8Array) {
		if (!this.isOpen() || !this.channel) return false
		try {
			const payload: ArrayBuffer = data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : new Uint8Array(data).buffer
			this.channel.send(payload)
			return true
		} catch {
			return false
		}
	}

	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number) {
		return this.waitForBufferedAmount(highWatermark, lowWatermark, timeoutMs)
	}

	waitUntilDrained(lowWatermark: number, timeoutMs: number) {
		return this.waitForBufferedAmount(lowWatermark, lowWatermark, timeoutMs)
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
		if (!this.pc.remoteDescription || this.remoteDescriptionNegotiationId !== this.currentNegotiationId) {
			this.pendingCandidates.push(candidate)
			return
		}
		await this.addCandidate(candidate)
	}

	probe(timeoutMs = 3000) {
		if (!this.isOpen()) return Promise.resolve(false)
		const id = randomId()
		return new Promise<boolean>(resolve => {
			const timer = setTimeout(() => {
				this.pendingProbes.delete(id)
				resolve(false)
			}, timeoutMs)
			this.pendingProbes.set(id, { resolve, timer })
			if (!this.sendControl({ type: 'ping', generation: this.generation, id })) {
				clearTimeout(timer)
				this.pendingProbes.delete(id)
				resolve(false)
			}
		})
	}

	async inspectRoute(): Promise<LanConnectionRoute> {
		const stats = await this.pc.getStats()
		const pair = selectedCandidatePair(stats)
		return pair ? routeFromPair(stats, pair) : { family: 'unknown', kind: 'unknown' }
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.pendingProbes.forEach(probe => {
			clearTimeout(probe.timer)
			probe.resolve(false)
		})
		this.pendingProbes.clear()
		this.pendingCandidates = []
		const channel = this.channel
		this.channel = null
		if (channel) {
			channel.onopen = null
			channel.onclose = null
			channel.onerror = null
			channel.onmessage = null
			channel.close()
		}
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
		if (this.closed) return channel.close()
		const previous = this.channel
		if (previous) {
			previous.onopen = null
			previous.onclose = null
			previous.onerror = null
			previous.onmessage = null
			previous.close()
		}
		this.channel = channel
		channel.binaryType = 'arraybuffer'
		channel.onopen = () => this.sendControl({ type: 'hello', generation: this.generation })
		channel.onclose = () => {
			if (!this.closed && this.channel === channel) this.emitState('failed')
		}
		channel.onerror = () => {
			if (!this.closed && this.channel === channel) this.emitState('failed')
		}
		channel.onmessage = event => {
			if (this.channel === channel) void this.handleChannelMessage(event.data)
		}
	}

	private async handleChannelMessage(data: unknown) {
		this.lastInboundAt = Date.now()
		if (typeof data === 'string') {
			const control = parseTransportControl(data)
			if (control) return this.handleControl(control)
		}
		if (data instanceof Blob) return this.options.onData(await data.arrayBuffer())
		this.options.onData(data)
	}

	private handleControl(message: TransportControl) {
		if (message.generation !== this.generation) return
		if (message.type === 'hello') {
			if (!this.ready) {
				this.ready = true
				this.options.onReady()
			}
			return
		}
		if (message.type === 'ping') return void this.sendControl({ type: 'pong', generation: this.generation, id: message.id })
		const probe = this.pendingProbes.get(message.id)
		if (!probe) return
		clearTimeout(probe.timer)
		this.pendingProbes.delete(message.id)
		probe.resolve(true)
	}

	private sendControl(message: TransportControl) {
		if (this.channel?.readyState !== 'open') return false
		try {
			this.channel.send(`${transportControlPrefix}${JSON.stringify(message)}`)
			return true
		} catch {
			return false
		}
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
			if (error instanceof DOMException && error.name === 'OperationError') return
			throw error
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
			const channel = this.channel
			if (!this.isOpen() || !channel) throw new Error('连接已断开，请重新连接后再发送')
			if (channel.bufferedAmount <= limit) return
			if (Date.now() - startedAt > timeoutMs) throw new Error('发送暂停，请保持两台设备页面打开')
			channel.bufferedAmountLowThreshold = lowWatermark
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(done, 250)
				function cleanup() {
					clearTimeout(timer)
					channel.removeEventListener('bufferedamountlow', done)
					channel.removeEventListener('close', fail)
					channel.removeEventListener('error', fail)
				}
				function done() {
					cleanup()
					resolve()
				}
				function fail() {
					cleanup()
					reject(new Error('连接已断开，请重新连接后再发送'))
				}
				channel.addEventListener('bufferedamountlow', done, { once: true })
				channel.addEventListener('close', fail, { once: true })
				channel.addEventListener('error', fail, { once: true })
			})
		}
	}
}

export function createNativeWebRtcTransport(options: LanTransportCreateOptions) {
	return new NativeWebRtcTransport(options)
}
