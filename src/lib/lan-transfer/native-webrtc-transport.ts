import { LAN_CHUNK_TIERS, LAN_LIMITS } from './types'
import { logLanConnection, shortConnectionId, summarizeIceCandidate, summarizeNetworkAddress } from './connection-diagnostics'
import type { LanConnectionRoute, LanReconnectTransport, LanTransportCreateOptions, LanTransportHealthStats, LanTransportState } from './transport-types'
import { ipAddressKind } from './native-agent/endpoint-validation'

const transportControlPrefix = '__winrisef_lan_v12__:'
const TRANSPORT_FRAME_PROBE = 0xff
const ICE_DIAGNOSTIC_SAMPLE_DELAYS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7000, 9000] as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2,
}

type TransportControl = { type: 'hello'; generation: number } | { type: 'frame-probe-ack'; generation: number; id: string }
type CandidatePairStats = RTCStats & {
	localCandidateId?: string
	remoteCandidateId?: string
	nominated?: boolean
	selected?: boolean
	state?: string
	writable?: boolean
	readable?: boolean
	priority?: number
	bytesSent?: number
	bytesReceived?: number
	packetsSent?: number
	packetsReceived?: number
	packetsDiscardedOnSend?: number
	bytesDiscardedOnSend?: number
	requestsSent?: number
	requestsReceived?: number
	responsesSent?: number
	responsesReceived?: number
	consentRequestsSent?: number
	currentRoundTripTime?: number
	totalRoundTripTime?: number
	availableOutgoingBitrate?: number
	availableIncomingBitrate?: number
	firstRequestTimestamp?: number
	lastRequestTimestamp?: number
	firstResponseTimestamp?: number
	lastResponseTimestamp?: number
	lastPacketSentTimestamp?: number
	lastPacketReceivedTimestamp?: number
	consentExpiredTimestamp?: number
}
type CandidateStats = RTCStats & {
	address?: string
	ip?: string
	ipAddress?: string
	relatedAddress?: string
	port?: number
	relatedPort?: number
	candidateType?: string
	protocol?: string
	relayProtocol?: string
	tcpType?: string
	networkType?: string
	foundation?: string
	component?: string
	priority?: number
	url?: string
	usernameFragment?: string
}
type TransportStats = RTCStats & {
	selectedCandidatePairId?: string
	iceRole?: string
	iceLocalUsernameFragment?: string
	dtlsState?: string
	packetsSent?: number
	packetsReceived?: number
	bytesSent?: number
	bytesReceived?: number
}
type SctpTransportStats = RTCStats & {
	state?: string
	bytesSent?: number
	bytesReceived?: number
	maxMessageSize?: number
	maxChannels?: number
}

function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function chunkSizeAtMost(limit: number) {
	return LAN_CHUNK_TIERS.find(tier => tier.chunkSize <= limit)?.chunkSize || LAN_LIMITS.dataChannelFallbackChunkSize
}

function parseTransportControl(value: string): TransportControl | null {
	if (!value.startsWith(transportControlPrefix)) return null
	try {
		const message = JSON.parse(value.slice(transportControlPrefix.length)) as TransportControl
		if (!message || typeof message !== 'object' || !['hello', 'frame-probe-ack'].includes(message.type) || typeof message.generation !== 'number') return null
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

function candidateAddress(candidate?: CandidateStats) {
	return candidate?.address || candidate?.ip || candidate?.ipAddress || ''
}

function statsId(value: string | undefined) {
	return value ? value.slice(0, 12) : '-'
}

function finite(value: number | undefined) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function summarizeCandidateStats(candidate: CandidateStats) {
	const address = summarizeNetworkAddress(candidateAddress(candidate))
	const relatedAddress = summarizeNetworkAddress(candidate.relatedAddress || '')
	return {
		id: statsId(candidate.id),
		candidateType: candidate.candidateType || 'unknown',
		protocol: candidate.protocol || 'unknown',
		relayProtocol: candidate.relayProtocol,
		tcpType: candidate.tcpType,
		networkType: candidate.networkType,
		foundation: candidate.foundation,
		component: candidate.component,
		priority: finite(candidate.priority),
		usernameFragment: candidate.usernameFragment,
		address: candidateAddress(candidate),
		port: finite(candidate.port),
		family: address.family,
		addressKind: address.addressKind,
		relatedAddress: candidate.relatedAddress,
		relatedPort: finite(candidate.relatedPort),
		relatedAddressKind: relatedAddress.addressKind === 'unknown' ? undefined : relatedAddress.addressKind,
		url: candidate.url,
	}
}

function summarizePairCandidate(candidate: CandidateStats | undefined) {
	if (!candidate) return undefined
	const address = summarizeNetworkAddress(candidateAddress(candidate))
	return {
		id: statsId(candidate.id),
		candidateType: candidate.candidateType || 'unknown',
		protocol: candidate.protocol || 'unknown',
		networkType: candidate.networkType,
		address: candidateAddress(candidate),
		port: finite(candidate.port),
		family: address.family,
		addressKind: address.addressKind,
		relatedAddress: candidate.relatedAddress,
		relatedPort: finite(candidate.relatedPort),
	}
}

function summarizeCandidatePair(stats: RTCStatsReport, pair: CandidatePairStats) {
	const local = candidateStats(stats, pair.localCandidateId)
	const remote = candidateStats(stats, pair.remoteCandidateId)
	return {
		id: statsId(pair.id),
		state: pair.state || 'unknown',
		nominated: Boolean(pair.nominated),
		selected: Boolean(pair.selected),
		writable: pair.writable,
		readable: pair.readable,
		priority: finite(pair.priority),
		localCandidateId: statsId(pair.localCandidateId),
		remoteCandidateId: statsId(pair.remoteCandidateId),
		local: summarizePairCandidate(local),
		remote: summarizePairCandidate(remote),
		requestsSent: finite(pair.requestsSent),
		requestsReceived: finite(pair.requestsReceived),
		responsesSent: finite(pair.responsesSent),
		responsesReceived: finite(pair.responsesReceived),
		consentRequestsSent: finite(pair.consentRequestsSent),
		bytesSent: finite(pair.bytesSent),
		bytesReceived: finite(pair.bytesReceived),
		packetsSent: finite(pair.packetsSent),
		packetsReceived: finite(pair.packetsReceived),
		packetsDiscardedOnSend: finite(pair.packetsDiscardedOnSend),
		bytesDiscardedOnSend: finite(pair.bytesDiscardedOnSend),
		currentRoundTripTime: finite(pair.currentRoundTripTime),
		totalRoundTripTime: finite(pair.totalRoundTripTime),
		availableOutgoingBitrate: finite(pair.availableOutgoingBitrate),
		availableIncomingBitrate: finite(pair.availableIncomingBitrate),
		firstRequestTimestamp: finite(pair.firstRequestTimestamp),
		lastRequestTimestamp: finite(pair.lastRequestTimestamp),
		firstResponseTimestamp: finite(pair.firstResponseTimestamp),
		lastResponseTimestamp: finite(pair.lastResponseTimestamp),
		lastPacketSentTimestamp: finite(pair.lastPacketSentTimestamp),
		lastPacketReceivedTimestamp: finite(pair.lastPacketReceivedTimestamp),
		consentExpiredTimestamp: finite(pair.consentExpiredTimestamp),
	}
}

function summarizeTransportStats(transport: TransportStats) {
	return {
		id: statsId(transport.id),
		selectedCandidatePairId: statsId(transport.selectedCandidatePairId),
		iceRole: transport.iceRole,
		dtlsState: transport.dtlsState,
		packetsSent: finite(transport.packetsSent),
		packetsReceived: finite(transport.packetsReceived),
		bytesSent: finite(transport.bytesSent),
		bytesReceived: finite(transport.bytesReceived),
	}
}

function summarizeSctpStats(transport: SctpTransportStats) {
	return {
		id: statsId(transport.id),
		state: transport.state,
		bytesSent: finite(transport.bytesSent),
		bytesReceived: finite(transport.bytesReceived),
		maxMessageSize: finite(transport.maxMessageSize),
		maxChannels: finite(transport.maxChannels),
	}
}

function summarizeDescription(description: RTCSessionDescriptionInit | null) {
	const sdp = description?.sdp || ''
	const lines = sdp.split(/\r?\n/)
	const iceUfrags = [...new Set(lines.filter(line => line.startsWith('a=ice-ufrag:')).map(line => line.slice('a=ice-ufrag:'.length)))]
	const icePwdLengths = [...new Set(lines.filter(line => line.startsWith('a=ice-pwd:')).map(line => line.slice('a=ice-pwd:'.length).length))]
	return {
		type: description?.type || 'none',
		mediaSections: lines.filter(line => line.startsWith('m=')).length,
		candidateLines: lines.filter(line => line.startsWith('a=candidate:')).length,
		hasTrickle: lines.some(line => line === 'a=ice-options:trickle'),
		hasIceLite: lines.some(line => line === 'a=ice-lite'),
		iceUfrags,
		icePwdLengths,
		fingerprints: lines.filter(line => line.startsWith('a=fingerprint:')).length,
		setupRoles: [...new Set(lines.filter(line => line.startsWith('a=setup:')).map(line => line.slice('a=setup:'.length)))],
	}
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
	if (family === 'ipv6') {
		const localAddressKind = ipAddressKind(candidateAddress(local))
		const remoteAddressKind = ipAddressKind(candidateAddress(remote))
		return { family, kind: localAddressKind === 'ula-ipv6' || remoteAddressKind === 'ula-ipv6' || (localType === 'host' && remoteType === 'host') ? 'lan' : 'direct' }
	}
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
	private negotiatedChunkSize: number | null = null
	private chunkNegotiation: Promise<number> | null = null
	private reportedChunkSize: number | null = null
	private currentNegotiationId: string
	private makingOffer = false
	private ready = false
	private closed = false
	private lastState: LanTransportState | null = null
	private iceDiagnosticEpoch = 0
	private iceDiagnosticStartedAt = 0
	private iceDiagnosticTimers = new Set<ReturnType<typeof setTimeout>>()

	constructor(private readonly options: LanTransportCreateOptions) {
		this.generation = options.generation
		this.currentNegotiationId = options.negotiationId
		this.log('transport-created', {
			iceServers: lanRtcConfig.iceServers?.map(server => ({ urls: server.urls })),
			iceCandidatePoolSize: lanRtcConfig.iceCandidatePoolSize,
			iceTransportPolicy: lanRtcConfig.iceTransportPolicy || 'all',
			bundlePolicy: lanRtcConfig.bundlePolicy || 'balanced',
			rtcpMuxPolicy: lanRtcConfig.rtcpMuxPolicy || 'require',
		})
		this.pc.onicecandidate = event => {
			const candidate = event.candidate?.toJSON() || null
			if (candidate) this.log('local-candidate', summarizeIceCandidate(event.candidate))
			else this.log('candidate-gathering-complete', { localDescription: summarizeDescription(this.pc.localDescription) })
			options.onCandidate(candidate)
		}
		this.pc.onicecandidateerror = event => {
			const error = event as Event & { url?: string; errorCode?: number; errorText?: string }
			this.log('candidate-gathering-error', { url: error.url || 'unknown', errorCode: error.errorCode, errorText: error.errorText }, 'warn')
		}
		this.pc.onicegatheringstatechange = () => this.log('ice-gathering-state', { state: this.pc.iceGatheringState })
		this.pc.onsignalingstatechange = () => this.log('signaling-state', { state: this.pc.signalingState })
		this.pc.onconnectionstatechange = () => {
			this.log('peer-connection-state', this.connectionStates())
			this.emitConnectionState()
		}
		this.pc.oniceconnectionstatechange = () => {
			this.log('ice-connection-state', this.connectionStates())
			this.updateIceDiagnostics(`ice-${this.pc.iceConnectionState}`)
			this.emitConnectionState()
		}
		if (options.role === 'host') this.bindChannel(this.pc.createDataChannel('lan-session-v12', { ordered: true }))
		else this.pc.ondatachannel = event => this.bindChannel(event.channel)
		this.emitState('connecting')
	}

	get negotiationId() {
		return this.currentNegotiationId
	}

	get bufferedAmount() {
		return this.channel?.bufferedAmount || 0
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

	negotiateChunkSize(peerMaxChunkSize = LAN_LIMITS.dataChannelFallbackChunkSize) {
		const peerLimit = chunkSizeAtMost(peerMaxChunkSize)
		if (peerLimit <= LAN_LIMITS.dataChannelFallbackChunkSize) {
			const chunkSize = LAN_LIMITS.dataChannelFallbackChunkSize
			this.logNegotiatedChunkSize(chunkSize, peerLimit)
			return Promise.resolve(chunkSize)
		}
		if (this.negotiatedChunkSize !== null) return Promise.resolve(chunkSizeAtMost(Math.min(this.negotiatedChunkSize, peerLimit)))
		if (!this.chunkNegotiation) {
			this.chunkNegotiation = this.probeChunkSize(peerLimit).then(chunkSize => {
				this.negotiatedChunkSize = chunkSize
				this.logNegotiatedChunkSize(chunkSize, peerLimit)
				return chunkSize
			}).finally(() => {
				this.chunkNegotiation = null
			})
		}
		return this.chunkNegotiation
	}

	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number, signal?: AbortSignal) {
		return this.waitForBufferedAmount(highWatermark, lowWatermark, timeoutMs, signal)
	}

	async start() {
		if (this.options.role === 'host') {
			this.log('start-offer')
			await this.createOffer(false)
		}
	}

	setNegotiationId(negotiationId: string) {
		if (this.currentNegotiationId === negotiationId) return
		this.log('negotiation-changed', { nextNegotiation: shortConnectionId(negotiationId) })
		this.currentNegotiationId = negotiationId
		this.pendingCandidates = []
		this.remoteDescriptionNegotiationId = ''
	}

	async restartIce(negotiationId: string) {
		if (this.options.role !== 'host' || this.closed) return
		this.setNegotiationId(negotiationId)
		this.log('ice-restart-requested')
		this.cancelIceDiagnostics()
		this.pc.restartIce()
		await this.createOffer(false)
	}

	async acceptDescription(description: RTCSessionDescriptionInit) {
		if (this.closed) return
		this.log('remote-description-received', summarizeDescription(description))
		await this.pc.setRemoteDescription(description)
		this.log('remote-description-applied', {
			...summarizeDescription(this.pc.remoteDescription),
			canTrickleIceCandidates: this.pc.canTrickleIceCandidates,
		})
		this.remoteDescriptionNegotiationId = this.currentNegotiationId
		await this.flushCandidates()
		if (this.pc.iceConnectionState === 'checking' && !this.iceDiagnosticTimers.size) this.startIceDiagnostics('remote-description-applied')
		if (description.type !== 'offer') return
		const answer = await this.pc.createAnswer()
		await this.pc.setLocalDescription(answer)
		this.log('local-description-created', summarizeDescription(this.pc.localDescription))
		if (this.pc.localDescription) this.options.onDescription(this.pc.localDescription.toJSON())
	}

	async addRemoteCandidate(candidate: RTCIceCandidateInit | null) {
		if (this.closed || !candidate) return
		const queued = !this.pc.remoteDescription || this.remoteDescriptionNegotiationId !== this.currentNegotiationId
		this.log('remote-candidate-received', { ...summarizeIceCandidate(candidate), queued, pendingCandidateCount: this.pendingCandidates.length + (queued ? 1 : 0) })
		if (queued) {
			this.pendingCandidates.push(candidate)
			return
		}
		await this.addCandidate(candidate)
	}

	async getHealthStats(): Promise<LanTransportHealthStats> {
		const stats = await this.pc.getStats()
		const pair = selectedCandidatePair(stats)
		return {
			connectionState: this.pc.connectionState,
			iceConnectionState: this.pc.iceConnectionState,
			candidatePairId: pair?.id || '',
			bytesSent: pair?.bytesSent || 0,
			bytesReceived: pair?.bytesReceived || 0,
			consentRequestsSent: typeof pair?.consentRequestsSent === 'number' ? pair.consentRequestsSent : null,
			responsesReceived: typeof pair?.responsesReceived === 'number' ? pair.responsesReceived : null,
		}
	}

	async inspectRoute(): Promise<LanConnectionRoute> {
		const stats = await this.pc.getStats()
		const pair = selectedCandidatePair(stats)
		const route = pair ? routeFromPair(stats, pair) : { family: 'unknown', kind: 'unknown' } as const
		this.log('selected-route', route)
		return route
	}

	close() {
		if (this.closed) return
		this.log('transport-closing', this.connectionStates())
		this.closed = true
		this.cancelIceDiagnostics()
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
		this.pc.onicecandidateerror = null
		this.pc.onicegatheringstatechange = null
		this.pc.onsignalingstatechange = null
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
			this.log('local-description-created', { ...summarizeDescription(this.pc.localDescription), iceRestart })
			if (this.pc.localDescription) this.options.onDescription(this.pc.localDescription.toJSON())
		} catch (error) {
			this.log('offer-creation-failed', { error: error instanceof Error ? error.message : String(error) }, 'error')
			throw error
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
		this.negotiatedChunkSize = null
		this.chunkNegotiation = null
		this.reportedChunkSize = null
		channel.binaryType = 'arraybuffer'
		channel.onopen = () => {
			this.log('data-channel-open')
			this.sendControl({ type: 'hello', generation: this.generation })
		}
		channel.onclose = () => {
			this.log('data-channel-closed', {}, 'warn')
			if (!this.closed && this.channel === channel) this.emitState('channel-closed')
		}
		channel.onerror = () => {
			this.log('data-channel-error', {}, 'warn')
			if (!this.closed && this.channel === channel) this.emitState('channel-closed')
		}
		channel.onmessage = event => {
			if (this.channel === channel) void this.handleChannelMessage(event.data)
		}
	}

	private async handleChannelMessage(data: unknown) {
		if (typeof data === 'string') {
			const control = parseTransportControl(data)
			if (control) return this.handleControl(control)
		}
		const payload = data instanceof Blob ? await data.arrayBuffer() : data
		if (this.handleFrameProbe(payload)) return
		this.options.onData(payload)
	}

	private handleFrameProbe(data: unknown) {
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
		if (!bytes || bytes[0] !== TRANSPORT_FRAME_PROBE || bytes.byteLength < 3) return false
		const idLength = bytes[1]
		if (!idLength || bytes.byteLength < idLength + 2) return true
		const id = decoder.decode(bytes.subarray(2, 2 + idLength))
		this.sendControl({ type: 'frame-probe-ack', generation: this.generation, id })
		return true
	}

	private handleControl(message: TransportControl) {
		if (message.generation !== this.generation) return
		if (message.type === 'hello') {
			if (!this.ready) {
				this.ready = true
				this.log('peer-hello-received')
				this.options.onReady()
			}
			return
		}
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

	private async probeChunkSize(peerMaxChunkSize: number) {
		const sctpMax = this.pc.sctp?.maxMessageSize
		const localFrameLimit = sctpMax && Number.isFinite(sctpMax) ? sctpMax : Number.POSITIVE_INFINITY
		for (const tier of LAN_CHUNK_TIERS) {
			if (tier.chunkSize <= LAN_LIMITS.dataChannelFallbackChunkSize) break
			if (tier.chunkSize > peerMaxChunkSize || tier.frameSize > localFrameLimit) continue
			if (await this.probeFrameSize(tier.frameSize)) return tier.chunkSize
			if (!this.isOpen()) break
		}
		return LAN_LIMITS.dataChannelFallbackChunkSize
	}

	private logNegotiatedChunkSize(chunkSize: number, peerLimit: number) {
		if (this.reportedChunkSize === chunkSize) return
		this.reportedChunkSize = chunkSize
		console.info(`[LAN] 文件分块协商完成：${chunkSize / 1024}KB`, {
			chunkSize,
			peerLimit,
			sctpMaxMessageSize: this.pc.sctp?.maxMessageSize,
		})
	}

	private probeFrameSize(frameSize: number, timeoutMs = 2000) {
		if (!this.isOpen()) return Promise.resolve(false)
		const id = randomId()
		const idBytes = encoder.encode(id)
		if (idBytes.byteLength > 0xff || frameSize < idBytes.byteLength + 2) return Promise.resolve(false)
		const frame = new Uint8Array(frameSize)
		frame[0] = TRANSPORT_FRAME_PROBE
		frame[1] = idBytes.byteLength
		frame.set(idBytes, 2)
		return new Promise<boolean>(resolve => {
			const timer = setTimeout(() => {
				this.pendingProbes.delete(id)
				resolve(false)
			}, timeoutMs)
			this.pendingProbes.set(id, { resolve, timer })
			if (!this.send(frame)) {
				clearTimeout(timer)
				this.pendingProbes.delete(id)
				resolve(false)
			}
		})
	}

	private async flushCandidates() {
		const candidates = this.pendingCandidates
		this.pendingCandidates = []
		if (candidates.length) this.log('remote-candidate-flush-started', { count: candidates.length })
		for (const candidate of candidates) await this.addCandidate(candidate)
		if (candidates.length) this.log('remote-candidate-flush-completed', { count: candidates.length })
	}

	private async addCandidate(candidate: RTCIceCandidateInit) {
		try {
			await this.pc.addIceCandidate(candidate)
			this.log('remote-candidate-added', summarizeIceCandidate(candidate))
			if (this.pc.iceConnectionState === 'checking') void this.logIceDiagnosticSnapshot('remote-candidate-added', this.iceDiagnosticStartedAt ? Date.now() - this.iceDiagnosticStartedAt : 0)
		} catch (error) {
			this.log('remote-candidate-rejected', { ...summarizeIceCandidate(candidate), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }, 'warn')
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
		this.log('transport-state', { state })
		this.options.onState(state)
	}

	private connectionStates() {
		return {
			connectionState: this.pc.connectionState,
			iceConnectionState: this.pc.iceConnectionState,
			iceGatheringState: this.pc.iceGatheringState,
			signalingState: this.pc.signalingState,
			dataChannelState: this.channel?.readyState || 'none',
		}
	}

	private updateIceDiagnostics(trigger: string) {
		const state = this.pc.iceConnectionState
		if (state === 'checking') return this.startIceDiagnostics(trigger)
		const elapsedMs = this.iceDiagnosticStartedAt ? Date.now() - this.iceDiagnosticStartedAt : 0
		this.cancelIceDiagnostics()
		if (state !== 'new' && state !== 'closed') void this.logIceDiagnosticSnapshot(trigger, elapsedMs)
	}

	private startIceDiagnostics(trigger: string) {
		if (this.closed || this.iceDiagnosticTimers.size) return
		const epoch = ++this.iceDiagnosticEpoch
		this.iceDiagnosticStartedAt = Date.now()
		this.log('ice-diagnostics-started', { trigger, sampleDelaysMs: ICE_DIAGNOSTIC_SAMPLE_DELAYS })
		for (const delayMs of ICE_DIAGNOSTIC_SAMPLE_DELAYS) {
			const timer = setTimeout(() => {
				this.iceDiagnosticTimers.delete(timer)
				if (this.closed || epoch !== this.iceDiagnosticEpoch) return
				void this.logIceDiagnosticSnapshot(trigger, Date.now() - this.iceDiagnosticStartedAt)
			}, delayMs)
			this.iceDiagnosticTimers.add(timer)
		}
	}

	private cancelIceDiagnostics() {
		this.iceDiagnosticEpoch += 1
		this.iceDiagnosticTimers.forEach(timer => clearTimeout(timer))
		this.iceDiagnosticTimers.clear()
	}

	private async logIceDiagnosticSnapshot(trigger: string, elapsedMs: number) {
		if (this.closed) return
		try {
			const stats = await this.pc.getStats()
			if (this.closed) return
			const localCandidates: ReturnType<typeof summarizeCandidateStats>[] = []
			const remoteCandidates: ReturnType<typeof summarizeCandidateStats>[] = []
			const pairs: ReturnType<typeof summarizeCandidatePair>[] = []
			const transports: ReturnType<typeof summarizeTransportStats>[] = []
			const sctpTransports: ReturnType<typeof summarizeSctpStats>[] = []
			const pairStates: Record<string, number> = {}
			stats.forEach(report => {
				if (report.type === 'local-candidate') localCandidates.push(summarizeCandidateStats(report as CandidateStats))
				else if (report.type === 'remote-candidate') remoteCandidates.push(summarizeCandidateStats(report as CandidateStats))
				else if (report.type === 'candidate-pair') {
					const pair = report as CandidatePairStats
					pairs.push(summarizeCandidatePair(stats, pair))
					const state = pair.state || 'unknown'
					pairStates[state] = (pairStates[state] || 0) + 1
				} else if (report.type === 'transport') transports.push(summarizeTransportStats(report as TransportStats))
				else if (report.type === 'sctp-transport') sctpTransports.push(summarizeSctpStats(report as SctpTransportStats))
			})
			localCandidates.sort((left, right) => left.id.localeCompare(right.id))
			remoteCandidates.sort((left, right) => left.id.localeCompare(right.id))
			pairs.sort((left, right) => left.id.localeCompare(right.id))
			this.log('ice-candidate-pair-snapshot', {
				trigger,
				elapsedMs,
				...this.connectionStates(),
				canTrickleIceCandidates: this.pc.canTrickleIceCandidates,
				localDescription: summarizeDescription(this.pc.localDescription),
				remoteDescription: summarizeDescription(this.pc.remoteDescription),
				localCandidateCount: localCandidates.length,
				remoteCandidateCount: remoteCandidates.length,
				pairCount: pairs.length,
				pairStates,
				localCandidates,
				remoteCandidates,
				pairs,
				transports,
				sctpTransports,
			})
		} catch (error) {
			if (!this.closed) this.log('ice-candidate-pair-snapshot-failed', {
				trigger,
				elapsedMs,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			}, 'warn')
		}
	}

	private log(event: string, details: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
		logLanConnection('RTC', event, {
			transport: shortConnectionId(this.id),
			role: this.options.role,
			generation: this.generation,
			negotiation: shortConnectionId(this.currentNegotiationId),
			...details,
		}, level)
	}

	private async waitForBufferedAmount(limit: number, lowWatermark: number, timeoutMs: number, signal?: AbortSignal) {
		const channel = this.channel
		if (!channel) throw new Error('连接已断开，请重新连接后再发送')
		if (!this.isOpen()) throw new Error('连接已断开，请重新连接后再发送')
		const activeChannel: RTCDataChannel = channel
		if (activeChannel.bufferedAmount <= limit) return
		const startedAt = Date.now()
		activeChannel.bufferedAmountLowThreshold = lowWatermark
		while (activeChannel.bufferedAmount > lowWatermark) {
			if (signal?.aborted) throw new DOMException('发送已暂停', 'AbortError')
			if (!this.isOpen() || this.channel !== activeChannel) throw new Error('连接已断开，请重新连接后再发送')
			if (Date.now() - startedAt > timeoutMs) throw new Error('发送暂停，请保持两台设备页面打开')
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(done, 250)
				function cleanup() {
					clearTimeout(timer)
					activeChannel.removeEventListener('bufferedamountlow', done)
					activeChannel.removeEventListener('close', fail)
					activeChannel.removeEventListener('error', fail)
					signal?.removeEventListener('abort', abort)
				}
				function done() {
					cleanup()
					resolve()
				}
				function fail() {
					cleanup()
					reject(new Error('连接已断开，请重新连接后再发送'))
				}
				function abort() {
					cleanup()
					reject(new DOMException('发送已暂停', 'AbortError'))
				}
				activeChannel.addEventListener('bufferedamountlow', done, { once: true })
				activeChannel.addEventListener('close', fail, { once: true })
				channel.addEventListener('error', fail, { once: true })
				signal?.addEventListener('abort', abort, { once: true })
			})
		}
	}
}

export function createNativeWebRtcTransport(options: LanTransportCreateOptions) {
	return new NativeWebRtcTransport(options)
}
