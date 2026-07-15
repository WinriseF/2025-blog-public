import type { LanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import type { BenchmarkRole, RawRtcStatsSnapshot } from './types'
import type { BenchmarkSignal, BenchmarkSignalType } from './signaling'

const controlPrefix = '__winrisef_lan_benchmark_v1__:'

export type RawRtcSendErrorDetails = {
	name: string
	message: string
	readyState?: RTCDataChannelState
	connectionState: RTCPeerConnectionState
	iceConnectionState: RTCIceConnectionState
	bufferedAmount: number
	maxMessageSize?: number
}

export class RawRtcSendError extends Error {
	constructor(readonly details: RawRtcSendErrorDetails) {
		super(`${details.name}: ${details.message}`)
		this.name = 'RawRtcSendError'
	}
}

export type BenchmarkPeerStats = {
	route: LanConnectionRoute | null
	rttMs?: number
	availableOutgoingBps?: number
	bytesSent?: number
	bytesReceived?: number
}

type PeerHandlers = {
	onState: (state: string) => void
	onControl: (value: unknown) => void
	onData: (data: unknown) => void
	onRawData: (byteLength: number) => void
	onRawState: (state: 'open' | 'closed' | 'error') => void
}

type Stats = RTCStats & {
	selectedCandidatePairId?: string
	localCandidateId?: string
	remoteCandidateId?: string
	nominated?: boolean
	selected?: boolean
	state?: string
	address?: string
	ip?: string
	ipAddress?: string
	candidateType?: string
	currentRoundTripTime?: number
	availableOutgoingBitrate?: number
	bytesSent?: number
	bytesReceived?: number
	label?: string
}

function family(candidate?: Stats): LanConnectionRoute['family'] {
	const address = candidate?.address || candidate?.ip || candidate?.ipAddress || ''
	if (address.includes(':')) return 'ipv6'
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 'ipv4'
	return 'unknown'
}

function routeFromStats(stats: RTCStatsReport): LanConnectionRoute | null {
	let pair: Stats | undefined
	stats.forEach(item => {
		const report = item as Stats
		if (report.type === 'transport' && report.selectedCandidatePairId) pair ||= stats.get(report.selectedCandidatePairId) as Stats | undefined
	})
	if (!pair) stats.forEach(item => {
		const report = item as Stats
		if (report.type === 'candidate-pair' && (report.selected || report.nominated && report.state === 'succeeded')) pair ||= report
	})
	if (!pair) return null
	const local = pair.localCandidateId ? stats.get(pair.localCandidateId) as Stats | undefined : undefined
	const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) as Stats | undefined : undefined
	const localType = local?.candidateType || ''
	const remoteType = remote?.candidateType || ''
	const localFamily = family(local)
	const remoteFamily = family(remote)
	const resolvedFamily = localFamily === remoteFamily ? localFamily : localFamily === 'unknown' ? remoteFamily : remoteFamily === 'unknown' ? localFamily : 'unknown'
	if (resolvedFamily === 'ipv6') return { family: 'ipv6', kind: 'direct' }
	if (resolvedFamily !== 'ipv4') return { family: 'unknown', kind: 'unknown' }
	if (localType === 'host' && remoteType === 'host') return { family: 'ipv4', kind: 'lan' }
	if (['srflx', 'prflx'].includes(localType) || ['srflx', 'prflx'].includes(remoteType)) return { family: 'ipv4', kind: 'nat' }
	return { family: 'ipv4', kind: 'direct' }
}

export class BenchmarkPeer {
	private readonly pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 2 })
	private channel: RTCDataChannel | null = null
	private rawChannel: RTCDataChannel | null = null
	private remoteId = ''
	private pendingCandidates: RTCIceCandidateInit[] = []
	private handlers: PeerHandlers | null = null
	private closed = false

	constructor(
		private readonly role: BenchmarkRole,
		private readonly sendSignal: (type: BenchmarkSignalType, details?: Pick<BenchmarkSignal, 'description' | 'candidate'>, to?: string) => Promise<void>,
	) {
		this.pc.onicecandidate = event => void this.sendSignal('candidate', { candidate: event.candidate?.toJSON() || null }, this.remoteId || '*').catch(() => {})
		this.pc.onconnectionstatechange = () => this.handlers?.onState(this.pc.connectionState)
		this.pc.oniceconnectionstatechange = () => this.handlers?.onState(this.pc.iceConnectionState)
		if (role === 'host') {
			this.bindChannel(this.pc.createDataChannel('lan-benchmark-v1', { ordered: true }))
			this.bindRawChannel(this.pc.createDataChannel('raw-benchmark-v1', { ordered: true }))
		} else {
			this.pc.ondatachannel = event => {
				if (event.channel.label === 'raw-benchmark-v1') this.bindRawChannel(event.channel)
				else this.bindChannel(event.channel)
			}
		}
	}

	setHandlers(handlers: PeerHandlers) {
		this.handlers = handlers
	}

	isOpen() {
		return !this.closed && this.channel?.readyState === 'open' && (this.pc.connectionState === 'connected' || this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed')
	}

	isRawOpen() {
		return !this.closed && this.rawChannel?.readyState === 'open' && (this.pc.connectionState === 'connected' || this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed')
	}

	get bufferedAmount() {
		return this.channel?.bufferedAmount || 0
	}

	get rawBufferedAmount() {
		return this.rawChannel?.bufferedAmount || 0
	}

	rawMessageSizeLimit() {
		if (!this.isRawOpen()) return null
		const value = this.pc.sctp?.maxMessageSize
		if (typeof value !== 'number') return null
		return value === 0 ? Number.POSITIVE_INFINITY : value
	}

	sendControl(value: unknown) {
		if (this.channel?.readyState !== 'open') return false
		try {
			this.channel.send(`${controlPrefix}${JSON.stringify(value)}`)
			return true
		} catch {
			return false
		}
	}

	send(data: Uint8Array) {
		if (!this.isOpen() || !this.channel) return false
		try {
			const payload = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer
			this.channel.send(payload)
			return true
		} catch {
			return false
		}
	}

	sendRaw(data: Uint8Array) {
		const channel = this.rawChannel
		if (!channel || !this.isRawOpen()) throw this.rawSendError(new DOMException('Raw RTC DataChannel 已断开', 'InvalidStateError'))
		try {
			channel.send(data)
		} catch (error) {
			throw this.rawSendError(error)
		}
	}

	async waitUntilRawWritable(highWatermark: number, lowWatermark: number, timeoutMs: number) {
		const rawChannel = this.rawChannel
		if (!rawChannel || !this.isRawOpen()) throw new Error('Raw RTC DataChannel 已断开')
		const channel: RTCDataChannel = rawChannel
		if (channel.bufferedAmount <= highWatermark) return 0
		channel.bufferedAmountLowThreshold = lowWatermark
		if (channel.bufferedAmount <= lowWatermark) return 0
		const startedAt = performance.now()
		const makeFailure = () => this.rawSendError(new DOMException('Raw RTC DataChannel 缓冲长时间未排空或通道已断开', 'TimeoutError'))
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(fail, timeoutMs)
			function cleanup() {
				window.clearTimeout(timer)
				channel.removeEventListener('bufferedamountlow', done)
				channel.removeEventListener('close', fail)
				channel.removeEventListener('error', fail)
			}
			function done() { cleanup(); resolve() }
			function fail() { cleanup(); reject(makeFailure()) }
			channel.addEventListener('bufferedamountlow', done, { once: true })
			channel.addEventListener('close', fail, { once: true })
			channel.addEventListener('error', fail, { once: true })
			if (channel.bufferedAmount <= lowWatermark) done()
		})
		return performance.now() - startedAt
	}

	async waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number) {
		const startedAt = performance.now()
		while (this.bufferedAmount > highWatermark) {
			if (!this.isOpen()) throw new Error('诊断连接已断开')
			if (performance.now() - startedAt > timeoutMs) throw new Error('DataChannel 缓冲长时间未排空')
			const currentChannel = this.channel
			if (!currentChannel) throw new Error('诊断连接已断开')
			const channel: RTCDataChannel = currentChannel
			channel.bufferedAmountLowThreshold = lowWatermark
			await new Promise<void>((resolve, reject) => {
				const timer = window.setTimeout(done, 250)
				function cleanup() {
					window.clearTimeout(timer)
					channel.removeEventListener('bufferedamountlow', done)
					channel.removeEventListener('close', fail)
				}
				function done() { cleanup(); resolve() }
				function fail() { cleanup(); reject(new Error('诊断连接已断开')) }
				channel.addEventListener('bufferedamountlow', done, { once: true })
				channel.addEventListener('close', fail, { once: true })
			})
		}
	}

	async handleSignal(signal: BenchmarkSignal) {
		if (this.closed || signal.type === 'leave') return this.handlers?.onState('对方已离开')
		if (signal.role === this.role || this.remoteId && signal.from !== this.remoteId) return
		if (signal.type === 'hello') {
			this.remoteId = signal.from
			if (this.role === 'host') await this.createOffer()
			return
		}
		if (signal.type === 'offer' && this.role === 'guest' && signal.description) {
			this.remoteId = signal.from
			await this.pc.setRemoteDescription(signal.description)
			await this.flushCandidates()
			const answer = await this.pc.createAnswer()
			await this.pc.setLocalDescription(answer)
			if (this.pc.localDescription) await this.sendSignal('answer', { description: this.pc.localDescription.toJSON() }, this.remoteId)
			return
		}
		if (signal.type === 'answer' && this.role === 'host' && signal.description) {
			this.remoteId = signal.from
			await this.pc.setRemoteDescription(signal.description)
			await this.flushCandidates()
			return
		}
		if (signal.type === 'candidate' && signal.candidate) {
			if (!this.pc.remoteDescription) this.pendingCandidates.push(signal.candidate)
			else await this.pc.addIceCandidate(signal.candidate).catch(() => {})
		}
	}

	async getStats(): Promise<BenchmarkPeerStats> {
		const stats = await this.pc.getStats()
		let rttMs: number | undefined
		let availableOutgoingBps: number | undefined
		let bytesSent: number | undefined
		let bytesReceived: number | undefined
		stats.forEach(item => {
			const report = item as Stats
			if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) rttMs ||= report.currentRoundTripTime * 1000
			if (report.type === 'candidate-pair' && report.availableOutgoingBitrate !== undefined) availableOutgoingBps ||= report.availableOutgoingBitrate
			if (report.type === 'data-channel' && report.label === 'lan-benchmark-v1') {
				bytesSent = report.bytesSent
				bytesReceived = report.bytesReceived
			}
		})
		return { route: routeFromStats(stats), rttMs, availableOutgoingBps, bytesSent, bytesReceived }
	}

	async getRawStats(): Promise<RawRtcStatsSnapshot> {
		const stats = await this.pc.getStats()
		let dataChannelBytesSent = 0
		let dataChannelBytesReceived = 0
		let transportBytesSent = 0
		let transportBytesReceived = 0
		let rttMs: number | undefined
		let availableOutgoingBps: number | undefined
		stats.forEach(item => {
			const report = item as Stats
			if (report.type === 'data-channel' && report.label === 'raw-benchmark-v1') {
				dataChannelBytesSent = report.bytesSent || 0
				dataChannelBytesReceived = report.bytesReceived || 0
			}
			if (report.type === 'transport') {
				transportBytesSent += report.bytesSent || 0
				transportBytesReceived += report.bytesReceived || 0
			}
			if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) rttMs ||= report.currentRoundTripTime * 1000
			if (report.type === 'candidate-pair' && report.availableOutgoingBitrate !== undefined) availableOutgoingBps ||= report.availableOutgoingBitrate
		})
		return { capturedAt: performance.now(), dataChannelBytesSent, dataChannelBytesReceived, transportBytesSent, transportBytesReceived, rttMs, availableOutgoingBps }
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.channel?.close()
		this.rawChannel?.close()
		this.pc.close()
	}

	private async createOffer() {
		const existingDescription = this.pc.localDescription
		if (this.closed || !this.remoteId || this.pc.signalingState !== 'stable' || existingDescription) return
		const offer = await this.pc.createOffer()
		await this.pc.setLocalDescription(offer)
		const description = this.pc.localDescription
		if (description) await this.sendSignal('offer', { description: description.toJSON() }, this.remoteId)
	}

	private async flushCandidates() {
		const candidates = this.pendingCandidates
		this.pendingCandidates = []
		for (const candidate of candidates) await this.pc.addIceCandidate(candidate).catch(() => {})
	}

	private bindChannel(channel: RTCDataChannel) {
		this.channel = channel
		channel.binaryType = 'arraybuffer'
		channel.onopen = () => this.handlers?.onState('DataChannel 已就绪')
		channel.onclose = () => this.handlers?.onState('DataChannel 已关闭')
		channel.onerror = () => this.handlers?.onState('DataChannel 出错')
		channel.onmessage = event => {
			if (typeof event.data === 'string' && event.data.startsWith(controlPrefix)) {
				try { this.handlers?.onControl(JSON.parse(event.data.slice(controlPrefix.length))) } catch { /* ignore invalid control */ }
				return
			}
			this.handlers?.onData(event.data)
		}
	}

	private bindRawChannel(channel: RTCDataChannel) {
		this.rawChannel = channel
		channel.binaryType = 'arraybuffer'
		channel.onopen = () => this.handlers?.onRawState('open')
		channel.onclose = () => this.handlers?.onRawState('closed')
		channel.onerror = () => this.handlers?.onRawState('error')
		channel.onmessage = event => {
			if (event.data instanceof ArrayBuffer) this.handlers?.onRawData(event.data.byteLength)
		}
	}

	private rawSendError(error: unknown) {
		const source = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : null
		return new RawRtcSendError({
			name: typeof source?.name === 'string' ? source.name : 'Error',
			message: typeof source?.message === 'string' ? source.message : String(error),
			readyState: this.rawChannel?.readyState,
			connectionState: this.pc.connectionState,
			iceConnectionState: this.pc.iceConnectionState,
			bufferedAmount: this.rawChannel?.bufferedAmount || 0,
			maxMessageSize: this.pc.sctp?.maxMessageSize,
		})
	}
}
