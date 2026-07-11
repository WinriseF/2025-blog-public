import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adjectives, uniqueNamesGenerator } from 'unique-names-generator'
import { LAN_PROTOCOL_VERSION, type LanDeviceType, type LanPeer, type LanPresencePayload, type LanRole, type LanSession, type LanSignalMessage, type LanSignalSendDetails, type LanSignalState, type LanSignalTarget, type LanSignalType } from './types'

const pairTtlMs = 10 * 60 * 1000
const sessionTtlMs = 30 * 60 * 1000
const announceFastIntervalMs = 1000
const announceSlowIntervalMs = 5000
const announceFastWindowMs = 30 * 1000
const channelWatchdogMs = 15 * 1000
const signalAckRetryMs = 1200
const signalAckAttempts = 4
const seenMessageTtlMs = 60 * 1000
const criticalSignalTypes = new Set<LanSignalType>(['reconnect-request', 'rebuild', 'ice-restart', 'offer', 'answer'])
const signalTypes = new Set<LanSignalType>(['announce', 'reconnect-request', 'rebuild', 'ice-restart', 'offer', 'answer', 'candidate', 'signal-ack', 'peer-left'])
const deviceNameStorageKey = 'winrisef-lan-device-name-v1'
const deviceAvatarStorageKey = 'winrisef-lan-device-avatar-v1'
const deviceIdStorageKey = 'winrisef-lan-device-id-v1'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
let supabaseClient: SupabaseClient | null = null

type LanChannel = ReturnType<SupabaseClient['channel']>
type SignalHandler = (message: LanSignalMessage) => void
type PendingSignal = { message: LanSignalMessage; attempts: number; timer: ReturnType<typeof setTimeout> | null }

function getSupabase() {
	if (!supabaseUrl || !supabaseKey) throw new Error('连接服务未配置，暂不能使用')
	supabaseClient ||= createClient(supabaseUrl, supabaseKey, {
		auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
	})
	return supabaseClient
}

function randomBytes(size: number) {
	if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('当前浏览器不支持创建连接')
	const bytes = new Uint8Array(size)
	crypto.getRandomValues(bytes)
	return bytes
}

function base64url(bytes: Uint8Array) {
	let value = ''
	for (const byte of bytes) value += String.fromCharCode(byte)
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Base64url(value: string) {
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
	return base64url(bytes)
}

function createId(bytes = 12) {
	return base64url(randomBytes(bytes))
}

function createShortCode() {
	return createId(3).replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()
}

function deviceLabel(type: LanDeviceType) {
	if (type === 'desktop') return 'Desktop'
	if (type === 'phone') return 'Phone'
	if (type === 'tablet') return 'Tablet'
	return 'Device'
}

function createFriendlyDeviceName(type: LanDeviceType) {
	const word = uniqueNamesGenerator({ dictionaries: [adjectives], length: 1, style: 'capital' })
	return `${word} ${deviceLabel(type)} ${createShortCode()}`
}

function readOrCreate(storageKey: string, create: () => string) {
	try {
		if (typeof localStorage === 'undefined') return create()
		const current = localStorage.getItem(storageKey)
		if (current) return current
		const next = create()
		localStorage.setItem(storageKey, next)
		return next
	} catch {
		return create()
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object')
}

function isLanPeer(value: unknown): value is LanPeer {
	return isRecord(value) && typeof value.instanceId === 'string' && typeof value.deviceId === 'string' && (value.role === 'host' || value.role === 'guest') && typeof value.name === 'string' && typeof value.deviceType === 'string' && typeof value.avatarSeed === 'string' && typeof value.joinedAt === 'number'
}

function isPresencePayload(value: unknown): value is LanPresencePayload {
	return isRecord(value) && typeof value.instanceId === 'string' && (value.role === 'host' || value.role === 'guest') && isLanPeer(value.peer) && value.peer.instanceId === value.instanceId && value.peer.role === value.role && typeof value.tokenHash === 'string' && typeof value.joinedAt === 'number'
}

function isSignalPayload(value: unknown): value is LanSignalMessage {
	if (!isRecord(value) || !signalTypes.has(value.type as LanSignalType)) return false
	const peerValid = !('peer' in value) || value.peer === undefined || isLanPeer(value.peer) && value.peer.deviceId === value.fromDeviceId && value.peer.instanceId === value.fromInstanceId
	return value.protocolVersion === LAN_PROTOCOL_VERSION && typeof value.roomId === 'string' && typeof value.tokenHash === 'string' && typeof value.fromDeviceId === 'string' && typeof value.fromInstanceId === 'string' && typeof value.toDeviceId === 'string' && typeof value.toInstanceId === 'string' && typeof value.messageId === 'string' && typeof value.seq === 'number' && typeof value.ts === 'number' && typeof value.generation === 'number' && typeof value.negotiationId === 'string' && peerValid
}

export function getLocalDevice() {
	if (typeof navigator === 'undefined') return { deviceId: 'browser-device', peerName: 'Browser Device', deviceType: 'unknown' as LanDeviceType, avatarSeed: 'browser-device' }
	const ua = navigator.userAgent.toLowerCase()
	const deviceType: LanDeviceType = /ipad|tablet/.test(ua) ? 'tablet' : /iphone|android|mobile/.test(ua) ? 'phone' : 'desktop'
	return {
		deviceId: readOrCreate(deviceIdStorageKey, () => `device-${createId(12)}`),
		peerName: readOrCreate(deviceNameStorageKey, () => createFriendlyDeviceName(deviceType)),
		deviceType,
		avatarSeed: readOrCreate(deviceAvatarStorageKey, () => `lan-${createId(9)}`),
	}
}

async function createSession(role: LanRole, roomId: string, token: string, device = getLocalDevice()): Promise<LanSession> {
	const now = Date.now()
	const instanceId = createId()
	const peer: LanPeer = { instanceId, deviceId: device.deviceId, role, name: device.peerName, deviceType: device.deviceType, avatarSeed: device.avatarSeed, joinedAt: now }
	return { roomId, token, tokenHash: await sha256Base64url(token), role, instanceId, localPeer: peer, pairExpiresAt: now + pairTtlMs, sessionExpiresAt: now + sessionTtlMs }
}

export function createLanSession(device = getLocalDevice()) {
	return createSession('host', createId(9), createId(18), device)
}

export function joinLanSession(roomId: string, token: string, device = getLocalDevice()) {
	return createSession('guest', roomId, token, device)
}

export class LanSignalingClient {
	private channel: LanChannel | null = null
	private closed = false
	private subscribed = false
	private rebuildingChannel = false
	private seq = 0
	private announceStartedAt = 0
	private offlineSince = 0
	private announceTimer: ReturnType<typeof setTimeout> | null = null
	private watchdogTimer: ReturnType<typeof setTimeout> | null = null
	private removeResumeListeners: (() => void) | null = null
	private pending = new Map<string, PendingSignal>()
	private seen = new Map<string, number>()
	private readySettled = false
	private resolveReady!: () => void
	private rejectReady!: (error: Error) => void
	readonly ready: Promise<void>

	constructor(
		private readonly session: LanSession,
		private readonly onMessage: SignalHandler,
		private readonly onStatus?: (status: LanSignalState) => void,
		private readonly onError?: (error: Error) => void,
		private readonly onWake?: () => void,
	) {
		this.ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve
			this.rejectReady = reject
		})
		this.removeResumeListeners = this.bindResumeListeners()
		this.createChannel()
	}

	private createChannel() {
		if (this.closed) return
		this.onStatus?.('connecting')
		const channel = getSupabase().channel(`lan-transfer:${this.session.roomId}`, {
			config: { broadcast: { ack: true, self: false }, presence: { key: this.session.instanceId } }
		})
		this.channel = channel
		channel.on('broadcast', { event: 'lan' }, event => this.receive(event.payload))
		channel.on('presence', { event: 'sync' }, () => this.emitPresencePeers())
		channel.on('presence', { event: 'join' }, () => this.emitPresencePeers())
		channel.subscribe((status, error) => {
			if (this.closed || this.channel !== channel) return
			if (status === 'SUBSCRIBED') {
				this.subscribed = true
				this.offlineSince = 0
				this.clearWatchdog()
				this.onStatus?.('online')
				if (!this.readySettled) {
					this.readySettled = true
					this.resolveReady()
				}
				void this.afterSubscribe(channel)
				return
			}
			if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.handleChannelLoss(status, error)
		})
	}

	private handleChannelLoss(status: string, error?: Error) {
		this.subscribed = false
		this.offlineSince ||= Date.now()
		this.onStatus?.(status === 'CLOSED' ? 'offline' : 'retrying')
		if (!this.readySettled) {
			this.readySettled = true
			this.rejectReady(error || new Error(status === 'TIMED_OUT' ? '连接服务响应超时' : '连接服务暂时不可用'))
		}
		if (error) this.onError?.(error)
		this.scheduleWatchdog()
	}

	private async afterSubscribe(channel: LanChannel) {
		try {
			const result = await channel.track(this.presencePayload())
			if (result !== 'ok') throw new Error('连接服务恢复失败')
			if (this.closed || this.channel !== channel) return
			this.restartAnnouncing()
			this.emitPresencePeers()
			this.flushPending()
		} catch (error) {
			this.onError?.(error instanceof Error ? error : new Error('连接服务恢复失败'))
		}
	}

	private bindResumeListeners() {
		if (typeof window === 'undefined') return null
		const wake = () => this.wake()
		window.addEventListener('focus', wake)
		window.addEventListener('online', wake)
		window.addEventListener('pageshow', wake)
		const onVisibility = () => {
			if (document.visibilityState === 'visible') wake()
			else this.clearWatchdog()
		}
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			window.removeEventListener('focus', wake)
			window.removeEventListener('online', wake)
			window.removeEventListener('pageshow', wake)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}

	private wake() {
		if (this.closed) return
		if (!this.subscribed && this.offlineSince && Date.now() - this.offlineSince >= channelWatchdogMs) void this.rebuildChannel()
		else if (!this.subscribed) this.scheduleWatchdog()
		if (this.subscribed) void this.channel?.track(this.presencePayload()).catch(() => {})
		this.restartAnnouncing()
		this.emitPresencePeers()
		this.flushPending()
		this.onWake?.()
	}

	private scheduleWatchdog() {
		this.clearWatchdog()
		if (this.closed || typeof document !== 'undefined' && document.visibilityState === 'hidden') return
		this.watchdogTimer = setTimeout(() => void this.rebuildChannel(), channelWatchdogMs)
	}

	private clearWatchdog() {
		if (!this.watchdogTimer) return
		clearTimeout(this.watchdogTimer)
		this.watchdogTimer = null
	}

	private async rebuildChannel() {
		if (this.closed || this.subscribed || this.rebuildingChannel) return
		this.rebuildingChannel = true
		this.clearWatchdog()
		const old = this.channel
		this.channel = null
		try {
			if (old) await getSupabase().removeChannel(old).catch(() => {})
		} finally {
			this.rebuildingChannel = false
			this.createChannel()
		}
	}

	private presencePayload(): LanPresencePayload {
		return { instanceId: this.session.instanceId, role: this.session.role, peer: this.session.localPeer, tokenHash: this.session.tokenHash, joinedAt: this.session.localPeer.joinedAt }
	}

	private receive(payload: unknown) {
		if (!isSignalPayload(payload) || payload.roomId !== this.session.roomId || payload.tokenHash !== this.session.tokenHash) return
		if (payload.fromInstanceId === this.session.instanceId) return
		if (payload.toDeviceId !== '*' && payload.toDeviceId !== this.session.localPeer.deviceId) return
		if (payload.toInstanceId !== '*' && payload.toInstanceId !== this.session.instanceId) return
		if (payload.type === 'signal-ack') {
			if (payload.ackFor) this.clearPending(payload.ackFor)
			return
		}
		if (criticalSignalTypes.has(payload.type)) void this.sendSignal('signal-ack', { deviceId: payload.fromDeviceId, instanceId: payload.fromInstanceId }, { generation: payload.generation, negotiationId: payload.negotiationId, ackFor: payload.messageId }).catch(() => {})
		if (!this.rememberMessage(payload.messageId)) return
		this.onMessage(payload)
	}

	private rememberMessage(messageId: string) {
		const now = Date.now()
		for (const [id, timestamp] of this.seen) if (now - timestamp > seenMessageTtlMs) this.seen.delete(id)
		if (this.seen.has(messageId)) return false
		this.seen.set(messageId, now)
		if (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value as string)
		return true
	}

	private emitPresencePeers() {
		const state = this.channel?.presenceState() as Record<string, unknown[]> | undefined
		if (!state) return
		for (const entries of Object.values(state)) for (const entry of entries) {
			if (!isPresencePayload(entry) || entry.tokenHash !== this.session.tokenHash || entry.instanceId === this.session.instanceId) continue
			this.onMessage({
				type: 'announce',
				protocolVersion: LAN_PROTOCOL_VERSION,
				roomId: this.session.roomId,
				tokenHash: this.session.tokenHash,
				fromDeviceId: entry.peer.deviceId,
				fromInstanceId: entry.instanceId,
				toDeviceId: this.session.localPeer.deviceId,
				toInstanceId: this.session.instanceId,
				messageId: createId(),
				seq: 0,
				ts: Date.now(),
				generation: 0,
				negotiationId: '',
				peer: entry.peer,
			})
		}
	}

	private makeMessage(type: LanSignalType, target: LanSignalTarget | null, details: LanSignalSendDetails = {}, peer = this.session.localPeer): LanSignalMessage {
		return {
			type,
			protocolVersion: LAN_PROTOCOL_VERSION,
			roomId: this.session.roomId,
			tokenHash: this.session.tokenHash,
			fromDeviceId: this.session.localPeer.deviceId,
			fromInstanceId: this.session.instanceId,
			toDeviceId: target?.deviceId || '*',
			toInstanceId: target?.instanceId || '*',
			messageId: createId(),
			seq: ++this.seq,
			ts: Date.now(),
			generation: details.generation || 0,
			negotiationId: details.negotiationId || '',
			peer,
			description: details.description,
			candidate: details.candidate,
			ackFor: details.ackFor,
			reason: details.reason,
		}
	}

	async sendSignal(type: LanSignalType, target: LanSignalTarget | null, details: LanSignalSendDetails = {}) {
		if (this.closed) return
		this.prunePending()
		const message = this.makeMessage(type, target, details)
		const critical = criticalSignalTypes.has(type)
		if (critical) this.pending.set(message.messageId, { message, attempts: 0, timer: null })
		let delivered = false
		try {
			delivered = await this.deliver(message)
		} catch (error) {
			if (!critical) throw error
		}
		if (critical) this.scheduleRetry(message.messageId)
		else if (!delivered) throw new Error('连接消息发送失败')
	}

	private async deliver(message: LanSignalMessage) {
		const channel = this.channel
		if (!this.subscribed || !channel) return false
		const result = await channel.send({ type: 'broadcast', event: 'lan', payload: message })
		return result === 'ok'
	}

	private scheduleRetry(messageId: string) {
		const pending = this.pending.get(messageId)
		if (!pending || pending.timer || pending.attempts >= signalAckAttempts) return
		pending.timer = setTimeout(() => {
			pending.timer = null
			if (!this.pending.has(messageId)) return
			pending.attempts += 1
			void this.deliver(pending.message).catch(() => false).finally(() => this.scheduleRetry(messageId))
		}, signalAckRetryMs)
	}

	private flushPending() {
		this.prunePending()
		this.pending.forEach((pending, id) => {
			if (pending.timer) clearTimeout(pending.timer)
			pending.timer = null
			pending.attempts = 0
			void this.deliver(pending.message).catch(() => false).finally(() => this.scheduleRetry(id))
		})
	}

	private clearPending(messageId: string) {
		const pending = this.pending.get(messageId)
		if (pending?.timer) clearTimeout(pending.timer)
		this.pending.delete(messageId)
	}

	private prunePending() {
		const now = Date.now()
		for (const [messageId, pending] of this.pending) if (now - pending.message.ts > seenMessageTtlMs) this.clearPending(messageId)
	}

	restartAnnouncing() {
		this.stopAnnouncing()
		this.announceStartedAt = Date.now()
		void this.sendAnnounce().catch(error => this.onError?.(error instanceof Error ? error : new Error('连接消息发送失败')))
		this.scheduleAnnounce()
	}

	private scheduleAnnounce() {
		if (this.closed) return
		const delay = Date.now() - this.announceStartedAt < announceFastWindowMs ? announceFastIntervalMs : announceSlowIntervalMs
		this.announceTimer = setTimeout(() => {
			this.announceTimer = null
			if (!this.closed) void this.sendAnnounce().catch(() => {})
			this.scheduleAnnounce()
		}, delay)
	}

	stopAnnouncing() {
		if (this.announceTimer) clearTimeout(this.announceTimer)
		this.announceTimer = null
	}

	discardPendingForReplacedInstance(deviceId: string, instanceId: string) {
		for (const [messageId, pending] of this.pending) {
			if (pending.message.toDeviceId === deviceId && pending.message.toInstanceId !== instanceId) this.clearPending(messageId)
		}
	}

	discardPendingForDevice(deviceId: string) {
		for (const [messageId, pending] of this.pending) if (pending.message.toDeviceId === deviceId) this.clearPending(messageId)
	}

	sendAnnounce(target: LanSignalTarget | null = null) {
		return this.sendSignal('announce', target)
	}

	sendPeerLeft(target: LanSignalTarget | null = null) {
		return this.sendSignal('peer-left', target)
	}

	async close() {
		if (this.closed) return
		const departure = this.deliver(this.makeMessage('peer-left', null)).catch(() => false)
		this.closed = true
		this.subscribed = false
		this.stopAnnouncing()
		this.clearWatchdog()
		this.removeResumeListeners?.()
		this.removeResumeListeners = null
		this.pending.forEach(item => item.timer && clearTimeout(item.timer))
		this.pending.clear()
		const channel = this.channel
		this.channel = null
		if (channel) {
			await departure
			await channel.untrack().catch(() => {})
			await getSupabase().removeChannel(channel).catch(() => {})
		}
		if (!this.readySettled) {
			this.readySettled = true
			this.rejectReady(new Error('连接已关闭'))
		}
		this.onStatus?.('closed')
	}
}
