import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adjectives, uniqueNamesGenerator } from 'unique-names-generator'
import type { LanDeviceType, LanPeer, LanPresencePayload, LanRole, LanSession, LanSignalMessage, LanSignalType } from './types'

const pairTtlMs = 10 * 60 * 1000
const sessionTtlMs = 30 * 60 * 1000
const announceIntervalMs = 1000
const announceMaxMs = 30 * 1000
const deviceNameStorageKey = 'winrisef-lan-device-name-v1'
const deviceAvatarStorageKey = 'winrisef-lan-device-avatar-v1'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
let supabaseClient: SupabaseClient | null = null

type LanChannel = ReturnType<SupabaseClient['channel']>
type SignalHandler = (message: LanSignalMessage) => void

function getSupabase() {
	if (!supabaseUrl || !supabaseKey) throw new Error('连接服务未配置，暂不能使用')
	supabaseClient ||= createClient(supabaseUrl, supabaseKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		}
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
	if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('当前浏览器不支持创建连接')
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

function getStoredDeviceName(type: LanDeviceType) {
	try {
		if (typeof localStorage === 'undefined') return createFriendlyDeviceName(type)
		const current = localStorage.getItem(deviceNameStorageKey)
		if (current) return current
		const next = createFriendlyDeviceName(type)
		localStorage.setItem(deviceNameStorageKey, next)
		return next
	} catch {
		return createFriendlyDeviceName(type)
	}
}

function createAvatarSeed() {
	return `lan-${createId(9)}`
}

function getStoredAvatarSeed() {
	try {
		if (typeof localStorage === 'undefined') return createAvatarSeed()
		const current = localStorage.getItem(deviceAvatarStorageKey)
		if (current) return current
		const next = createAvatarSeed()
		localStorage.setItem(deviceAvatarStorageKey, next)
		return next
	} catch {
		return 'browser-device'
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object')
}

function isLanPeer(value: unknown): value is LanPeer {
	return isRecord(value) && typeof value.id === 'string' && (value.role === 'host' || value.role === 'guest') && typeof value.name === 'string' && typeof value.deviceType === 'string' && typeof value.avatarSeed === 'string' && typeof value.joinedAt === 'number'
}

function isPresencePayload(value: unknown): value is LanPresencePayload {
	return isRecord(value) && typeof value.peerId === 'string' && (value.role === 'host' || value.role === 'guest') && isLanPeer(value.peer) && typeof value.tokenHash === 'string' && typeof value.joinedAt === 'number'
}

function isSignalPayload(value: unknown): value is LanSignalMessage {
	if (!isRecord(value)) return false
	const type = value.type
	return (
		(type === 'announce' || type === 'signal' || type === 'peer-left') &&
		typeof value.roomId === 'string' &&
		typeof value.tokenHash === 'string' &&
		typeof value.from === 'string' &&
		typeof value.to === 'string' &&
		typeof value.seq === 'number' &&
		typeof value.ts === 'number'
	)
}

export function getLocalDevice() {
	if (typeof navigator === 'undefined') return { peerName: 'Browser Device', deviceType: 'unknown' as LanDeviceType, avatarSeed: 'browser-device' }
	const ua = navigator.userAgent.toLowerCase()
	const deviceType: LanDeviceType = /ipad|tablet/.test(ua) ? 'tablet' : /iphone|android|mobile/.test(ua) ? 'phone' : 'desktop'
	return { peerName: getStoredDeviceName(deviceType), deviceType, avatarSeed: getStoredAvatarSeed() }
}

async function createSession(role: LanRole, roomId: string, token: string, device = getLocalDevice()): Promise<LanSession> {
	const now = Date.now()
	const peer: LanPeer = {
		id: createId(),
		role,
		name: device.peerName,
		deviceType: device.deviceType,
		avatarSeed: device.avatarSeed,
		joinedAt: now
	}
	return {
		roomId,
		token,
		tokenHash: await sha256Base64url(token),
		role,
		peerId: peer.id,
		localPeer: peer,
		pairExpiresAt: now + pairTtlMs,
		sessionExpiresAt: now + sessionTtlMs
	}
}

export function createLanSession(device = getLocalDevice()) {
	return createSession('host', createId(9), createId(18), device)
}

export function joinLanSession(roomId: string, token: string, device = getLocalDevice()) {
	return createSession('guest', roomId, token, device)
}

export class LanSignalingClient {
	private channel: LanChannel
	private closed = false
	private subscribed = false
	private seq = 0
	private announceStartedAt = 0
	private announceTimer: ReturnType<typeof setInterval> | null = null
	readonly ready: Promise<void>

	constructor(
		private readonly session: LanSession,
		private readonly onMessage: SignalHandler,
		private readonly onStatus?: (status: string) => void,
		private readonly onError?: (error: Error) => void
	) {
		this.channel = getSupabase().channel(`lan-transfer:${session.roomId}`, {
			config: {
				broadcast: { ack: true, self: false },
				presence: { key: session.peerId }
			}
		})
		this.channel.on('broadcast', { event: 'lan' }, event => this.receive(event.payload))
		this.channel.on('presence', { event: 'sync' }, () => this.emitPresencePeers())
		this.channel.on('presence', { event: 'join' }, () => this.emitPresencePeers())
		this.ready = new Promise((resolve, reject) => {
			this.channel.subscribe((status, error) => {
				this.onStatus?.(status)
				if (status === 'SUBSCRIBED') {
					this.subscribed = true
					resolve()
				}
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(error || new Error('连接失败'))
			})
		})
		this.ready.then(() => this.afterSubscribe()).catch(error => this.onError?.(error instanceof Error ? error : new Error('连接失败')))
	}

	private async afterSubscribe() {
		if (this.closed) return
		const result = await this.channel.track(this.presencePayload())
		if (result !== 'ok') throw new Error('连接失败')
		if (this.closed) return
		await this.sendAnnounce()
		this.restartAnnouncing()
		this.emitPresencePeers()
	}

	private presencePayload(): LanPresencePayload {
		return {
			peerId: this.session.peerId,
			role: this.session.role,
			peer: this.session.localPeer,
			tokenHash: this.session.tokenHash,
			joinedAt: this.session.localPeer.joinedAt
		}
	}

	private receive(payload: unknown) {
		if (!isSignalPayload(payload)) return
		if (payload.roomId !== this.session.roomId || payload.tokenHash !== this.session.tokenHash) return
		if (payload.from === this.session.peerId) return
		if (payload.to !== '*' && payload.to !== this.session.peerId) return
		this.onMessage(payload)
	}

	private emitPresencePeers() {
		const state = this.channel.presenceState() as Record<string, unknown[]>
		for (const entries of Object.values(state)) {
			for (const entry of entries) {
				if (!isPresencePayload(entry)) continue
				if (entry.tokenHash !== this.session.tokenHash || entry.peerId === this.session.peerId) continue
				this.onMessage({
					type: 'announce',
					roomId: this.session.roomId,
					tokenHash: this.session.tokenHash,
					from: entry.peerId,
					to: this.session.peerId,
					seq: 0,
					ts: Date.now(),
					peer: entry.peer
				})
			}
		}
	}

	private async send(type: LanSignalType, to: string, extra: Partial<LanSignalMessage> = {}) {
		await this.ready
		if (this.closed) return
		const result = await this.channel.send({
			type: 'broadcast',
			event: 'lan',
			payload: {
				...extra,
				type,
				roomId: this.session.roomId,
				tokenHash: this.session.tokenHash,
				from: this.session.peerId,
				to,
				seq: ++this.seq,
				ts: Date.now()
			}
		})
		if (result !== 'ok') throw new Error('连接消息发送失败')
	}

	restartAnnouncing() {
		this.stopAnnouncing()
		this.announceStartedAt = Date.now()
		this.announceTimer = setInterval(() => {
			if (this.closed || Date.now() - this.announceStartedAt >= announceMaxMs) {
				this.stopAnnouncing()
				return
			}
			void this.sendAnnounce().catch(error => this.onError?.(error instanceof Error ? error : new Error('连接消息发送失败')))
		}, announceIntervalMs)
	}

	stopAnnouncing() {
		if (!this.announceTimer) return
		clearInterval(this.announceTimer)
		this.announceTimer = null
	}

	sendAnnounce(to = '*') {
		return this.send('announce', to, { peer: this.session.localPeer })
	}

	sendSignal(to: string, signal: unknown) {
		return this.send('signal', to, { peer: this.session.localPeer, signal })
	}

	async close() {
		if (this.closed) return
		this.stopAnnouncing()
		if (this.subscribed) {
			await this.send('peer-left', '*').catch(() => {})
			await this.channel.untrack().catch(() => {})
		}
		this.closed = true
		await getSupabase().removeChannel(this.channel)
	}
}
