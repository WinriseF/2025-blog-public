import type { LanDeviceType, LanPollResponse, LanRoomResponse } from './types'

const lanApiBase = (process.env.NEXT_PUBLIC_TRANSFER_API_BASE || '').replace(/\/+$/, '')

function lanApiUrl(action: string) {
	if (!lanApiBase) throw new Error('未配置 Edge Functions API 地址，暂不能使用局域网互传')
	return `${lanApiBase}/api/lan/${action}`
}

async function readApiError(response: Response) {
	const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
	const errorText: Record<string, string> = {
		expired: '连接二维码已过期，请重新创建',
		not_found: '连接房间不存在或已清理',
		room_full: '这个连接已经有两台设备',
		rate_limited: '创建连接过于频繁，请稍后再试',
		unauthorized: '连接令牌无效'
	}
	return errorText[body?.error || ''] || body?.message || '局域网互传请求失败'
}

async function postLan<T>(action: string, body: unknown) {
	const response = await fetch(lanApiUrl(action), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})
	if (!response.ok) throw new Error(await readApiError(response))
	return (await response.json()) as T
}

export function getLocalDevice() {
	if (typeof navigator === 'undefined') return { peerName: '浏览器设备', deviceType: 'unknown' as LanDeviceType }
	const ua = navigator.userAgent.toLowerCase()
	const deviceType: LanDeviceType = /ipad|tablet/.test(ua) ? 'tablet' : /iphone|android|mobile/.test(ua) ? 'phone' : 'desktop'
	const platform = navigator.platform || ''
	const label = deviceType === 'desktop' ? '电脑' : deviceType === 'phone' ? '手机' : deviceType === 'tablet' ? '平板' : '设备'
	return { peerName: platform ? `${platform} ${label}` : label, deviceType }
}

export function createLanRoom(device = getLocalDevice()) {
	return postLan<LanRoomResponse>('create-room', device)
}

export function joinLanRoom(roomId: string, token: string, device = getLocalDevice()) {
	return postLan<LanRoomResponse>('join-room', { roomId, token, ...device })
}

export function sendLanSignal(roomId: string, token: string, peerId: string, to: string, payload: unknown) {
	return postLan<{ ok: true }>('send', { roomId, token, peerId, to, type: 'signal', payload })
}

export function pollLanRoom(roomId: string, token: string, peerId: string) {
	return postLan<LanPollResponse>('poll', { roomId, token, peerId })
}

export function closeLanRoom(roomId: string, token: string, peerId: string) {
	return postLan<{ ok: true }>('close', { roomId, token, peerId })
}
