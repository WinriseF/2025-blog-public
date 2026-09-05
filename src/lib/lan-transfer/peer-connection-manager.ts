import { logLanConnection, shortConnectionId } from './connection-diagnostics'
import type { LanConnectionRoute, LanReconnectTransport, LanTransportFactory, LanTransportState } from './transport-types'
import type { LanConnectReason, LanConnectionState, LanPeer, LanRole, LanSignalMessage, LanSignalSendDetails, LanSignalTarget, LanSignalType } from './types'

const naturalRecoveryMs = 2000
const iceRestartMs = 4500
const connectionAttemptMs = 7000
const backoffDelays = [0, 1000, 3000]
const unknownRoute: LanConnectionRoute = { family: 'unknown', kind: 'unknown' }
type Attempt = 'connect' | 'restart' | 'request'

export type PeerConnectionManagerOptions = {
	localRole: LanRole
	remotePeer: LanPeer
	createTransport: LanTransportFactory
	sendSignal: (type: LanSignalType, target: LanSignalTarget, details: LanSignalSendDetails) => Promise<void>
	onState: (peer: LanPeer, state: LanConnectionState, status: string, connected: boolean) => void
	onAttach: (peer: LanPeer, transport: LanReconnectTransport, route: LanConnectionRoute) => void
	onRoute: (peer: LanPeer, route: LanConnectionRoute) => void
	onPause: (peer: LanPeer, transportId: string) => void
	onResume: (peer: LanPeer, transportId: string) => void
	onDetach: (peer: LanPeer, transportId: string | null, state: LanConnectionState, status: string) => void
	onData: (peer: LanPeer, transportId: string, data: unknown) => void
}

function randomId() {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)
}

function retire(ids: Set<string>, id: string) {
	if (id) ids.add(id)
	if (ids.size > 32) ids.delete(ids.values().next().value as string)
}

export class PeerConnectionManager {
	private peer: LanPeer
	private transport: LanReconnectTransport | null = null
	private connectionId = ''
	private exchangeId = ''
	private attachedTransportId = ''
	private readyTransportId = ''
	private descriptionKey = ''
	private descriptionPending = false
	private signalingOnline = false
	private peerPresent = true
	private closed = false
	private paused = false
	private restartTried = false
	private retryIndex = 0
	private exhausted = false
	private operationToken = 0
	private recovery: LanConnectReason | null = null
	private forceRecovery = false
	private attempt: Attempt | null = null
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
	private retiredConnections = new Set<string>()
	private retiredExchanges = new Set<string>()
	private probingTransport: LanReconnectTransport | null = null
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
		if (peer.startedAt < this.peer.startedAt || peer.startedAt === this.peer.startedAt && peer.instanceId < this.peer.instanceId) return
		const replaced = peer.instanceId !== this.peer.instanceId
		if (replaced) {
			this.clearTimers()
			this.closeTransport('设备页面已更新，正在重新连接')
			this.pendingCandidates.clear()
			this.retiredConnections.clear()
			this.retiredExchanges.clear()
			this.connectionId = ''
			this.exchangeId = ''
			this.resetRetryBudget()
			this.restartTried = false
			this.recovery = null
			this.forceRecovery = false
		}
		this.peer = peer
		if (replaced) this.log('instance-replaced')
		this.setPeerPresent(peer, true)
	}

	setPeerPresent(peer: LanPeer, present: boolean) {
		if (this.closed || peer.deviceId !== this.peer.deviceId || peer.instanceId !== this.peer.instanceId) return
		const changed = this.peerPresent !== present
		this.peerPresent = present
		if (!present) {
			if (this.transport?.isOpen() && !this.recovery && !this.attempt) return void this.setState('connected', '直连正常，连接服务暂时未发现对方', true)
			if (changed) this.suspendRecovery('暂未发现对方，等待连接服务同步')
			return
		}
		this.continueConnection()
	}

	setSignalingOnline(online: boolean) {
		if (this.closed || this.signalingOnline === online) return
		this.signalingOnline = online
		if (!online) {
			this.suspendRecovery('连接服务正在恢复')
			return
		}
		this.continueConnection()
	}

	handleSignal(message: LanSignalMessage) {
		if (this.closed || message.fromDeviceId !== this.peer.deviceId || message.fromInstanceId !== this.peer.instanceId) return
		if (message.type === 'connect-request') return this.acceptConnectRequest(message)
		if (this.retiredConnections.has(message.connectionId) || this.retiredExchanges.has(message.exchangeId)) return
		if (message.type === 'candidate') return this.acceptCandidate(message)
		const description = message.description
		if (!description || (description.type === 'offer') !== (this.options.localRole === 'guest')) return
		if (description.type === 'offer' && message.connectionId !== this.connectionId) return this.acceptFreshOffer(message)
		if (!this.transport || message.connectionId !== this.connectionId) return
		if (message.exchangeId !== this.exchangeId) {
			if (description.type !== 'offer') return
			this.clearTimers()
			this.changeExchange(message.exchangeId)
			this.restartTried = true
			this.recovery = 'network'
			this.pauseCurrent()
			this.setState('reconnecting', '正在恢复网络路径')
			this.armAttempt('restart', iceRestartMs)
		}
		this.applyDescription(message)
	}

	wake() {
		if (this.closed || this.exhausted || this.attempt || this.recoveryTimer || this.backoffTimer || this.probingTransport) return
		const transport = this.transport
		if (!transport) return this.continueConnection()
		if (!transport.isOpen()) return this.enterRecovery('页面已恢复，正在检查网络路径')
		// A ping queued behind file data is not reliable evidence of a dead path.
		if (transport.bufferedAmount > 0) return
		const token = this.operationToken
		this.probingTransport = transport
		void transport.probe(1500).catch(() => false).then(alive => {
			if (!this.isCurrent(transport, token)) return
			if (alive) this.restoreConnected(transport)
			else this.enterRecovery('网络路径无响应，正在恢复', true, true)
		}).finally(() => {
			if (this.probingTransport === transport) this.probingTransport = null
		})
	}

	retry() {
		if (this.closed) return
		this.clearTimers()
		this.resetRetryBudget()
		this.closeTransport('正在重新连接')
		this.recovery = 'retry'
		this.continueConnection()
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.clearTimers()
		this.closeTransport('连接已关闭', 'offline')
		this.pendingCandidates.clear()
	}

	private suspendRecovery(status: string) {
		if (this.exhausted) return
		if (this.transport?.isOpen() && !this.recovery && !this.attempt) return
		this.recovery ||= this.attempt === 'connect' || !this.transport ? 'fresh' : 'network'
		this.clearTimers()
		this.pauseCurrent()
		this.setState('reconnecting', status)
	}

	private continueConnection() {
		if (this.closed || this.exhausted || this.attempt || this.recoveryTimer || this.backoffTimer) return
		const ready = this.transport?.isOpen() && this.readyTransportId === this.transport.id && !this.descriptionPending
		if (ready && !this.recovery) return this.restoreConnected(this.transport!)
		if (!this.signalingOnline || !this.peerPresent) return
		if (this.recovery === 'network' && ready && !this.forceRecovery) return this.restoreConnected(this.transport!)
		if (this.options.localRole === 'guest') return this.requestConnection()
		if (this.recovery === 'network' && this.transport) {
			if (this.restartTried) return this.failAttempt('网络路径未恢复，正在重建连接')
			return this.tryIceRestart()
		}
		this.startFreshConnection()
	}

	private requestConnection() {
		const reason = this.recovery || 'connect'
		this.setState(reason === 'connect' ? 'connecting' : 'reconnecting', reason === 'network' ? '正在请求恢复网络路径' : '等待房主建立直连')
		this.operationToken += 1
		this.armAttempt('request', connectionAttemptMs)
		const token = this.operationToken
		void this.options.sendSignal('connect-request', this.target(), { connectionId: this.connectionId, exchangeId: this.exchangeId, reason }).catch(() => {
			if (!this.closed && token === this.operationToken && this.attempt === 'request') this.failAttempt('连接请求发送失败')
		})
	}

	private acceptConnectRequest(message: LanSignalMessage) {
		if (this.options.localRole !== 'host' || !message.reason) return
		// Retired connection requests cannot replace a new PC.
		if (message.connectionId !== this.connectionId && !(message.reason === 'retry' && !this.transport)) return
		if (message.reason === 'network' && message.exchangeId !== this.exchangeId) return
		if (message.reason === 'connect' && this.transport) return
		if (message.reason === 'retry' && !this.attempt && !this.backoffTimer) this.resetRetryBudget()
		if (this.exhausted) return
		this.peerPresent = true
		if (message.reason === 'network') {
			this.enterRecovery('对方请求恢复网络路径', true, true)
			return
		}
		if (this.backoffTimer) return
		if (this.transport) this.failAttempt('对方请求重新建立直连')
		else this.continueConnection()
	}

	private startFreshConnection() {
		this.clearTimers()
		this.closeTransport('正在建立直连')
		this.connectionId = randomId()
		this.exchangeId = randomId()
		this.restartTried = false
		this.recovery = null
		this.forceRecovery = false
		this.descriptionPending = true
		this.operationToken += 1
		const token = this.operationToken
		const transport = this.createTransport('offerer')
		this.setState(this.retryIndex ? 'reconnecting' : 'connecting', '正在建立直连')
		this.armAttempt('connect', connectionAttemptMs)
		void transport.start(token).catch(() => {
			if (this.isCurrent(transport, token) && this.attempt) this.failAttempt('连接协商失败')
		})
	}

	private acceptFreshOffer(message: LanSignalMessage) {
		this.clearTimers()
		this.closeTransport('正在接受新连接')
		this.connectionId = message.connectionId
		this.exchangeId = message.exchangeId
		this.restartTried = false
		this.recovery = null
		this.forceRecovery = false
		this.descriptionPending = true
		this.operationToken += 1
		this.createTransport('answerer')
		this.setState('connecting', '正在建立直连')
		this.armAttempt('connect', connectionAttemptMs)
		this.applyDescription(message)
	}

	private applyDescription(message: LanSignalMessage) {
		const transport = this.transport!
		const key = message.connectionId + ':' + message.exchangeId + ':' + message.description!.type
		if (key === this.descriptionKey) return
		this.descriptionKey = key
		this.descriptionPending = true
		const token = this.operationToken
		this.drainCandidates(transport, message.connectionId, message.exchangeId)
		void transport.acceptDescription(message.description!, token).then(async () => {
			if (!this.isCurrent(transport, token)) return
			// A restart can negotiate while our side still reports connected.
			if (this.restartTried && transport.isOpen() && !await transport.probe(1500)) return
			if (!this.isCurrent(transport, token)) return
			this.descriptionPending = false
			this.restoreConnected(transport)
		}).catch(() => {
			if (this.isCurrent(transport, token) && this.attempt) this.failAttempt('连接协商失败')
		})
	}

	private createTransport(role: 'offerer' | 'answerer') {
		let transport!: LanReconnectTransport
		const connectionId = this.connectionId
		transport = this.options.createTransport({
			role,
			negotiationId: this.exchangeId,
			onDescription: (description, exchangeId, token) => {
				if (!this.isCurrent(transport, token) || exchangeId !== this.exchangeId) return
				void this.options.sendSignal('description', this.target(), { connectionId, exchangeId, description }).catch(() => {
					if (this.isCurrent(transport, token) && this.attempt) this.failAttempt('连接消息发送失败')
				})
			},
			onCandidate: candidate => {
				if (!candidate || this.transport !== transport) return
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
		this.drainCandidates(transport, connectionId, this.exchangeId)
		return transport
	}

	private handleTransportState(transport: LanReconnectTransport, state: LanTransportState) {
		if (this.closed || this.transport !== transport) return
		if (state === 'connected') return this.restoreConnected(transport)
		if (state === 'disconnected' || state === 'ice-failed') return this.enterRecovery('连接暂时中断，正在恢复', state === 'ice-failed')
		if (state === 'failed' || state === 'channel-closed' || state === 'closed') {
			this.closeTransport('连接已失效，正在重建')
			this.failAttempt('连接已失效，正在重建')
		}
	}

	private enterRecovery(status: string, immediate = false, force = false) {
		if (this.closed || this.exhausted || this.attempt || this.backoffTimer) return
		this.recovery ||= 'network'
		this.forceRecovery ||= force
		this.pauseCurrent()
		this.setState('reconnecting', status)
		if (!this.signalingOnline || !this.peerPresent) return
		if (immediate) {
			if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
			this.recoveryTimer = null
			this.continueConnection()
		} else if (!this.recoveryTimer) {
			this.recoveryTimer = setTimeout(() => {
				this.recoveryTimer = null
				this.continueConnection()
			}, naturalRecoveryMs)
		}
	}

	private tryIceRestart() {
		const transport = this.transport!
		this.restartTried = true
		this.changeExchange(randomId())
		this.descriptionPending = true
		this.setState('reconnecting', '正在恢复网络路径')
		this.armAttempt('restart', iceRestartMs)
		const token = this.operationToken
		void transport.restartIce(this.exchangeId, token).catch(() => {
			if (this.isCurrent(transport, token) && this.attempt) this.failAttempt('网络路径恢复失败')
		})
	}

	private changeExchange(exchangeId: string) {
		retire(this.retiredExchanges, this.exchangeId)
		this.exchangeId = exchangeId
		this.operationToken += 1
		this.descriptionKey = ''
		this.transport!.setNegotiationId(exchangeId)
	}

	private failAttempt(status: string) {
		if (this.closed) return
		this.clearTimers()
		this.recovery = this.recovery === 'retry' ? 'retry' : 'fresh'
		this.pauseCurrent()
		// Signaling/Presence outages suspend recovery without destroying a viable PC.
		if (!this.signalingOnline || !this.peerPresent) return void this.setState('reconnecting', '等待连接服务恢复')
		this.closeTransport(status)
		if (this.retryIndex >= backoffDelays.length) {
			this.exhausted = true
			this.setState('offline', '自动重连未成功，请立即重试或切换公网传输')
			return
		}
		const delay = backoffDelays[this.retryIndex++]
		this.setState('reconnecting', status)
		this.backoffTimer = setTimeout(() => {
			this.backoffTimer = null
			this.continueConnection()
		}, delay)
	}

	private restoreConnected(transport: LanReconnectTransport) {
		if (this.closed || this.transport !== transport || !transport.isOpen() || this.readyTransportId !== transport.id || this.descriptionPending) return
		const wasRecovering = Boolean(this.recovery)
		this.clearTimers()
		this.resetRetryBudget()
		this.restartTried = false
		this.recovery = null
		this.forceRecovery = false
		const firstAttach = this.attachedTransportId !== transport.id
		if (firstAttach) {
			this.attachedTransportId = transport.id
			this.options.onAttach(this.peer, transport, unknownRoute)
		} else if (this.paused) this.options.onResume(this.peer, transport.id)
		this.paused = false
		this.setState('connected', '已连接，可以发送消息和文件', true)
		if (!firstAttach && !wasRecovering) return
		const token = this.operationToken
		void transport.inspectRoute().then(route => {
			if (this.isCurrent(transport, token) && transport.isOpen() && !this.recovery) this.options.onRoute(this.peer, route)
		}).catch(() => {})
	}

	private acceptCandidate(message: LanSignalMessage) {
		if (!message.candidate) return
		if (this.transport && message.connectionId === this.connectionId && message.exchangeId === this.exchangeId) {
			void this.transport.addRemoteCandidate(message.candidate).catch(() => {})
			return
		}
		const key = message.connectionId + ':' + message.exchangeId
		const candidates = this.pendingCandidates.get(key) || []
		if (candidates.length < 128) candidates.push(message.candidate)
		this.pendingCandidates.set(key, candidates)
		if (this.pendingCandidates.size > 8) this.pendingCandidates.delete(this.pendingCandidates.keys().next().value as string)
	}

	private drainCandidates(transport: LanReconnectTransport, connectionId: string, exchangeId: string) {
		const key = connectionId + ':' + exchangeId
		const candidates = this.pendingCandidates.get(key) || []
		this.pendingCandidates.delete(key)
		for (const candidate of candidates) void transport.addRemoteCandidate(candidate).catch(() => {})
	}

	private pauseCurrent() {
		if (!this.paused && this.transport && this.attachedTransportId === this.transport.id) {
			this.paused = true
			this.options.onPause(this.peer, this.transport.id)
		}
	}

	private closeTransport(status: string, state: LanConnectionState = 'reconnecting') {
		const transport = this.transport
		if (!transport) return
		if (this.attachedTransportId === transport.id) this.options.onDetach(this.peer, transport.id, state, status)
		retire(this.retiredConnections, this.connectionId)
		this.transport = null
		this.readyTransportId = ''
		this.attachedTransportId = ''
		this.descriptionKey = ''
		this.descriptionPending = false
		this.paused = false
		this.probingTransport = null
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
		this.options.onState(this.peer, state, status, connected)
		this.log('connection-state', { state, status, connected })
	}

	private armAttempt(attempt: Attempt, ms: number) {
		if (this.attemptTimer) clearTimeout(this.attemptTimer)
		this.attempt = attempt
		this.attemptTimer = setTimeout(() => {
			this.attemptTimer = null
			this.failAttempt('连接恢复超时，稍后重试')
		}, ms)
	}

	private resetRetryBudget() {
		this.retryIndex = 0
		this.exhausted = false
	}

	private clearTimers() {
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
		if (this.attemptTimer) clearTimeout(this.attemptTimer)
		if (this.backoffTimer) clearTimeout(this.backoffTimer)
		this.recoveryTimer = null
		this.attemptTimer = null
		this.backoffTimer = null
		this.attempt = null
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
