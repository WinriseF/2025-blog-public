import type { LanReconnectTransport, LanTransportFactory, LanTransportState } from './transport-types'
import type { LanConnectionState, LanPeer, LanRole, LanSignalMessage, LanSignalSendDetails, LanSignalTarget, LanSignalType } from './types'

const suspectGraceMs = 4000
const resumeProbeMs = 3000
const iceRestartTimeoutMs = 8000
const rebuildTimeoutMs = 12000
const healthIntervalMs = 8000
const healthIdleMs = 10000
const backoffDelays = [0, 1000, 2000, 4000, 8000, 15000, 30000]

export type ReconnectCoordinatorOptions = {
	role: LanRole
	remotePeer: LanPeer
	createTransport: LanTransportFactory
	sendSignal: (type: LanSignalType, target: LanSignalTarget, details?: LanSignalSendDetails) => Promise<void>
	onState: (peer: LanPeer, state: LanConnectionState, status: string, connected: boolean) => void
	onAttach: (peer: LanPeer, transport: LanReconnectTransport, route: string) => void
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
	private closed = false
	private signalOnline = false
	private remoteClosedInstanceId = ''
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
	private attemptTimer: ReturnType<typeof setTimeout> | null = null
	private suspectTimer: ReturnType<typeof setTimeout> | null = null
	private backoffTimer: ReturnType<typeof setTimeout> | null = null
	private healthTimer: ReturnType<typeof setTimeout> | null = null

	constructor(private readonly options: ReconnectCoordinatorOptions) {
		this.peer = options.remotePeer
		this.setState('discovered', '找到设备，正在连接')
	}

	get remotePeer() {
		return this.peer
	}

	updatePeer(peer: LanPeer) {
		if (this.closed || peer.deviceId !== this.peer.deviceId) return
		const instanceChanged = peer.instanceId !== this.peer.instanceId
		if (!instanceChanged && peer.joinedAt < this.peer.joinedAt) return
		this.peer = peer
		if (instanceChanged) {
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
		this.recover(instanceChanged ? '设备页面已恢复' : '发现设备')
	}

	setSignalingOnline(online: boolean) {
		if (this.closed) return
		this.signalOnline = online
		if (online && !this.transport?.isOpen()) this.recover('连接服务已恢复')
	}

	handleSignal(message: LanSignalMessage) {
		if (this.closed || message.fromDeviceId !== this.peer.deviceId) return
		if (message.peer) this.updatePeerWithoutRecovery(message.peer)
		if (message.fromInstanceId !== this.peer.instanceId) return
		if (this.remoteClosedInstanceId === message.fromInstanceId && message.type !== 'peer-left') return
		if (this.options.role === 'guest' && (message.type === 'rebuild' || message.type === 'ice-restart' || message.type === 'offer') && !this.acceptNegotiationMessage(message)) return
		if (message.type === 'announce') return this.recover('设备在线')
		if (message.type === 'peer-left') return this.handleRemoteLeft()
		if (message.type === 'reconnect-request') {
			if (this.options.role === 'host' && !(this.state === 'connected' && message.generation < this.generation)) this.recover('对方请求恢复连接', true)
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
			if (this.options.role === 'guest' && message.description) void this.acceptOffer(message).catch(() => this.handleAttemptFailure())
			return
		}
		if (message.type === 'answer') {
			if (this.options.role === 'host' && this.matchesCurrent(message) && message.description) {
				this.remoteNegotiationSeq = Math.max(this.remoteNegotiationSeq, message.seq)
				void this.transport?.acceptDescription(message.description).catch(() => this.handleAttemptFailure())
			}
			return
		}
		if (message.type === 'candidate') this.acceptCandidate(message)
	}

	wake() {
		if (this.closed) return
		const transport = this.transport
		if (!transport?.isOpen()) return this.recover('页面已恢复')
		void transport.probe(resumeProbeMs).then(alive => {
			if (this.closed || this.transport !== transport) return
			if (alive) this.restoreConnected(transport)
			else this.enterSuspect('连接无响应，正在恢复', true)
		})
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.clearTimers()
		this.pendingCandidates.clear()
		this.closeTransport('连接已关闭', 'closed')
		this.setState('closed', '连接已关闭')
	}

	private updatePeerWithoutRecovery(peer: LanPeer) {
		if (peer.deviceId !== this.peer.deviceId || peer.joinedAt < this.peer.joinedAt) return
		if (peer.instanceId !== this.peer.instanceId) {
			this.peer = peer
			this.remoteClosedInstanceId = ''
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
		if (!this.signalOnline) return this.setState('backoff', '等待连接服务恢复')
		if (this.state === 'connecting' || this.state === 'rebuilding' || this.state === 'ice-restarting') return
		if (!force && this.transport?.isOpen()) return
		this.clearBackoff()
		if (this.options.role === 'host') {
			if (force && this.transport) void this.startIceRestart()
			else void this.startRebuild(reason)
			return
		}
		this.setState('connecting', '正在请求主机恢复连接')
		void this.options.sendSignal('reconnect-request', this.target(), { generation: this.generation, negotiationId: this.negotiationId, reason }).catch(() => this.scheduleBackoff())
		this.armAttempt(rebuildTimeoutMs, () => this.scheduleBackoff())
	}

	private async startRebuild(reason: string) {
		if (this.closed || !this.signalOnline) return this.scheduleBackoff()
		if (this.state === 'rebuilding') return
		this.clearAttempt()
		this.clearSuspect()
		this.closeTransport('正在重新建立连接', 'rebuilding')
		this.generation += 1
		this.negotiationId = randomId()
		this.setState('rebuilding', '正在重新建立连接')
		try {
			await this.options.sendSignal('rebuild', this.target(), { generation: this.generation, negotiationId: this.negotiationId, reason })
		} catch {
			return this.scheduleBackoff()
		}
		const transport = this.createTransport(this.generation, this.negotiationId)
		this.armAttempt(rebuildTimeoutMs, () => this.handleAttemptFailure())
		void transport.start().catch(() => this.handleAttemptFailure())
	}

	private acceptRebuild(message: LanSignalMessage) {
		if (message.generation < this.generation) return
		if (message.generation === this.generation && message.negotiationId === this.negotiationId && this.transport) return
		this.clearTimers()
		this.closeTransport('主机正在重新建立连接', 'rebuilding')
		this.generation = message.generation
		this.negotiationId = message.negotiationId
		this.setState('rebuilding', '主机正在重新建立连接')
		this.createTransport(this.generation, this.negotiationId)
		this.armAttempt(rebuildTimeoutMs, () => this.scheduleBackoff())
	}

	private async startIceRestart() {
		const transport = this.transport
		if (this.closed || !transport || !this.signalOnline) return void this.startRebuild('连接需要重建')
		if (this.state === 'ice-restarting' || this.state === 'rebuilding') return
		this.clearAttempt()
		this.clearSuspect()
		this.negotiationId = randomId()
		transport.setNegotiationId(this.negotiationId)
		this.detachCurrent('正在恢复网络路径', 'ice-restarting')
		this.setState('ice-restarting', '正在恢复网络路径')
		try {
			await this.options.sendSignal('ice-restart', this.target(), { generation: this.generation, negotiationId: this.negotiationId })
		} catch {
			return this.scheduleBackoff()
		}
		this.armAttempt(iceRestartTimeoutMs, () => void this.startRebuild('网络路径恢复超时'))
		void transport.restartIce(this.negotiationId).catch(() => void this.startRebuild('网络路径恢复失败'))
	}

	private acceptIceRestart(message: LanSignalMessage) {
		if (message.generation !== this.generation || !this.transport) return
		this.clearTimers()
		this.negotiationId = message.negotiationId
		this.transport.setNegotiationId(message.negotiationId)
		this.drainCandidates(this.transport, this.generation, this.negotiationId)
		this.detachCurrent('主机正在恢复网络路径', 'ice-restarting')
		this.setState('ice-restarting', '主机正在恢复网络路径')
		this.armAttempt(iceRestartTimeoutMs, () => this.handleAttemptFailure())
	}

	private async acceptOffer(message: LanSignalMessage) {
		if (message.generation < this.generation || !message.description) return
		this.clearBackoff()
		if (!this.transport || message.generation > this.generation) {
			this.clearAttempt()
			this.clearSuspect()
			this.closeTransport('正在接受新连接', 'rebuilding')
			this.generation = message.generation
			this.negotiationId = message.negotiationId
			this.setState('rebuilding', '正在接受新连接')
			this.createTransport(this.generation, this.negotiationId)
			this.armAttempt(rebuildTimeoutMs, () => this.scheduleBackoff())
		} else if (message.negotiationId !== this.negotiationId) {
			this.clearAttempt()
			this.clearSuspect()
			this.negotiationId = message.negotiationId
			this.transport.setNegotiationId(message.negotiationId)
			this.drainCandidates(this.transport, this.generation, this.negotiationId)
			this.detachCurrent('主机正在恢复网络路径', 'ice-restarting')
			this.setState('ice-restarting', '主机正在恢复网络路径')
			this.armAttempt(iceRestartTimeoutMs, () => this.handleAttemptFailure())
		}
		await this.transport?.acceptDescription(message.description)
	}

	private createTransport(generation: number, negotiationId: string) {
		let transport!: LanReconnectTransport
		transport = this.options.createTransport({
			role: this.options.role,
			generation,
			negotiationId,
			onDescription: description => {
				if (this.transport !== transport) return
				const type = description.type === 'offer' ? 'offer' : 'answer'
				void this.options.sendSignal(type, this.target(), { generation, negotiationId: transport.negotiationId, description }).catch(() => this.handleAttemptFailure())
			},
			onCandidate: candidate => {
				if (this.transport === transport) void this.options.sendSignal('candidate', this.target(), { generation, negotiationId: transport.negotiationId, candidate }).catch(() => {})
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
		if (!message.candidate || message.generation < this.generation || message.generation > this.generation + 1) return
		if (message.negotiationId !== this.negotiationId && message.seq < this.remoteNegotiationSeq) return
		if (this.matchesCurrent(message) && this.transport) {
			void this.transport.addRemoteCandidate(message.candidate).catch(() => {})
			return
		}
		const key = `${message.generation}:${message.negotiationId}`
		if (!this.pendingCandidates.has(key) && this.pendingCandidates.size >= 8) this.pendingCandidates.delete(this.pendingCandidates.keys().next().value as string)
		const candidates = this.pendingCandidates.get(key) || []
		if (candidates.length >= 128) return
		candidates.push(message.candidate)
		this.pendingCandidates.set(key, candidates)
	}

	private drainCandidates(transport: LanReconnectTransport, generation: number, negotiationId: string) {
		const key = `${generation}:${negotiationId}`
		const candidates = this.pendingCandidates.get(key) || []
		this.pendingCandidates.delete(key)
		for (const candidate of candidates) void transport.addRemoteCandidate(candidate).catch(() => {})
		for (const pendingKey of this.pendingCandidates.keys()) {
			const pendingGeneration = Number(pendingKey.slice(0, pendingKey.indexOf(':')))
			if (pendingGeneration < generation) this.pendingCandidates.delete(pendingKey)
		}
	}

	private handleTransportState(transport: LanReconnectTransport, state: LanTransportState) {
		if (this.closed || this.transport !== transport) return
		if (state === 'connected') {
			if (this.readyTransportId === transport.id) this.restoreConnected(transport)
			return
		}
		if (state === 'disconnected') return this.enterSuspect('连接暂时中断，等待恢复')
		if (state === 'failed') {
			this.detachCurrent('连接失败，正在恢复', 'suspect')
			if (this.options.role === 'host') void this.startIceRestart()
			else this.recover('连接失败', true)
		}
	}

	private restoreConnected(transport: LanReconnectTransport) {
		if (this.closed || this.transport !== transport || !transport.isOpen()) return
		this.clearTimers()
		this.backoffIndex = 0
		if (this.attachedTransportId === transport.id) {
			this.setState('connected', '已连接，可以发送消息和文件', true)
			return this.scheduleHealthCheck()
		}
		this.setState('connected', '正在确认连接线路')
		void transport.inspectRoute().then(route => {
			if (this.closed || this.transport !== transport || !transport.isOpen()) return
			this.attachedTransportId = transport.id
			this.options.onAttach(this.peer, transport, route)
			this.setState('connected', '已连接，可以发送消息和文件', true)
			this.scheduleHealthCheck()
		}).catch(() => this.handleAttemptFailure())
	}

	private enterSuspect(status: string, immediate = false) {
		if (this.closed || this.state === 'suspect' || this.state === 'ice-restarting' || this.state === 'rebuilding') return
		this.detachCurrent(status, 'suspect')
		this.setState('suspect', status)
		this.clearSuspect()
		this.suspectTimer = setTimeout(() => {
			this.suspectTimer = null
			if (this.options.role === 'host') void this.startIceRestart()
			else this.recover('连接没有自然恢复', true)
		}, immediate ? 0 : suspectGraceMs)
	}

	private scheduleHealthCheck() {
		if (this.healthTimer) clearTimeout(this.healthTimer)
		this.healthTimer = setTimeout(() => {
			this.healthTimer = null
			const transport = this.transport
			if (this.closed || !transport || !visible()) return this.scheduleHealthCheck()
			if (Date.now() - transport.lastInboundAt < healthIdleMs) return this.scheduleHealthCheck()
			void transport.probe(resumeProbeMs).then(alive => {
				if (this.transport !== transport || this.closed) return
				if (alive) this.scheduleHealthCheck()
				else this.enterSuspect('连接无响应，正在恢复')
			})
		}, healthIntervalMs)
	}

	private handleAttemptFailure() {
		if (this.closed) return
		if (this.state === 'ice-restarting' && this.options.role === 'host') return void this.startRebuild('网络路径恢复失败')
		this.closeTransport('连接失败，稍后重试', 'backoff')
		this.scheduleBackoff()
	}

	private scheduleBackoff() {
		if (this.closed) return
		this.clearAttempt()
		this.setState('backoff', '连接失败，稍后自动重试')
		if (!visible()) return
		const delay = backoffDelays[Math.min(this.backoffIndex, backoffDelays.length - 1)]
		this.backoffIndex += 1
		this.clearBackoff()
		this.backoffTimer = setTimeout(() => {
			this.backoffTimer = null
			this.recover('自动重试', true)
		}, delay)
	}

	private handleRemoteLeft() {
		this.remoteClosedInstanceId = this.peer.instanceId
		this.clearTimers()
		this.pendingCandidates.clear()
		this.closeTransport('对方已离开，等待重新连接', 'backoff')
		this.setState('backoff', '对方已离开，等待重新连接')
	}

	private detachCurrent(status: string, state: LanConnectionState) {
		if (!this.transport || this.attachedTransportId !== this.transport.id) return
		this.options.onDetach(this.peer, this.transport.id, state, status)
		this.attachedTransportId = ''
	}

	private closeTransport(status: string, state: LanConnectionState) {
		const transport = this.transport
		if (!transport) return
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
		this.state = state
		this.options.onState(this.peer, state, status, connected)
	}

	private armAttempt(timeoutMs: number, callback: () => void) {
		this.clearAttempt()
		this.attemptTimer = setTimeout(() => {
			this.attemptTimer = null
			if (visible()) callback()
			else this.setState('backoff', '页面恢复后将继续连接')
		}, timeoutMs)
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
		if (this.healthTimer) clearTimeout(this.healthTimer)
		this.healthTimer = null
	}
}
