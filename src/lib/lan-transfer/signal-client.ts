import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logLanConnection, shortConnectionId, summarizeIceCandidate } from './connection-diagnostics'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanPresencePayload, type LanSession, type LanSignalMessage, type LanSignalSendDetails, type LanSignalState, type LanSignalTarget, type LanSignalType } from './types'

const channelRetryMs = 500
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
let supabaseClient: SupabaseClient | null = null

type LanChannel = ReturnType<SupabaseClient['channel']>
type SignalHandler = (message: LanSignalMessage) => void
type PresenceHandler = (peers: LanPeer[]) => void

function getSupabase() {
	if (!supabaseUrl || !supabaseKey) throw new Error('连接服务未配置，暂不能使用')
	supabaseClient ||= createClient(supabaseUrl, supabaseKey, {
		auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
		realtime: { heartbeatIntervalMs: 15_000, worker: typeof Worker !== 'undefined' },
	})
	return supabaseClient
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object')
}

function isLanPeer(value: unknown): value is LanPeer {
	return isRecord(value)
		&& typeof value.instanceId === 'string'
		&& typeof value.deviceId === 'string'
		&& (value.role === 'host' || value.role === 'guest')
		&& typeof value.name === 'string'
		&& typeof value.deviceType === 'string'
		&& typeof value.avatarSeed === 'string'
		&& typeof value.startedAt === 'number'
}

function isPresencePayload(value: unknown): value is LanPresencePayload {
	return isRecord(value)
		&& value.protocolVersion === LAN_PROTOCOL_VERSION
		&& typeof value.instanceId === 'string'
		&& isLanPeer(value.peer)
		&& value.peer.instanceId === value.instanceId
}

function isSignalPayload(value: unknown): value is LanSignalMessage {
	if (!isRecord(value) || value.protocolVersion !== LAN_PROTOCOL_VERSION) return false
	if (value.type !== 'description' && value.type !== 'candidate' && value.type !== 'connect-request') return false
	const envelopeValid = typeof value.fromDeviceId === 'string'
		&& typeof value.fromInstanceId === 'string'
		&& typeof value.toDeviceId === 'string'
		&& typeof value.toInstanceId === 'string'
		&& typeof value.ts === 'number'
		&& typeof value.connectionId === 'string' && value.connectionId.length <= 128
		&& typeof value.exchangeId === 'string' && value.exchangeId.length <= 128
	if (!envelopeValid) return false
	if (value.type === 'connect-request') return ['connect', 'network', 'fresh', 'retry'].includes(value.reason as string)
	if (!value.connectionId || !value.exchangeId) return false
	if (value.type === 'description') return isRecord(value.description) && (value.description.type === 'offer' || value.description.type === 'answer')
	return value.candidate === null || isRecord(value.candidate)
}

export class LanSignalingClient {
	private channel: LanChannel | null = null
	private subscribed = false
	private closed = false
	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private removeWakeListeners: (() => void) | null = null
	private readySettled = false
	private lastWakeAt = -Infinity
	private resolveReady!: () => void
	readonly ready: Promise<void>

	constructor(
		private readonly session: LanSession,
		private readonly onMessage: SignalHandler,
		private readonly onStatus?: (status: LanSignalState) => void,
		private readonly onError?: (error: Error) => void,
		private readonly onWake?: () => void,
		private readonly onPresence?: PresenceHandler,
	) {
		this.ready = new Promise(resolve => {
			this.resolveReady = resolve
		})
		this.removeWakeListeners = this.bindWakeListeners()
		this.createChannel()
	}

	private createChannel() {
		if (this.closed || this.channel) return
		this.onStatus?.('connecting')
		this.log('channel-creating')
		let channel: LanChannel
		try {
			channel = getSupabase().channel(`lan-transfer:v14:${this.session.channelKey}`, {
				config: { broadcast: { ack: false, self: false }, presence: { key: this.session.localPeer.deviceId } },
			})
		} catch (error) {
			this.onError?.(error instanceof Error ? error : new Error('连接服务不可用'))
			this.onStatus?.('offline')
			return
		}
		this.channel = channel
		channel.on('broadcast', { event: 'signal' }, event => this.receive(event.payload))
		channel.on('presence', { event: 'sync' }, () => this.emitPresence())
		channel.on('presence', { event: 'join' }, () => this.emitPresence())
		channel.on('presence', { event: 'leave' }, () => this.emitPresence())
		channel.subscribe((status, error) => {
			if (this.closed || this.channel !== channel) return
			this.log('channel-status', { status, error: error?.message }, status === 'SUBSCRIBED' ? 'info' : 'warn')
			if (status === 'SUBSCRIBED') {
				this.subscribed = true
				this.onStatus?.('online')
				if (!this.readySettled) {
					this.readySettled = true
					this.resolveReady()
				}
				void this.track(channel)
				return
			}
			if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.recreateChannel(channel, error)
		})
	}

	private async track(channel: LanChannel) {
		try {
			const result = await channel.track(this.presencePayload())
			if (result !== 'ok') throw new Error('设备上线状态发布失败')
			if (!this.closed && this.channel === channel) this.emitPresence()
		} catch (error) {
			if (this.closed || this.channel !== channel) return
			this.onError?.(error instanceof Error ? error : new Error('连接服务恢复失败'))
			this.recreateChannel(channel)
		}
	}

	private recreateChannel(channel: LanChannel, error?: Error) {
		if (this.channel !== channel || this.closed) return
		this.channel = null
		this.subscribed = false
		this.onStatus?.('retrying')
		if (error) this.onError?.(error)
		void getSupabase().removeChannel(channel).catch(() => 'error')
		this.scheduleRetry()
	}

	private scheduleRetry() {
		if (this.closed || this.channel || this.retryTimer) return
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			this.createChannel()
		}, channelRetryMs)
	}

	private presencePayload(): LanPresencePayload {
		return { protocolVersion: LAN_PROTOCOL_VERSION, instanceId: this.session.instanceId, peer: this.session.localPeer }
	}

	private emitPresence() {
		const state = this.channel?.presenceState() as Record<string, unknown[]> | undefined
		if (!state) return
		const peers: LanPeer[] = []
		for (const entries of Object.values(state)) for (const entry of entries) {
			if (!isPresencePayload(entry) || entry.instanceId === this.session.instanceId) continue
			peers.push(entry.peer)
		}
		this.onPresence?.(peers)
	}

	private receive(payload: unknown) {
		if (!isSignalPayload(payload)) return
		if (payload.fromInstanceId === this.session.instanceId) return
		if (payload.toDeviceId !== this.session.localPeer.deviceId || payload.toInstanceId !== this.session.instanceId) return
		if (payload.type === 'candidate') this.log('candidate-received', { connection: shortConnectionId(payload.connectionId), exchange: shortConnectionId(payload.exchangeId), ...summarizeIceCandidate(payload.candidate || null) })
		else this.log(`${payload.type}-received`, { connection: shortConnectionId(payload.connectionId), exchange: shortConnectionId(payload.exchangeId), descriptionType: payload.description?.type, reason: payload.reason })
		this.onMessage(payload)
	}

	async sendSignal(type: LanSignalType, target: LanSignalTarget, details: LanSignalSendDetails) {
		if (this.closed) throw new Error('连接服务已关闭')
		const channel = this.channel
		if (!this.subscribed || !channel || channel.state !== 'joined' || !getSupabase().realtime.isConnected()) {
			if (channel) this.recreateChannel(channel)
			throw new Error('连接服务暂时离线')
		}
		const message: LanSignalMessage = {
			type,
			protocolVersion: LAN_PROTOCOL_VERSION,
			fromDeviceId: this.session.localPeer.deviceId,
			fromInstanceId: this.session.instanceId,
			toDeviceId: target.deviceId,
			toInstanceId: target.instanceId,
			ts: Date.now(),
			connectionId: details.connectionId,
			exchangeId: details.exchangeId,
			description: details.description,
			candidate: details.candidate,
			reason: details.reason,
		}
		try {
			const result = await channel.send({ type: 'broadcast', event: 'signal', payload: message })
			if (result !== 'ok') throw new Error('连接消息发送失败')
		} catch (error) {
			this.recreateChannel(channel)
			throw error
		}
	}

	wake() {
		if (this.closed || Date.now() - this.lastWakeAt < 500) return
		this.lastWakeAt = Date.now()
		const realtime = getSupabase().realtime
		if (!this.channel) this.scheduleRetry()
		if (!this.subscribed && !realtime.isConnected()) realtime.connect()
		if (this.subscribed && this.channel) void this.track(this.channel)
		this.onWake?.()
	}

	private bindWakeListeners() {
		if (typeof window === 'undefined') return null
		const wake = () => this.wake()
		const network = (navigator as Navigator & { connection?: EventTarget }).connection
		window.addEventListener('focus', wake)
		window.addEventListener('online', wake)
		window.addEventListener('pageshow', wake)
		network?.addEventListener('change', wake)
		const visibility = () => {
			if (document.visibilityState === 'visible') wake()
		}
		document.addEventListener('visibilitychange', visibility)
		return () => {
			window.removeEventListener('focus', wake)
			window.removeEventListener('online', wake)
			window.removeEventListener('pageshow', wake)
			network?.removeEventListener('change', wake)
			document.removeEventListener('visibilitychange', visibility)
		}
	}

	async close() {
		if (this.closed) return
		this.closed = true
		this.subscribed = false
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		this.removeWakeListeners?.()
		this.removeWakeListeners = null
		const channel = this.channel
		this.channel = null
		if (channel) {
			await channel.untrack().catch(() => {})
			await getSupabase().removeChannel(channel).catch(() => {})
		}
		if (!this.readySettled) {
			this.readySettled = true
			this.resolveReady()
		}
		this.onPresence?.([])
		this.onStatus?.('closed')
	}

	private log(event: string, details: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
		logLanConnection('SIGNAL', event, {
			role: this.session.role,
			instance: shortConnectionId(this.session.instanceId),
			...details,
		}, level)
	}
}
