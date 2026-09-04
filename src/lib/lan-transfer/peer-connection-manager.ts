import { logLanConnection, shortConnectionId } from './connection-diagnostics'
import type { LanConnectionRoute, LanReconnectTransport, LanTransportFactory, LanTransportState } from './transport-types'
import type { LanConnectionState, LanPeer, LanSignalMessage, LanSignalSendDetails, LanSignalTarget, LanSignalType } from './types'

const naturalRecoveryMs = 2000
const iceRestartMs = 4500
const connectionAttemptMs = 7000
const followerFallbackMs = 7000
const backoffDelays = [0, 1000, 3000]

export type PeerConnectionManagerOptions = {
	localDeviceId: string
	remotePeer: LanPeer
	createTransport: LanTransportFactory
	sendSignal: (type: LanSignalType, target: LanSignalTarget, details: LanSignalSendDetails) => Promise<void>
	onState: (peer: LanPeer, state: LanConnectionState, status: string, connected: boolean) => void
	onAttach: (peer: LanPeer, transport: LanReconnectTransport, route: LanConnectionRoute) => void
	onPause: (peer: LanPeer, transportId: string) => void
	onResume: (peer: LanPeer, transportId: string) => void
	onDetach: (peer: LanPeer, transportId: string | null, state: LanConnectionState, status: string) => void
	onData: (peer: LanPeer, transportId: string, data: unknown) => void
}

function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class PeerConnectionManager {
	private peer: LanPeer
	private transport: LanReconnectTransport | null = null
	private connectionId = ''
	private exchangeId = ''
	private connectionInitiatorId = ''
	private state: LanConnectionState = 'connecting'
	private attachedTransportId = ''
	private readyTransportId = ''
	private signalingOnline = false
	private peerPresent = true
	private closed = false
	private restartTried = false
	private retryIndex = 0
	private operationToken = 0
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
	private recoveryTimer: ReturnType<typeof setTimeout> | null = null
	private attemptTimer: ReturnType<typeof setTimeout> | null = null
	private backoffTimer: ReturnType<typeof setTimeout> | null = null

	constructor(private readonly options: PeerConnectionManagerOptions) {
		this.peer = options.remotePeer
		this.setState('connecting', '找到设备，正在连接')
	}

	get remotePeer() {
		return this.peer
	}

	updatePeer(peer: LanPeer) {
		if (this.closed || peer.deviceId !== this.peer.deviceId) return
		if (peer.instanceId === this.peer.instanceId && peer.startedAt < this.peer.startedAt) return
		const replaced = peer.instanceId !== this.peer.instanceId
		this.peer = peer
		this.peerPresent = true
		if (replaced) {
			this.log('instance-replaced', { nextInstance: shortConnectionId(peer.instanceId) })
			this.resetRecovery()
			this.pendingCandidates.clear()
			this.closeTransport('设备页面已更新，正在重新连接', 'reconnecting')
			this.setState('connecting', '设备页面已更新，正在重新连接')
		}
		this.connectIfLeader()
	}

	setPeerPresent(peer: LanPeer, present: boolean) {
		if (this.closed || peer.deviceId !== this.peer.deviceId || peer.instanceId !== this.peer.instanceId) return
		this.peerPresent = present
		if (present) {
			this.resetRetryBudget()
			if (this.transport?.isOpen()) return this.restoreConnected(this.transport)
			this.connectIfLeader()
			return
		}
		if (this.transport?.isOpen()) {
			this.setState('connected', '直连正常，连接服务暂时未发现对方', true)
			return
		}
		this.clearTimers()
		this.closeTransport('对方暂时离线', 'offline')
		this.setState('offline', '对方暂时离线')
	}

	setSignalingOnline(online: boolean) {
		if (this.closed) return
		this.signalingOnline = online
		if (!online) {
			if (!this.transport?.isOpen()) this.setState('reconnecting', '连接服务正在恢复')
			return
		}
		this.resetRetryBudget()
		if (this.transport?.isOpen()) return this.restoreConnected(this.transport)
		this.connectIfLeader()
	}

	handleSignal(message: LanSignalMessage) {
		if (this.closed || message.fromDeviceId !== this.peer.deviceId || message.fromInstanceId !== this.peer.instanceId) return
		if (message.type === 'candidate') return this.acceptCandidate(message)
		if (!message.description) return
		if (message.description.type === 'offer' && message.connectionId !== this.connectionId) {
			if (!this.shouldAcceptConnection(message)) return
			return void this.acceptFreshOffer(message)
		}
		if (!this.transport || message.connectionId !== this.connectionId) return
		const transport = this.transport
		if (message.exchangeId !== this.exchangeId) {
			if (message.description.type !== 'offer') return
			this.exchangeId = message.exchangeId
			transport.setNegotiationId(message.exchangeId)
			this.restartTried = true
			this.pauseCurrent()
			this.setState('reconnecting', '正在恢复网络路径')
			this.drainCandidates(transport, message.connectionId, message.exchangeId)
			this.armAttempt(iceRestartMs, () => this.replaceTransport('网络路径恢复超时'))
		}
		const token = this.operationToken
		void transport.acceptDescription(message.description, token).catch(() => {
			if (this.transport === transport && token === this.operationToken) this.replaceTransport('连接协商失败')
		})
	}

	wake() {
		if (this.closed) return
		const transport = this.transport
		if (!transport) return this.connectIfLeader()
		if (!transport.isOpen()) return this.replaceTransport('页面恢复，正在重建连接')
		void transport.probe(1500).then(alive => {
			if (this.closed || this.transport !== transport) return
			if (alive) this.restoreConnected(transport)
			else this.enterRecovery('网络路径无响应，正在恢复', true, true)
		}).catch(() => this.enterRecovery('网络路径无响应，正在恢复', true, true))
	}

	retry() {
		if (this.closed || !this.peerPresent) return
		this.resetRetryBudget()
		this.closeTransport('正在重新连接', 'reconnecting')
		this.startFreshConnection()
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.operationToken += 1
		this.clearTimers()
		this.pendingCandidates.clear()
		this.closeTransport('连接已关闭', 'offline')
	}

	private isLeader() {
		return this.options.localDeviceId.localeCompare(this.peer.deviceId) < 0
	}

	private leaderDeviceId() {
		return this.isLeader() ? this.options.localDeviceId : this.peer.deviceId
	}

	private connectIfLeader() {
		if (this.closed || this.transport || !this.peerPresent || !this.signalingOnline) return
		if (this.isLeader()) this.startFreshConnection()
		else this.setState('connecting', '等待对方建立直连')
	}

	private startFreshConnection() {
		if (this.closed || !this.peerPresent) return
		if (!this.signalingOnline) return void this.setState('reconnecting', '等待连接服务恢复')
		this.clearTimers()
		this.closeTransport('正在建立直连', 'reconnecting')
		this.connectionId = randomId()
		this.exchangeId = randomId()
		this.connectionInitiatorId = this.options.localDeviceId
		this.restartTried = false
		this.operationToken += 1
		const token = this.operationToken
		const transport = this.createTransport('offerer')
		this.setState(this.retryIndex ? 'reconnecting' : 'connecting', '正在建立直连')
		this.armAttempt(connectionAttemptMs, () => this.handleAttemptFailure(transport))
		void transport.start(token).catch(() => this.handleAttemptFailure(transport))
	}

	private async acceptFreshOffer(message: LanSignalMessage) {
		this.clearTimers()
		this.closeTransport('正在接受新连接', 'reconnecting')
		this.connectionId = message.connectionId
		this.exchangeId = message.exchangeId
		this.connectionInitiatorId = message.fromDeviceId
		this.restartTried = false
		this.operationToken += 1
		const token = this.operationToken
		const transport = this.createTransport('answerer')
		this.setState('connecting', '正在建立直连')
		this.drainCandidates(transport, message.connectionId, message.exchangeId)
		this.armAttempt(connectionAttemptMs, () => this.handleAttemptFailure(transport))
		try {
			await transport.acceptDescription(message.description!, token)
		} catch {
			this.handleAttemptFailure(transport)
		}
	}

	private shouldAcceptConnection(message: LanSignalMessage) {
		if (!this.transport || this.state === 'connected') return true
		const leader = this.leaderDeviceId()
		const incomingPreferred = message.fromDeviceId === leader
		const currentPreferred = this.connectionInitiatorId === leader
		if (incomingPreferred !== currentPreferred) return incomingPreferred
		return message.connectionId > this.connectionId
	}

	private createTransport(role: 'offerer' | 'answerer') {
		let transport!: LanReconnectTransport
		const connectionId = this.connectionId
		transport = this.options.createTransport({
			role,
			negotiationId: this.exchangeId,
			onDescription: (description, exchangeId, token) => {
				if (!this.isCurrent(transport, token) || connectionId !== this.connectionId || exchangeId !== this.exchangeId) return
				void this.options.sendSignal('description', this.target(), { connectionId, exchangeId, description }).catch(() => this.handleAttemptFailure(transport))
			},
			onCandidate: candidate => {
				if (!candidate || this.transport !== transport || connectionId !== this.connectionId) return
				void this.options.sendSignal('candidate', this.target(), { connectionId, exchangeId: transport.negotiationId, candidate }).catch(() => {})
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
		this.drainCandidates(transport, connectionId, this.exchangeId)
		return transport
	}

	private handleTransportState(transport: LanReconnectTransport, state: LanTransportState) {
		if (this.closed || this.transport !== transport) return
		if (state === 'connected') return this.restoreConnected(transport)
		if (state === 'disconnected') return this.enterRecovery('连接暂时中断，等待恢复')
		if (state === 'failed' || state === 'channel-closed') return this.replaceTransport('连接已失效，正在重建')
	}

	private enterRecovery(status: string, immediate = false, force = false) {
		if (this.closed || this.state === 'reconnecting' && this.recoveryTimer) return
		this.clearRecoveryTimer()
		this.pauseCurrent()
		this.setState('reconnecting', status)
		const recover = () => {
			this.recoveryTimer = null
			if (this.closed || (!force && this.transport?.isOpen())) return this.transport && this.restoreConnected(this.transport)
			if (!this.isLeader()) {
				this.recoveryTimer = setTimeout(() => {
					this.recoveryTimer = null
					if (!this.closed && !this.transport?.isOpen()) this.startFreshConnection()
				}, followerFallbackMs)
				return
			}
			this.tryIceRestart()
		}
		if (immediate) recover()
		else this.recoveryTimer = setTimeout(recover, naturalRecoveryMs)
	}

	private tryIceRestart() {
		const transport = this.transport
		if (!transport || this.restartTried || !this.signalingOnline) return this.replaceTransport('正在重新建立连接')
		this.restartTried = true
		this.exchangeId = randomId()
		this.operationToken += 1
		const token = this.operationToken
		transport.setNegotiationId(this.exchangeId)
		this.setState('reconnecting', '正在恢复网络路径')
		this.armAttempt(iceRestartMs, () => this.replaceTransport('网络路径恢复超时'))
		void transport.restartIce(this.exchangeId, token).catch(() => this.replaceTransport('网络路径恢复失败'))
	}

	private replaceTransport(status: string) {
		if (this.closed) return
		this.clearTimers()
		this.closeTransport(status, 'reconnecting')
		if (!this.peerPresent) return void this.setState('offline', '对方暂时离线')
		if (this.isLeader()) this.startFreshConnection()
		else this.setState('reconnecting', '等待对方重新建立直连')
	}

	private handleAttemptFailure(transport: LanReconnectTransport) {
		if (this.closed || this.transport !== transport) return
		this.closeTransport('连接失败，稍后重试', 'reconnecting')
		this.scheduleBackoff()
	}

	private scheduleBackoff() {
		if (this.closed || !this.peerPresent) return
		if (this.retryIndex >= backoffDelays.length) return void this.setState('offline', '自动重连未成功，请立即重试或切换公网传输')
		const delay = backoffDelays[this.retryIndex++]
		this.setState('reconnecting', '连接失败，稍后自动重试')
		this.backoffTimer = setTimeout(() => {
			this.backoffTimer = null
			this.startFreshConnection()
		}, delay)
	}

	private restoreConnected(transport: LanReconnectTransport) {
		if (this.closed || this.transport !== transport || !transport.isOpen()) return
		this.clearTimers()
		this.resetRetryBudget()
		if (this.attachedTransportId === transport.id) {
			this.options.onResume(this.peer, transport.id)
			this.setState('connected', '已连接，可以发送消息和文件', true)
			return
		}
		if (this.readyTransportId !== transport.id) return
		void transport.inspectRoute().catch((): LanConnectionRoute => ({ family: 'unknown', kind: 'unknown' })).then(route => {
			if (this.closed || this.transport !== transport || !transport.isOpen()) return
			this.attachedTransportId = transport.id
			this.options.onAttach(this.peer, transport, route)
			this.setState('connected', '已连接，可以发送消息和文件', true)
		})
	}

	private acceptCandidate(message: LanSignalMessage) {
		if (!message.candidate) return
		if (this.transport && message.connectionId === this.connectionId && message.exchangeId === this.exchangeId) {
			void this.transport.addRemoteCandidate(message.candidate).catch(() => {})
			return
		}
		const key = this.candidateKey(message.connectionId, message.exchangeId)
		const candidates = this.pendingCandidates.get(key) || []
		if (candidates.length < 128) candidates.push(message.candidate)
		this.pendingCandidates.set(key, candidates)
		if (this.pendingCandidates.size > 8) this.pendingCandidates.delete(this.pendingCandidates.keys().next().value as string)
	}

	private drainCandidates(transport: LanReconnectTransport, connectionId: string, exchangeId: string) {
		const key = this.candidateKey(connectionId, exchangeId)
		const candidates = this.pendingCandidates.get(key) || []
		this.pendingCandidates.delete(key)
		for (const candidate of candidates) void transport.addRemoteCandidate(candidate).catch(() => {})
	}

	private candidateKey(connectionId: string, exchangeId: string) {
		return `${connectionId}:${exchangeId}`
	}

	private pauseCurrent() {
		if (this.transport && this.attachedTransportId === this.transport.id) this.options.onPause(this.peer, this.transport.id)
	}

	private closeTransport(status: string, state: LanConnectionState) {
		const transport = this.transport
		if (!transport) return
		if (this.attachedTransportId === transport.id) this.options.onDetach(this.peer, transport.id, state, status)
		this.transport = null
		this.readyTransportId = ''
		this.attachedTransportId = ''
		this.operationToken += 1
		transport.close()
	}

	private target(): LanSignalTarget {
		return { deviceId: this.peer.deviceId, instanceId: this.peer.instanceId }
	}

	private isCurrent(transport: LanReconnectTransport, token: number) {
		return !this.closed && this.transport === transport && token === this.operationToken
	}

	private setState(state: LanConnectionState, status: string, connected = false) {
		this.state = state
		this.options.onState(this.peer, state, status, connected)
		this.log('connection-state', { state, status, connected })
	}

	private armAttempt(ms: number, callback: () => void) {
		if (this.attemptTimer) clearTimeout(this.attemptTimer)
		this.attemptTimer = setTimeout(() => {
			this.attemptTimer = null
			callback()
		}, ms)
	}

	private resetRecovery() {
		this.operationToken += 1
		this.clearTimers()
		this.resetRetryBudget()
		this.restartTried = false
	}

	private resetRetryBudget() {
		this.retryIndex = 0
	}

	private clearRecoveryTimer() {
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
		this.recoveryTimer = null
	}

	private clearTimers() {
		this.clearRecoveryTimer()
		if (this.attemptTimer) clearTimeout(this.attemptTimer)
		if (this.backoffTimer) clearTimeout(this.backoffTimer)
		this.attemptTimer = null
		this.backoffTimer = null
	}

	private log(event: string, details: Record<string, unknown> = {}) {
		logLanConnection('CONNECT', event, {
			peer: shortConnectionId(this.peer.deviceId),
			instance: shortConnectionId(this.peer.instanceId),
			connection: shortConnectionId(this.connectionId),
			exchange: shortConnectionId(this.exchangeId),
			...details,
		})
	}
}
