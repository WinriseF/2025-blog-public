import type { LanReconnectTransport } from './transport-types'
import { LAN_LIMITS } from './types'

const healthIntervalMs = 8000
const healthIdleMs = 10000
const healthRetryMs = 3000
const healthProbeTimeoutMs = 5000
const healthBusyProbeTimeoutMs = 10000
const healthProbeBufferedLimit = LAN_LIMITS.mobileBufferLowWatermark
const healthMissLimit = 2
const healthBufferedStallMs = LAN_LIMITS.bufferDrainTimeoutMs

type HealthMonitorOptions = {
	getTransport: () => LanReconnectTransport | null
	onHealthy: (transport: LanReconnectTransport, refreshRoute: boolean, wasSlow: boolean) => void
	onSlow: (transport: LanReconnectTransport) => void
	onSuspect: (status: string, requireInbound: boolean) => void
}

function visible() {
	return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export class ConnectionHealthMonitor {
	private timer: ReturnType<typeof setTimeout> | null = null
	private probe: Promise<boolean> | null = null
	private misses = 0
	private bufferedAmount = 0
	private bufferedSince = 0

	constructor(private readonly options: HealthMonitorOptions) {}

	start(delayMs = healthIntervalMs) {
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.timer = null
			this.check()
		}, delayMs)
	}

	wake() {
		this.check(true)
	}

	stop() {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		this.probe = null
		this.resetEvidence()
	}

	private check(forceProbe = false) {
		const transport = this.options.getTransport()
		if (!transport) return
		if (!visible()) {
			this.resetEvidence()
			return this.start()
		}
		if (!transport.isOpen()) return this.options.onSuspect('连接暂时中断，等待恢复', false)
		const now = Date.now()
		if (!forceProbe && now - transport.lastInboundAt < healthIdleMs) return this.markHealthy(transport, false)

		const bufferedAmount = transport.bufferedAmount
		if (bufferedAmount > healthProbeBufferedLimit) {
			const progressed = Boolean(this.bufferedSince && bufferedAmount < this.bufferedAmount)
			if (!this.bufferedSince || progressed) this.bufferedSince = now
			this.bufferedAmount = bufferedAmount
			if (progressed) {
				const wasSlow = this.misses > 0
				this.misses = 0
				if (wasSlow) this.options.onHealthy(transport, false, true)
			}
			if (now - transport.lastInboundAt >= healthBufferedStallMs && now - this.bufferedSince >= healthBufferedStallMs) {
				return this.options.onSuspect('发送队列长时间无进展，正在恢复', true)
			}
			return this.start()
		}

		this.bufferedAmount = 0
		this.bufferedSince = 0
		this.runProbe(transport, bufferedAmount > 0 ? healthBusyProbeTimeoutMs : healthProbeTimeoutMs, forceProbe)
	}

	private runProbe(transport: LanReconnectTransport, timeoutMs: number, refreshRoute: boolean) {
		if (this.probe) return
		const inboundAt = transport.lastInboundAt
		const probe = transport.probe(timeoutMs).catch(() => false)
		this.probe = probe
		void probe.then(alive => {
			if (this.options.getTransport() !== transport || this.probe !== probe) return
			if (!visible()) {
				this.resetEvidence()
				return this.start()
			}
			if (alive || transport.lastInboundAt > inboundAt) return this.markHealthy(transport, refreshRoute)
			this.misses += 1
			if (this.misses < healthMissLimit) {
				this.options.onSlow(transport)
				return this.start(healthRetryMs)
			}
			this.options.onSuspect('连接连续无响应，正在恢复', true)
		}).finally(() => {
			if (this.probe === probe) this.probe = null
		})
	}

	private markHealthy(transport: LanReconnectTransport, refreshRoute: boolean) {
		const wasSlow = this.misses > 0
		this.resetEvidence()
		this.options.onHealthy(transport, refreshRoute, wasSlow)
		if (!refreshRoute) this.start()
	}

	private resetEvidence() {
		this.misses = 0
		this.bufferedAmount = 0
		this.bufferedSince = 0
	}
}
