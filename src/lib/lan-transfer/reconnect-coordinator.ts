import { ConnectionHealthMonitor } from './connection-health-monitor'
import { logLanConnection, shortConnectionId, summarizeIceCandidate } from './connection-diagnostics'
import type { LanConnectionRoute, LanReconnectTransport, LanTransportFactory, LanTransportState } from './transport-types'
import type { LanConnectionState, LanPeer, LanRole, LanSignalMessage, LanSignalSendDetails, LanSignalTarget, LanSignalType } from './types'

const suspectGraceMs = 3000
const iceRestartTimeoutMs = 5000
const rebuildTimeoutMs = 7000
const backoffDelays = [0, 750, 2000]

export type ReconnectCoordinatorOptions = {
	role: LanRole
	remotePeer: LanPeer
	createTransport: LanTransportFactory
	isTransferActive: () => boolean
	sendSignal: (type: LanSignalType, target: LanSignalTarget, details?: LanSignalSendDetails) => Promise<void>
	onState: (peer: LanPeer, state: LanConnectionState, status: string, connected: boolean) => void
	onAttach: (peer: LanPeer, transport: LanReconnectTransport, route: LanConnectionRoute) => void
	onPause: (peer: LanPeer, transportId: string) => void
	onResume: (peer: LanPeer, transportId: string) => void
	onRoute: (peer: LanPeer, transportId: string, route: LanConnectionRoute) => void
	onDetach: (peer: LanPeer, transportId: string | null, state: LanConnectionState, status: string) => void
	onData: (peer: LanPeer, transportId: string, data: unknown) => void
}

function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function visible() {
	return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export class ReconnectCoordinator {
	private peer: LanPeer
	private transport: LanReconnectTransport | null = null
	private generation = 0
	private negotiationId = ''
	private remoteNegotiationSeq = 0
	private state: LanConnectionState = 'idle'
	private readyTransportId = ''
	private attachedTransportId = ''
	private backoffIndex = 0
	private attemptEpoch = 0
	private closed = false
	private signalOnline = false
	private remotePresent = true
	private remoteClosedInstanceId = ''
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
	private attemptTimer: ReturnType<typeof setTimeout> | null = null
	private suspectTimer: ReturnType<typeof setTimeout> | null = null
	private backoffTimer: ReturnType<typeof setTimeout> | null = null
	private hardRecoveryRequested = false
	private retryExhausted = false
	private readonly healthMonitor: ConnectionHealthMonitor

	constructor(private readonly options: ReconnectCoordinatorOptions) {
		this.peer = options.remotePeer
		this.healthMonitor = new ConnectionHealthMonitor({
			getTransport: () => this.transport,
			isTransferActive: options.isTransferActive,
			onHealthy: (transport, refreshRoute, wasSlow) => {
				if (this.closed || this.transport !== transport) return
				if (refreshRoute) this.refreshRoute(transport)
				if (wasSlow && this.attachedTransportId === transport.id) this.setState('connected', '已连接，可以发送消息和文件', true)
			},
			onSlow: transport => {
				if (!this.closed && this.transport === transport && this.attachedTransportId === transport.id) this.setState('connected', '连接响应较慢，正在确认', true)
			},
			onSuspect: (status, immediate) => this.enterSuspect(status, immediate),
		})
		this.log('coordinator-created')
		this.setState('discovered', '找到设备，正在连接')
	}

	get remotePeer() {
		return this.peer
	}

	updatePeer(peer: LanPeer) {
		if (this.closed || peer.deviceId !== this.peer.deviceId) return
		const instanceChanged = peer.instanceId !== this.peer.instanceId
		const presenceRestored = !this.remotePresent
		if (!instanceChanged && peer.joinedAt < this.peer.joinedAt) return
		this.peer = peer
		this.remotePresent = true
		if (instanceChanged) {
			this.invalidateAttempt()
			this.resetRetryBudget()
			this.hardRecoveryRequested = true
			this.remoteClosedInstanceId = ''
			this.clearTimers()
			this.pendingCandidates.clear()
			this.closeTransport('设备页面已更新，正在重新连接', 'rebuilding')
			if (this.options.role === 'guest') this.generation = 0
			this.negotiationId = ''
			this.remoteNegotiationSeq = 0
			this.setState('discovered', '设备页面已更新，正在重新连接')
		}
		if (!instanceChanged && this.remoteClosedInstanceId === peer.instanceId) return
		if (presenceRestored) {
			this.resetRetryBudget()
			const transport = this.transport
			if (transport?.isOpen() && this.state === 'connected') {
				this.setState('connected', '已连接，可以发送消息和文件', true)
				this.healthMonitor.wake()
				return
			}
		}
		this.recover(instanceChanged ? '设备页面已恢复' : '发现设备')
	}

	setPeerPresent(peer: LanPeer, present: boolean) {
		if (this.closed || peer.deviceId !== this.peer.deviceId || peer.instanceId !== this.peer.instanceId) return
		if (present) {
			if (this.remotePresent) return
			this.remotePresent = true
			this.resetRetryBudget()
			const transport = this.transport
			if (transport?.isOpen()) {
				if (this.state === 'connected') {
					this.setState('connected', '已连接，可以发送消息和文件', true)
					this.healthMonitor.wake()
				}
				return
			}
			if (this.remoteClosedInstanceId !== peer.instanceId) this.recover('设备重新在线', true)
			return
		}
		if (!this.remotePresent) return
		this.remotePresent = false
		const transport = this.transport
		if (transport?.isOpen()) {
			this.log('peer-presence-lost-transport-preserved')
			if (this.state === 'connected') this.setState('connected', '直连正常，连接服务暂时离线', true)
			return
		}
		this.invalidateAttempt()
		this.clearTimers()
		this.closeTransport('对方暂时离线，等待重新上线', 'backoff')
		this.setState('backoff', '对方暂时离线，等待重新上线')
	}

	setSignalingOnline(online: boolean) {
		if (this.closed) return
		const restored = online && !this.signalOnline
		this.signalOnline = online
		this.log('signaling-state', { online })
		if (!online) return
		if (restored) this.resetRetryBudget()
		const transport = this.transport
		if (transport?.isOpen()) {
			if (this.state === 'connected') {
				this.setState('connected', '已连接，可以发送消息和文件', true)
				this.healthMonitor.wake()
			}
			return
		}
		this.recover('连接服务已恢复')
	}

	handleSignal(message: LanSignalMessage) {
		if (this.closed || message.fromDeviceId !== this.peer.deviceId) return
		if (message.type !== 'announce' && message.type !== 'candidate') this.log('signal-received', { type: message.type, generation: message.generation, negotiation: shortConnectionId(message.negotiationId) })
		if (message.peer) this.updatePeerWithoutRecovery(message.peer)
		if (message.fromInstanceId !== this.peer.instanceId) {
			if (message.type !== 'announce') this.log('signal-ignored', { type: message.type, reason: 'remote-instance-mismatch', remoteInstance: shortConnectionId(message.fromInstanceId) }, 'warn')
			return
		}
		if (this.remoteClosedInstanceId === message.fromInstanceId && message.type !== 'peer-left') {
			if (message.type !== 'announce') this.log('signal-ignored', { type: message.type, reason: 'remote-instance-closed' }, 'warn')
			return
		}
		if (this.options.role === 'guest' && (message.type === 'rebuild' || message.type === 'ice-restart' || message.type === 'offer') && !this.acceptNegotiationMessage(message)) return
		if (message.type === 'announce') return this.recover('设备在线')
		if (message.type === 'peer-left') return this.handleRemoteLeft()
		if (message.type === 'reconnect-request') {
			if (this.options.role === 'host' && !(this.state === 'connected' && message.generation < this.generation)) {
				this.hardRecoveryRequested ||= Boolean(message.hardRecovery)
				if (message.hardRecovery) void this.startRebuild('对方请求重新建立连接')
				else this.recover('对方请求恢复连接', true)
			}
			return
		}
		if (message.type === 'rebuild') {
			if (this.options.role === 'guest') this.acceptRebuild(message)
			return
		}
		if (message.type === 'ice-restart') {
			if (this.options.role === 'guest') this.acceptIceRestart(message)
			return
		}
		if (message.type === 'offer') {
			if (this.options.role === 'guest' && message.description) void this.acceptOffer(message)
			return
		}
		if (message.type === 'answer') {
			if (this.options.role === 'host' && this.matchesCurrent(message) && message.description) {
				this.remoteNegotiationSeq = Math.max(this.remoteNegotiationSeq, message.seq)
				const transport = this.transport
				const attempt = this.attemptEpoch
				if (transport) void transport.acceptDescription(message.description, attempt).catch(() => this.handleAttemptFailure(attempt, transport))
			} else {
				this.log('signal-ignored', { type: message.type, reason: 'answer-not-current', messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId), hasDescription: Boolean(message.description) }, 'warn')
			}
			return
		}
		if (message.type === 'candidate') this.acceptCandidate(message)
	}

	wake() {
		if (this.closed) return
		this.resetRetryBudget()
		const transport = this.transport
		if (!transport) return this.recover('页面已恢复')
		if (transport.isOpen()) return this.healthMonitor.wake()
		this.enterSuspect('页面已恢复，正在检查连接')
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.invalidateAttempt()
		this.clearTimers()
		this.pendingCandidates.clear()
		this.closeTransport('连接已关闭', 'closed')
		this.setState('closed', '连接已关闭')
	}

	retry() {
		if (this.closed) return
		if (this.remoteClosedInstanceId === this.peer.instanceId) return this.setState('backoff', '对方已离开，等待重新上线')
		if (!this.remotePresent) return this.setState('backoff', '对方暂时离线，等待重新上线')
		this.resetRetryBudget()
		this.hardRecoveryRequested = true
		this.invalidateAttempt()
		this.clearTimers()
		this.closeTransport('正在重新连接', 'backoff')
		this.setState('backoff', '正在重新连接')
		this.recover('手动重试', true)
	}

	private updatePeerWithoutRecovery(peer: LanPeer) {
		if (peer.deviceId !== this.peer.deviceId || peer.joinedAt < this.peer.joinedAt) return
		this.remotePresent = true
		if (peer.instanceId !== this.peer.instanceId) {
			this.peer = peer
			this.invalidateAttempt()
			this.resetRetryBudget()
			this.remoteClosedInstanceId = ''
			this.hardRecoveryRequested = true
			this.clearTimers()
			this.pendingCandidates.clear()
			this.closeTransport('设备页面已更新，正在重新连接', 'rebuilding')
			if (this.options.role === 'guest') this.generation = 0
			this.negotiationId = ''
			this.remoteNegotiationSeq = 0
			this.setState('discovered', '设备页面已更新，正在重新连接')
			return
		}
		this.peer = peer
	}

	private recover(reason: string, force = false) {
		if (this.closed) return
		if (this.remoteClosedInstanceId === this.peer.instanceId) return this.setState('backoff', '对方已离开，等待重新连接')
		if (!this.remotePresent) {
			if (force) this.closeTransport('对方暂时离线，等待重新上线', 'backoff')
			return this.setState('backoff', '对方暂时离线，等待重新上线')
		}
		if (this.retryExhausted) return this.setState('backoff', '自动重连未成功，请立即重试或切换公网传输')
		if (this.state === 'connecting' || this.state === 'rebuilding' || this.state === 'ice-restarting') return
		if (!force && this.transport?.isOpen()) return
		this.pauseCurrent()
		if (!this.signalOnline) return this.setState('backoff', '等待连接服务恢复')
		this.clearBackoff()
		if (this.options.role === 'host') {
			if (this.hardRecoveryRequested || !this.transport) void this.startRebuild(reason)
			else void this.startIceRestart()
			return
		}
		const attempt = this.beginAttempt()
		const transport = this.transport
		this.setState('connecting', '正在请求主机恢复连接')
		this.armAttempt(rebuildTimeoutMs, () => this.handleAttemptFailure(attempt, transport), attempt)
		void this.options.sendSignal('reconnect-request', this.target(), { generation: this.generation, negotiationId: this.negotiationId, reason, hardRecovery: this.hardRecoveryRequested })
			.catch(() => this.handleAttemptFailure(attempt, transport))
	}

	private async startRebuild(reason: string) {
		if (this.closed) return
		if (!this.signalOnline) {
			this.hardRecoveryRequested = true
			return this.setState('backoff', '等待连接服务恢复')
		}
		if (this.state === 'rebuilding') return
		const attempt = this.beginAttempt()
		this.hardRecoveryRequested = false
		this.closeTransport('正在重新建立连接', 'rebuilding')
		this.generation += 1
		this.negotiationId = randomId()
		this.setState('rebuilding', '正在重新建立连接')
		this.armAttempt(rebuildTimeoutMs, () => this.handleAttemptFailure(attempt), attempt)
		try {
			await this.options.sendSignal('rebuild', this.target(), { generation: this.generation, negotiationId: this.negotiationId, reason })
		} catch {
			return this.scheduleBackoff(attempt)
		}
		if (!this.isCurrentAttempt(attempt, 'rebuilding')) return
		const transport = this.createTransport(this.generation, this.negotiationId)
		void transport.start(attempt).catch(() => this.handleAttemptFailure(attempt, transport))
	}

	private acceptRebuild(message: LanSignalMessage) {
		if (message.generation < this.generation) return
		if (message.generation === this.generation && message.negotiationId === this.negotiationId && this.transport) return
		if (message.generation > this.generation) this.resetRetryBudget()
		const attempt = this.beginAttempt()
		this.hardRecoveryRequested = false
		this.closeTransport('主机正在重新建立连接', 'rebuilding')
		this.generation = message.generation
		this.negotiationId = message.negotiationId
		this.setState('rebuilding', '主机正在重新建立连接')
		const transport = this.createTransport(this.generation, this.negotiationId)
		this.armAttempt(rebuildTimeoutMs, () => this.handleAttemptFailure(attempt, transport), attempt)
	}

	private async startIceRestart() {
		const transport = this.transport
		if (this.closed || !transport) {
			this.hardRecoveryRequested = true
			return void this.startRebuild('连接需要重建')
		}
		if (!this.signalOnline) return void this.setState('backoff', '等待连接服务恢复')
		if (this.state === 'ice-restarting' || this.state === 'rebuilding') return
		const attempt = this.beginAttempt()
		this.negotiationId = randomId()
		transport.setNegotiationId(this.negotiationId)
		this.pauseCurrent()
		this.setState('ice-restarting', '正在恢复网络路径')
		this.armAttempt(iceRestartTimeoutMs, () => void this.startRebuild('网络路径恢复超时'), attempt)
		try {
			await this.options.sendSignal('ice-restart', this.target(), { generation: this.generation, negotiationId: this.negotiationId })
		} catch {
			return this.scheduleBackoff(attempt)
		}
		if (!this.isCurrentAttempt(attempt, 'ice-restarting') || this.transport !== transport) return
		void transport.restartIce(this.negotiationId, attempt).catch(() => {
			if (this.isCurrentAttempt(attempt, 'ice-restarting') && this.transport === transport) void this.startRebuild('网络路径恢复失败')
		})
	}

	private acceptIceRestart(message: LanSignalMessage) {
		if (message.generation !== this.generation || !this.transport) return
		const attempt = this.beginAttempt()
		this.negotiationId = message.negotiationId
		this.transport.setNegotiationId(message.negotiationId)
		this.drainCandidates(this.transport, this.generation, this.negotiationId)
		this.pauseCurrent()
		this.setState('ice-restarting', '主机正在恢复网络路径')
		this.armAttempt(iceRestartTimeoutMs, () => this.handleAttemptFailure(attempt, this.transport), attempt)
	}

	private async acceptOffer(message: LanSignalMessage) {
		if (message.generation < this.generation || !message.description) return
		this.clearBackoff()
		let attempt = this.attemptEpoch
		if (!this.transport || message.generation > this.generation) {
			if (message.generation > this.generation) this.resetRetryBudget()
			attempt = this.beginAttempt()
			this.closeTransport('正在接受新连接', 'rebuilding')
			this.generation = message.generation
			this.negotiationId = message.negotiationId
			this.setState('rebuilding', '正在接受新连接')
			const transport = this.createTransport(this.generation, this.negotiationId)
			this.armAttempt(rebuildTimeoutMs, () => this.handleAttemptFailure(attempt, transport), attempt)
		} else if (message.negotiationId !== this.negotiationId) {
			attempt = this.beginAttempt()
			this.negotiationId = message.negotiationId
			this.transport.setNegotiationId(message.negotiationId)
			this.drainCandidates(this.transport, this.generation, this.negotiationId)
			this.pauseCurrent()
			this.setState('ice-restarting', '主机正在恢复网络路径')
			this.armAttempt(iceRestartTimeoutMs, () => this.handleAttemptFailure(attempt, this.transport), attempt)
		}
		const transport = this.transport
		if (!transport) return
		try {
			await transport.acceptDescription(message.description, attempt)
		} catch {
			this.handleAttemptFailure(attempt, transport)
		}
	}

	private createTransport(generation: number, negotiationId: string) {
		let transport!: LanReconnectTransport
		transport = this.options.createTransport({
			role: this.options.role,
			generation,
			negotiationId,
			onDescription: (description, descriptionNegotiationId, descriptionAttempt) => {
				if (this.transport !== transport || !this.isCurrentAttempt(descriptionAttempt) || descriptionNegotiationId !== this.negotiationId || descriptionNegotiationId !== transport.negotiationId) {
					this.log('description-ignored', { reason: 'stale-attempt', descriptionAttempt, descriptionNegotiation: shortConnectionId(descriptionNegotiationId) }, 'warn')
					return
				}
				const type = description.type === 'offer' ? 'offer' : 'answer'
				void this.options.sendSignal(type, this.target(), { generation, negotiationId: descriptionNegotiationId, description }).catch(() => this.handleAttemptFailure(descriptionAttempt, transport))
			},
			onCandidate: candidate => {
				if (candidate && this.transport === transport) void this.options.sendSignal('candidate', this.target(), { generation, negotiationId: transport.negotiationId, candidate }).catch(() => {})
			},
			onData: data => {
				if (this.transport === transport) this.options.onData(this.peer, transport.id, data)
			},
			onState: state => this.handleTransportState(transport, state),
			onReady: () => {
				if (this.transport !== transport) return
				this.readyTransportId = transport.id
				this.restoreConnected(transport)
			},
		})
		this.transport = transport
		this.readyTransportId = ''
		this.attachedTransportId = ''
		this.setState(this.state === 'rebuilding' ? 'rebuilding' : 'connecting', '正在建立直连')
		this.drainCandidates(transport, generation, negotiationId)
		return transport
	}

	private acceptCandidate(message: LanSignalMessage) {
		const candidate = summarizeIceCandidate(message.candidate || null)
		if (!message.candidate) {
			this.log('candidate-ignored', { ...candidate, reason: 'missing-candidate', messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId) }, 'warn')
			return
		}
		if (message.generation < this.generation || message.generation > this.generation + 1) {
			this.log('candidate-ignored', { ...candidate, reason: 'generation-out-of-window', messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId) }, 'warn')
			return
		}
		if (message.negotiationId !== this.negotiationId && message.seq < this.remoteNegotiationSeq) {
			this.log('candidate-ignored', { ...candidate, reason: 'stale-negotiation-sequence', messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId), messageSeq: message.seq, remoteNegotiationSeq: this.remoteNegotiationSeq }, 'warn')
			return
		}
		if (this.matchesCurrent(message) && this.transport) {
			this.log('candidate-dispatched', { ...candidate, messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId) })
			void this.transport.addRemoteCandidate(message.candidate).catch(() => {})
			return
		}
		const key = `${message.generation}:${message.negotiationId}`
		if (!this.pendingCandidates.has(key) && this.pendingCandidates.size >= 8) {
			const removedKey = this.pendingCandidates.keys().next().value as string
			this.pendingCandidates.delete(removedKey)
			this.log('candidate-queue-evicted', { removedKey: shortConnectionId(removedKey), queueKeys: this.pendingCandidates.size }, 'warn')
		}
		const candidates = this.pendingCandidates.get(key) || []
		if (candidates.length >= 128) {
			this.log('candidate-ignored', { ...candidate, reason: 'candidate-queue-full', messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId), queuedCount: candidates.length }, 'warn')
			return
		}
		candidates.push(message.candidate)
		this.pendingCandidates.set(key, candidates)
		this.log('candidate-queued', { ...candidate, messageGeneration: message.generation, messageNegotiation: shortConnectionId(message.negotiationId), queuedCount: candidates.length, queueKeys: this.pendingCandidates.size })
	}

	private drainCandidates(transport: LanReconnectTransport, generation: number, negotiationId: string) {
		const key = `${generation}:${negotiationId}`
		const candidates = this.pendingCandidates.get(key) || []
		this.pendingCandidates.delete(key)
		this.log('candidate-queue-draining', { generation, negotiation: shortConnectionId(negotiationId), count: candidates.length, remainingQueueKeys: this.pendingCandidates.size })
		for (const candidate of candidates) void transport.addRemoteCandidate(candidate).catch(() => {})
		let removedStaleKeys = 0
		for (const pendingKey of this.pendingCandidates.keys()) {
			const pendingGeneration = Number(pendingKey.slice(0, pendingKey.indexOf(':')))
			if (pendingGeneration < generation) {
				this.pendingCandidates.delete(pendingKey)
				removedStaleKeys += 1
			}
		}
		if (removedStaleKeys) this.log('candidate-stale-queues-removed', { generation, removedStaleKeys, remainingQueueKeys: this.pendingCandidates.size }, 'warn')
	}

	private handleTransportState(transport: LanReconnectTransport, state: LanTransportState) {
		if (this.closed || this.transport !== transport) return
		if (state === 'connected') {
			if (this.readyTransportId === transport.id) this.restoreConnected(transport)
			return
		}
		if (state === 'disconnected') {
			return this.enterSuspect('连接暂时中断，等待恢复')
		}
		if (state === 'failed') {
			return this.enterSuspect('连接失败，正在恢复', true)
		}
		if (state === 'channel-closed') {
			this.healthMonitor.stop()
			this.hardRecoveryRequested = true
			this.closeTransport('数据通道已关闭，正在重新连接', 'suspect')
			this.setState('suspect', '数据通道已关闭，正在重新连接')
			if (this.options.role === 'host') void this.startRebuild('数据通道已关闭')
			else this.recover('数据通道已关闭', true)
		}
	}

	private restoreConnected(transport: LanReconnectTransport) {
		if (this.closed || this.transport !== transport || !transport.isOpen()) return
		this.invalidateAttempt()
		this.clearTimers()
		this.resetRetryBudget()
		this.hardRecoveryRequested = false
		if (this.attachedTransportId === transport.id) {
			this.options.onResume(this.peer, transport.id)
			this.setState('connected', '已连接，可以发送消息和文件', true)
			this.refreshRoute(transport)
			return this.healthMonitor.start()
		}
		this.setState('connected', '正在确认连接线路')
		void transport.inspectRoute().catch((): LanConnectionRoute => ({ family: 'unknown', kind: 'unknown' })).then(route => {
			if (this.closed || this.transport !== transport || !transport.isOpen()) return
			this.attachedTransportId = transport.id
			this.options.onAttach(this.peer, transport, route)
			this.setState('connected', '已连接，可以发送消息和文件', true)
			this.healthMonitor.start()
		})
	}

	private refreshRoute(transport: LanReconnectTransport) {
		void transport.inspectRoute().then(route => {
			if (this.closed || this.transport !== transport || this.attachedTransportId !== transport.id || !transport.isOpen()) return
			this.options.onRoute(this.peer, transport.id, route)
		}).catch(() => {})
	}

	private enterSuspect(status: string, immediate = false) {
		if (this.closed || this.state === 'ice-restarting' || this.state === 'rebuilding') return
		if (this.state === 'suspect') {
			if (immediate) {
				this.clearSuspect()
				this.recover(status, true)
			}
			return
		}
		const attempt = this.beginAttempt()
		this.healthMonitor.stop()
		this.pauseCurrent()
		this.setState('suspect', status)
		this.clearSuspect()
		if (immediate) return this.recover(status, true)
		this.suspectTimer = setTimeout(() => {
			this.suspectTimer = null
			if (this.attemptEpoch === attempt) this.recover('连接没有自然恢复', true)
		}, suspectGraceMs)
	}

	private handleAttemptFailure(attempt = this.attemptEpoch, transport?: LanReconnectTransport | null) {
		if (this.closed || attempt !== this.attemptEpoch || transport && this.transport !== transport) return
		this.log('connection-attempt-failed', { state: this.state }, 'warn')
		if (this.state === 'ice-restarting') {
			this.hardRecoveryRequested = true
			if (this.options.role === 'host') return void this.startRebuild('网络路径恢复失败')
			this.closeTransport('网络路径恢复失败，正在重新连接', 'backoff')
			this.setState('backoff', '网络路径恢复失败，正在重新连接')
			return this.recover('网络路径恢复失败', true)
		}
		this.hardRecoveryRequested = true
		this.closeTransport('连接失败，稍后重试', 'backoff')
		this.scheduleBackoff(attempt)
	}

	private scheduleBackoff(attempt = this.attemptEpoch) {
		if (this.closed || attempt !== this.attemptEpoch) return
		const backoffAttempt = this.beginAttempt()
		this.setState('backoff', '连接失败，稍后自动重试')
		if (this.backoffIndex >= backoffDelays.length) {
			this.retryExhausted = true
			this.log('automatic-retry-exhausted', { attempts: this.backoffIndex }, 'warn')
			return this.setState('backoff', '自动重连未成功，请立即重试或切换公网传输')
		}
		if (!visible()) return
		const delay = backoffDelays[this.backoffIndex]
		this.backoffIndex += 1
		this.log('retry-scheduled', { delayMs: delay, attempt: this.backoffIndex }, 'warn')
		this.clearBackoff()
		this.backoffTimer = setTimeout(() => {
			this.backoffTimer = null
			if (this.attemptEpoch === backoffAttempt) this.recover('自动重试', true)
		}, delay)
	}

	private handleRemoteLeft() {
		this.remotePresent = false
		this.invalidateAttempt()
		this.remoteClosedInstanceId = this.peer.instanceId
		this.clearTimers()
		this.pendingCandidates.clear()
		this.closeTransport('对方已离开，等待重新连接', 'backoff')
		this.setState('backoff', '对方已离开，等待重新连接')
	}

	private pauseCurrent() {
		if (this.transport && this.attachedTransportId === this.transport.id) this.options.onPause(this.peer, this.transport.id)
	}

	private closeTransport(status: string, state: LanConnectionState) {
		const transport = this.transport
		if (!transport) return
		this.healthMonitor.stop()
		if (this.attachedTransportId === transport.id) this.options.onDetach(this.peer, transport.id, state, status)
		this.transport = null
		this.readyTransportId = ''
		this.attachedTransportId = ''
		transport.close()
	}

	private matchesCurrent(message: LanSignalMessage) {
		return message.generation === this.generation && message.negotiationId === this.negotiationId
	}

	private acceptNegotiationMessage(message: LanSignalMessage) {
		if (message.negotiationId !== this.negotiationId && message.seq < this.remoteNegotiationSeq) return false
		this.remoteNegotiationSeq = Math.max(this.remoteNegotiationSeq, message.seq)
		return true
	}

	private target(): LanSignalTarget {
		return { deviceId: this.peer.deviceId, instanceId: this.peer.instanceId }
	}

	private setState(state: LanConnectionState, status: string, connected = false) {
		const previous = this.state
		this.state = state
		this.log('connection-state', { previous, state, status, connected })
		this.options.onState(this.peer, state, status, connected)
	}

	private armAttempt(timeoutMs: number, callback: () => void, attempt = this.attemptEpoch) {
		this.clearAttempt()
		this.log('attempt-timeout-armed', { timeoutMs, state: this.state })
		this.attemptTimer = setTimeout(() => {
			this.attemptTimer = null
			if (attempt !== this.attemptEpoch) return
			if (visible()) {
				this.log('attempt-timeout-fired', { timeoutMs, state: this.state }, 'warn')
				callback()
			}
			else this.setState('backoff', '页面恢复后将继续连接')
		}, timeoutMs)
	}

	private beginAttempt() {
		this.invalidateAttempt()
		this.clearTimers()
		return this.attemptEpoch
	}

	private invalidateAttempt() {
		this.attemptEpoch += 1
	}

	private isCurrentAttempt(attempt: number, state?: LanConnectionState) {
		return !this.closed && attempt === this.attemptEpoch && (!state || this.state === state)
	}

	private resetRetryBudget() {
		this.backoffIndex = 0
		this.retryExhausted = false
	}

	private log(event: string, details: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
		logLanConnection('CONNECT', event, {
			role: this.options.role,
			peer: shortConnectionId(this.peer.deviceId),
			instance: shortConnectionId(this.peer.instanceId),
			generation: this.generation,
			negotiation: shortConnectionId(this.negotiationId),
			attemptEpoch: this.attemptEpoch,
			retryAttempt: this.backoffIndex,
			remotePresent: this.remotePresent,
			...details,
		}, level)
	}

	private clearAttempt() {
		if (this.attemptTimer) clearTimeout(this.attemptTimer)
		this.attemptTimer = null
	}

	private clearSuspect() {
		if (this.suspectTimer) clearTimeout(this.suspectTimer)
		this.suspectTimer = null
	}

	private clearBackoff() {
		if (this.backoffTimer) clearTimeout(this.backoffTimer)
		this.backoffTimer = null
	}

	private clearTimers() {
		this.clearAttempt()
		this.clearSuspect()
		this.clearBackoff()
		this.healthMonitor.stop()
	}
}
