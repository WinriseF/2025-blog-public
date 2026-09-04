import { adjectives, uniqueNamesGenerator } from 'unique-names-generator'
import { type LanDeviceType, type LanRole, type LanSession } from './types'

const roomStoragePrefix = 'winrisef-lan-room-v14:'
const deviceNameStorageKey = 'winrisef-lan-device-name-v1'
const deviceAvatarStorageKey = 'winrisef-lan-device-avatar-v1'
const deviceIdStorageKey = 'winrisef-lan-device-id-v1'
const roomIdPattern = /^[A-Za-z0-9_-]{8,64}$/
const secretPattern = /^[A-Za-z0-9_-]{20,128}$/

export type LanLocalDevice = {
	deviceId: string
	peerName: string
	deviceType: LanDeviceType
	avatarSeed: string
}

export type LanRoomMembership = {
	version: 14
	roomId: string
	secret: string
	role: LanRole
	createdAt: number
	lastOpenedAt: number
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

function createId(bytes = 12) {
	return base64url(randomBytes(bytes))
}

async function channelKey(roomId: string, secret: string) {
	const input = new TextEncoder().encode(`lan-v14:${roomId}:${secret}`)
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
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

export function getLocalDevice(): LanLocalDevice {
	if (typeof navigator === 'undefined') return { deviceId: 'browser-device', peerName: 'Browser Device', deviceType: 'unknown', avatarSeed: 'browser-device' }
	const ua = navigator.userAgent.toLowerCase()
	const deviceType: LanDeviceType = /ipad|tablet/.test(ua) ? 'tablet' : /iphone|android|mobile/.test(ua) ? 'phone' : 'desktop'
	return {
		deviceId: readOrCreate(deviceIdStorageKey, () => `device-${createId(12)}`),
		peerName: readOrCreate(deviceNameStorageKey, () => createFriendlyDeviceName(deviceType)),
		deviceType,
		avatarSeed: readOrCreate(deviceAvatarStorageKey, () => `lan-${createId(9)}`),
	}
}

function membershipKey(roomId: string) {
	return `${roomStoragePrefix}${roomId}`
}

export function readLanRoomMembership(roomId: string) {
	if (!roomIdPattern.test(roomId) || typeof localStorage === 'undefined') return null
	try {
		const value = JSON.parse(localStorage.getItem(membershipKey(roomId)) || 'null') as Partial<LanRoomMembership> | null
		if (!value || value.version !== 14 || value.roomId !== roomId || typeof value.secret !== 'string' || !secretPattern.test(value.secret) || value.role !== 'host' && value.role !== 'guest') return null
		return value as LanRoomMembership
	} catch {
		return null
	}
}

export function saveLanRoomMembership(membership: LanRoomMembership) {
	try {
		localStorage.setItem(membershipKey(membership.roomId), JSON.stringify(membership))
	} catch {
		// Private browsing may not provide durable storage. The current page can still connect.
	}
}

export function forgetLanRoom(roomId: string) {
	try {
		localStorage.removeItem(membershipKey(roomId))
	} catch {
		// Ignore unavailable local storage.
	}
}

function membership(roomId: string, secret: string, role: LanRole, previous?: LanRoomMembership | null): LanRoomMembership {
	const now = Date.now()
	return {
		version: 14,
		roomId,
		secret,
		role,
		createdAt: previous?.createdAt || now,
		lastOpenedAt: now,
	}
}

async function sessionFromMembership(value: LanRoomMembership, device = getLocalDevice()): Promise<LanSession> {
	const instanceId = createId()
	const startedAt = Date.now()
	return {
		roomId: value.roomId,
		secret: value.secret,
		channelKey: await channelKey(value.roomId, value.secret),
		role: value.role,
		instanceId,
		localPeer: {
			instanceId,
			deviceId: device.deviceId,
			role: value.role,
			name: device.peerName,
			deviceType: device.deviceType,
			avatarSeed: device.avatarSeed,
			startedAt,
		},
	}
}

export async function createLanSession(device = getLocalDevice()) {
	const value = membership(createId(9), createId(18), 'host')
	saveLanRoomMembership(value)
	return sessionFromMembership(value, device)
}

export async function joinLanSession(roomId: string, secret: string, device = getLocalDevice()) {
	if (!roomIdPattern.test(roomId) || !secretPattern.test(secret)) throw new Error('邀请链接无效')
	const previous = readLanRoomMembership(roomId)
	const value = membership(roomId, secret, previous?.secret === secret ? previous.role : 'guest', previous?.secret === secret ? previous : null)
	saveLanRoomMembership(value)
	return sessionFromMembership(value, device)
}

export async function restoreLanSession(roomId: string, device = getLocalDevice()) {
	const previous = readLanRoomMembership(roomId)
	if (!previous) return null
	const value = membership(previous.roomId, previous.secret, previous.role, previous)
	saveLanRoomMembership(value)
	return sessionFromMembership(value, device)
}

export function lanInviteLink(session: LanSession, origin: string) {
	return `${origin}/t/lan/${encodeURIComponent(session.roomId)}#k=${encodeURIComponent(session.secret)}`
}

export function inviteSecretFromHash(hash: string) {
	return new URLSearchParams(hash.replace(/^#/, '')).get('k') || ''
}
