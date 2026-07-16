import type { LanReconnectTransport, LanTransportHealthStats } from './transport-types'

const idleIntervalMs = 5000
const activeIntervalMs = 1500
const suspectIntervalMs = 1000
const disconnectedStallMs = 3000
const activeStallMs = 10000
const wakeVerificationMs = 8000
const wakeStallMs = 10000

type HealthMonitorOptions = {
	getTransport: () => LanReconnectTransport | null
	isTransferActive: () => boolean
	onHealthy: (transport: LanReconnectTransport, refreshRoute: boolean, wasSlow: boolean) => void
	onSlow: (transport: LanReconnectTransport) => void
	onSuspect: (status: string, immediate: boolean) => void
}

function visible() {
	return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function connectionFailed(stats: LanTransportHealthStats) {
	return stats.connectionState === 'failed' || stats.iceConnectionState === 'failed' || stats.connectionState === 'closed' || stats.iceConnectionState === 'closed'
}

function connectionDisconnected(stats: LanTransportHealthStats) {
	return stats.connectionState === 'disconnected' || stats.iceConnectionState === 'disconnected'
}

export class ConnectionHealthMonitor {
	private timer: ReturnType<typeof setTimeout> | null = null
	private previous: LanTransportHealthStats | null = null
	private stalledSince = 0
	private verifyUntil = 0
	private reportedSlow = false
	private checking = false
	private epoch = 0

	constructor(private readonly options: HealthMonitorOptions) {}

	start(delayMs = this.options.isTransferActive() ? activeIntervalMs : idleIntervalMs) {
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.timer = null
			void this.check()
		}, delayMs)
	}

	wake() {
		this.verifyUntil = Date.now() + wakeVerificationMs
		this.stalledSince = 0
		void this.check(true)
	}

	stop() {
		this.epoch += 1
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		this.checking = false
		this.resetEvidence()
	}

	private async check(force = false) {
		if (this.checking) return
		const transport = this.options.getTransport()
		if (!transport) return
		if (!visible()) {
			this.resetEvidence()
			return this.start()
		}

		this.checking = true
		const epoch = this.epoch
		try {
			const stats = await transport.getHealthStats()
			if (epoch !== this.epoch || this.options.getTransport() !== transport) return
			this.evaluate(transport, stats, force)
		} catch {
			if (epoch === this.epoch && this.options.getTransport() === transport) this.start(suspectIntervalMs)
		} finally {
			if (epoch === this.epoch) this.checking = false
		}
	}

	private evaluate(transport: LanReconnectTransport, stats: LanTransportHealthStats, force: boolean) {
		const now = Date.now()
		const previous = this.previous
		const pairChanged = Boolean(previous?.candidatePairId && stats.candidatePairId && previous.candidatePairId !== stats.candidatePairId)
		const sent = Boolean(previous && stats.bytesSent > previous.bytesSent)
		const received = Boolean(previous && stats.bytesReceived > previous.bytesReceived)
		const consentRequested = Boolean(previous && previous.consentRequestsSent !== null && stats.consentRequestsSent !== null && stats.consentRequestsSent > previous.consentRequestsSent)
		const consent = Boolean(previous && previous.responsesReceived !== null && stats.responsesReceived !== null && stats.responsesReceived > previous.responsesReceived)
		const strongProgress = pairChanged || received || consent
		this.previous = stats

		if (connectionFailed(stats)) return this.options.onSuspect('连接已失效，正在恢复', true)
		if (connectionDisconnected(stats)) {
			if (strongProgress) return this.markHealthy(transport, pairChanged, false, suspectIntervalMs)
			return this.trackStall(transport, now, disconnectedStallMs, '连接持续中断，正在恢复')
		}

		const active = this.options.isTransferActive()
		const verifying = force || now < this.verifyUntil
		if (strongProgress) return this.markHealthy(transport, pairChanged || verifying, true, active ? activeIntervalMs : idleIntervalMs)
		if (!active && !verifying && !this.stalledSince) return this.markHealthy(transport, pairChanged, false, idleIntervalMs)

		const awaitingReturn = Boolean(this.stalledSince || sent || transport.bufferedAmount > 0 || consentRequested)
		if (!awaitingReturn) {
			this.clearStall()
			return this.start(active ? activeIntervalMs : suspectIntervalMs)
		}

		const limit = active ? activeStallMs : wakeStallMs
		this.trackStall(transport, now, limit, active ? '文件传输路径无响应，正在恢复' : '网络路径无响应，正在恢复')
	}

	private trackStall(transport: LanReconnectTransport, now: number, limitMs: number, status: string) {
		this.stalledSince ||= now
		const elapsed = now - this.stalledSince
		if (elapsed >= limitMs) return this.options.onSuspect(status, true)
		if (!this.reportedSlow && elapsed >= Math.min(3000, limitMs / 2)) {
			this.reportedSlow = true
			this.options.onSlow(transport)
		}
		this.start(suspectIntervalMs)
	}

	private markHealthy(transport: LanReconnectTransport, refreshRoute: boolean, clearVerification: boolean, nextDelay: number) {
		const wasSlow = this.reportedSlow
		this.clearStall()
		if (clearVerification) this.verifyUntil = 0
		if (transport.isOpen() && (refreshRoute || wasSlow)) this.options.onHealthy(transport, refreshRoute, wasSlow)
		this.start(nextDelay)
	}

	private clearStall() {
		this.stalledSince = 0
		this.reportedSlow = false
	}

	private resetEvidence() {
		this.previous = null
		this.verifyUntil = 0
		this.clearStall()
	}
}
