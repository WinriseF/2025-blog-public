const LAN_PREFIX = 'lan'
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const LIMITS = {
	pairMs: 10 * 60 * 1000,
	sessionMs: 30 * 60 * 1000,
	maxSignalBytes: 64 * 1024,
	maxCreatePerMinute: 10,
	listBatchSize: 20
}

class LanError extends Error {
	constructor(status, code, message) {
		super(message)
		this.status = status
		this.code = code
	}
}

let blobApiPromise

async function getBlobApi() {
	blobApiPromise ||= import('@edgeone/pages-blob')
	try {
		return await blobApiPromise
	} catch (error) {
		throw new LanError(503, 'blob_unavailable', error instanceof Error ? error.message : 'EdgeOne Blob SDK unavailable')
	}
}

async function getLanStore(env) {
	const { getStore } = await getBlobApi()
	return getStore({
		name: env.EDGEONE_LAN_STORE || 'lan-transfer',
		consistency: 'strong'
	})
}

function corsHeaders(request, env) {
	const origin = request.headers.get('origin') || ''
	const allowed = String(env.LAN_ALLOWED_ORIGIN || '*')
		.split(',')
		.map(item => item.trim())
		.filter(Boolean)
	const allowOrigin = allowed.includes('*') || !origin ? '*' : allowed.includes(origin) ? origin : allowed[0] || '*'
	return {
		'Access-Control-Allow-Origin': allowOrigin,
		'Access-Control-Allow-Headers': 'content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Cache-Control': 'no-store'
	}
}

function json(data, status, request, env) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...corsHeaders(request, env),
			'Content-Type': 'application/json; charset=utf-8'
		}
	})
}

function errorResponse(error, request, env) {
	if (error instanceof LanError) return json({ error: error.code, message: error.message }, error.status, request, env)
	return json({ error: 'server_error', message: error instanceof Error ? error.message : 'Unexpected LAN transfer error' }, 500, request, env)
}

async function readJson(request) {
	try {
		return await request.json()
	} catch {
		throw new LanError(400, 'invalid_json', 'Invalid JSON body')
	}
}

function getClientIp(request) {
	return request.headers.get('eo-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown'
}

function bytesToBase64Url(bytes) {
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomId(bytes = 12) {
	const value = new Uint8Array(bytes)
	crypto.getRandomValues(value)
	return bytesToBase64Url(value)
}

async function sha256(value) {
	const bytes = new TextEncoder().encode(value)
	const hash = await crypto.subtle.digest('SHA-256', bytes)
	return bytesToBase64Url(new Uint8Array(hash))
}

function safeEqual(a, b) {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}

function formatMinute(value) {
	const date = new Date(value + BEIJING_OFFSET_MS)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	const h = String(date.getUTCHours()).padStart(2, '0')
	const min = String(date.getUTCMinutes()).padStart(2, '0')
	return `${y}${m}${d}${h}${min}`
}

function roomPrefix(roomId) {
	return `${LAN_PREFIX}/rooms/${roomId}`
}

function metaKey(roomId) {
	return `${roomPrefix(roomId)}/meta.json`
}

function peerKey(roomId, peerId) {
	return `${roomPrefix(roomId)}/peers/${peerId}.json`
}

function mailboxPrefix(roomId, peerId) {
	return `${roomPrefix(roomId)}/mailbox/${peerId}/`
}

function mailboxKey(roomId, peerId) {
	return `${mailboxPrefix(roomId, peerId)}${Date.now()}-${randomId(5)}.json`
}

function cleanPeer(input) {
	const name = String(input.peerName || input.name || '未知设备').slice(0, 40)
	const deviceType = ['desktop', 'phone', 'tablet'].includes(input.deviceType) ? input.deviceType : 'unknown'
	return { name, deviceType }
}

function assertId(value, field) {
	const id = String(value || '')
	if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new LanError(400, 'invalid_payload', `Invalid ${field}`)
	return id
}

function assertToken(value) {
	const token = String(value || '')
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new LanError(401, 'unauthorized', 'Invalid room token')
	return token
}

async function readMeta(store, roomId) {
	const meta = await store.get(metaKey(roomId), { type: 'json', consistency: 'strong' })
	if (!meta) throw new LanError(404, 'not_found', 'LAN room not found')
	return meta
}

async function assertRoom(store, input) {
	const roomId = assertId(input.roomId, 'roomId')
	const token = assertToken(input.token)
	const meta = await readMeta(store, roomId)
	if (!safeEqual(await sha256(token), meta.tokenHash)) throw new LanError(401, 'unauthorized', 'Invalid room token')
	if (Date.now() >= meta.sessionExpiresAt || (!meta.joinedAt && Date.now() >= meta.pairExpiresAt)) throw new LanError(410, 'expired', 'LAN room expired')
	return meta
}

async function listJson(store, prefix) {
	const { blobs } = await store.list({ prefix, consistency: 'strong' })
	const rows = await Promise.all(
		blobs.map(async blob => {
			try {
				return { key: blob.key, value: await store.get(blob.key, { type: 'json', consistency: 'strong' }) }
			} catch {
				return null
			}
		})
	)
	return rows.filter(Boolean)
}

async function deletePrefix(store, prefix) {
	const { blobs } = await store.list({ prefix, consistency: 'strong' })
	let deleted = 0
	for (let index = 0; index < blobs.length; index += LIMITS.listBatchSize) {
		const batch = blobs.slice(index, index + LIMITS.listBatchSize)
		await Promise.all(batch.map(blob => store.delete(blob.key).then(() => (deleted += 1)).catch(() => {})))
	}
	return deleted
}

async function enforceCreateRate(store, request) {
	const key = `${LAN_PREFIX}/rate/${formatMinute(Date.now())}/${await sha256(getClientIp(request))}.json`
	const record = (await store.get(key, { type: 'json', consistency: 'strong' })) || { count: 0 }
	if (record.count >= LIMITS.maxCreatePerMinute) throw new LanError(429, 'rate_limited', 'Too many LAN rooms created')
	await store.setJSON(key, { count: record.count + 1, updatedAt: Date.now() }, { cacheControl: 'no-store' })
}

async function createRoom(input, request, env) {
	const store = await getLanStore(env)
	await enforceCreateRate(store, request)
	const now = Date.now()
	const roomId = randomId(9)
	const token = randomId(18)
	const peerId = randomId(9)
	const peer = { id: peerId, role: 'host', ...cleanPeer(input), joinedAt: now }
	const meta = {
		roomId,
		tokenHash: await sha256(token),
		hostPeerId: peerId,
		status: 'pairing',
		createdAt: now,
		pairExpiresAt: now + LIMITS.pairMs,
		sessionExpiresAt: now + LIMITS.sessionMs
	}
	await store.setJSON(metaKey(roomId), meta, { cacheControl: 'no-store' })
	await store.setJSON(peerKey(roomId, peerId), peer, { cacheControl: 'no-store' })
	return { ok: true, roomId, token, peerId, role: 'host', pairExpiresAt: meta.pairExpiresAt, sessionExpiresAt: meta.sessionExpiresAt }
}

async function joinRoom(input, env) {
	const store = await getLanStore(env)
	const meta = await assertRoom(store, input)
	const peers = await listJson(store, `${roomPrefix(meta.roomId)}/peers/`)
	if (peers.length >= 2) throw new LanError(409, 'room_full', 'LAN room already has two devices')
	const now = Date.now()
	const peerId = randomId(9)
	const peer = { id: peerId, role: 'guest', ...cleanPeer(input), joinedAt: now }
	const nextMeta = { ...meta, guestPeerId: peerId, joinedAt: now, status: 'connected' }
	await store.setJSON(peerKey(meta.roomId, peerId), peer, { cacheControl: 'no-store' })
	await store.setJSON(metaKey(meta.roomId), nextMeta, { cacheControl: 'no-store' })
	await store.setJSON(mailboxKey(meta.roomId, meta.hostPeerId), { id: randomId(8), from: peerId, type: 'peer-joined', payload: { peer }, createdAt: now }, { cacheControl: 'no-store' })
	return {
		ok: true,
		roomId: meta.roomId,
		peerId,
		role: 'guest',
		peer,
		peers: peers.map(item => item.value),
		pairExpiresAt: nextMeta.pairExpiresAt,
		sessionExpiresAt: nextMeta.sessionExpiresAt
	}
}

async function sendMessage(input, env) {
	const store = await getLanStore(env)
	const meta = await assertRoom(store, input)
	const peerId = assertId(input.peerId, 'peerId')
	const to = assertId(input.to, 'to')
	const type = String(input.type || '')
	const payload = input.payload ?? null
	if (!['signal', 'peer-left'].includes(type)) throw new LanError(400, 'invalid_payload', 'Invalid message type')
	if (JSON.stringify(payload).length > LIMITS.maxSignalBytes) throw new LanError(413, 'too_large', 'Signal message is too large')
	const fromPeer = await store.get(peerKey(meta.roomId, peerId), { type: 'json', consistency: 'strong' })
	const toPeer = await store.get(peerKey(meta.roomId, to), { type: 'json', consistency: 'strong' })
	if (!fromPeer || !toPeer) throw new LanError(404, 'peer_not_found', 'LAN peer not found')
	await store.setJSON(mailboxKey(meta.roomId, to), { id: randomId(8), from: peerId, type, payload, createdAt: Date.now() }, { cacheControl: 'no-store' })
	return { ok: true }
}

async function pollMessages(input, env) {
	const store = await getLanStore(env)
	const meta = await assertRoom(store, input)
	const peerId = assertId(input.peerId, 'peerId')
	const peer = await store.get(peerKey(meta.roomId, peerId), { type: 'json', consistency: 'strong' })
	if (!peer) throw new LanError(404, 'peer_not_found', 'LAN peer not found')
	const [messages, peers] = await Promise.all([listJson(store, mailboxPrefix(meta.roomId, peerId)), listJson(store, `${roomPrefix(meta.roomId)}/peers/`)])
	await Promise.all(messages.map(item => store.delete(item.key).catch(() => {})))
	return {
		ok: true,
		roomId: meta.roomId,
		peerId,
		peers: peers.map(item => item.value).filter(item => item.id !== peerId),
		messages: messages.map(item => item.value).sort((a, b) => a.createdAt - b.createdAt)
	}
}

async function closePeer(input, env) {
	const store = await getLanStore(env)
	const meta = await assertRoom(store, input)
	const peerId = assertId(input.peerId, 'peerId')
	const peers = await listJson(store, `${roomPrefix(meta.roomId)}/peers/`)
	await store.delete(peerKey(meta.roomId, peerId)).catch(() => {})
	await deletePrefix(store, mailboxPrefix(meta.roomId, peerId)).catch(() => {})
	await Promise.all(
		peers
			.map(item => item.value)
			.filter(peer => peer.id !== peerId)
			.map(peer => store.setJSON(mailboxKey(meta.roomId, peer.id), { id: randomId(8), from: peerId, type: 'peer-left', payload: {}, createdAt: Date.now() }, { cacheControl: 'no-store' }))
	)
	return { ok: true }
}

async function cleanupRooms(env) {
	const store = await getLanStore(env)
	const { blobs } = await store.list({ prefix: `${LAN_PREFIX}/rooms/`, consistency: 'strong' })
	const metaKeys = blobs.map(blob => blob.key).filter(key => key.endsWith('/meta.json'))
	let rooms = 0
	let deleted = 0
	const now = Date.now()
	for (const key of metaKeys) {
		const meta = await store.get(key, { type: 'json', consistency: 'strong' }).catch(() => null)
		if (!meta || (now < meta.sessionExpiresAt && (meta.joinedAt || now < meta.pairExpiresAt))) continue
		rooms += 1
		deleted += await deletePrefix(store, roomPrefix(meta.roomId))
	}
	return { ok: true, rooms, deleted }
}

function actionFromRequest(request) {
	const match = new URL(request.url).pathname.match(/\/api\/lan\/([^/]+)$/)
	return match?.[1] || ''
}

export async function onRequest(context) {
	const { request, env = {} } = context
	if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request, env) })

	try {
		if (request.method !== 'POST') throw new LanError(405, 'method_not_allowed', 'Only POST is supported')
		const action = actionFromRequest(request)
		const input = action === 'cleanup' ? {} : await readJson(request)
		if (action === 'create-room') return json(await createRoom(input, request, env), 200, request, env)
		if (action === 'join-room') return json(await joinRoom(input, env), 200, request, env)
		if (action === 'send') return json(await sendMessage(input, env), 200, request, env)
		if (action === 'poll') return json(await pollMessages(input, env), 200, request, env)
		if (action === 'close') return json(await closePeer(input, env), 200, request, env)
		if (action === 'cleanup') return json(await cleanupRooms(env), 200, request, env)
		throw new LanError(404, 'not_found', 'LAN endpoint not found')
	} catch (error) {
		return errorResponse(error, request, env)
	}
}
