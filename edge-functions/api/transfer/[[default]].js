const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
const UPLOAD_CONTENT_TYPE = 'application/octet-stream'
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const LIMITS = {
	maxTextBytes: 1024 * 1024,
	maxFileBytes: 20 * 1024 * 1024,
	maxCreatePerIpPerDay: 20,
	uploadUrlSeconds: 10 * 60,
	statsTopLimit: 50,
	statsMaxTopLimit: 200,
	statsMetadataBatchSize: 10
}

class TransferError extends Error {
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
		throw new TransferError(503, 'blob_unavailable', error instanceof Error ? error.message : 'EdgeOne Blob SDK unavailable')
	}
}

function isPreconditionFailed(error, PreconditionFailedError) {
	return (typeof PreconditionFailedError === 'function' && error instanceof PreconditionFailedError) || error?.code === 'PRECONDITION_FAILED'
}

function corsHeaders(request, env) {
	const origin = request.headers.get('origin') || ''
	const allowed = String(env.TRANSFER_ALLOWED_ORIGIN || '*')
		.split(',')
		.map(item => item.trim())
		.filter(Boolean)
	const allowOrigin = allowed.includes('*') || !origin ? '*' : allowed.includes(origin) ? origin : allowed[0] || '*'
	return {
		'Access-Control-Allow-Origin': allowOrigin,
		'Access-Control-Allow-Headers': 'authorization, content-type, x-transfer-cleanup-secret',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
	if (error instanceof TransferError) return json({ error: error.code, message: error.message }, error.status, request, env)
	return json({ error: 'server_error', message: error instanceof Error ? error.message : 'Unexpected transfer error' }, 500, request, env)
}

async function readJson(request) {
	try {
		return await request.json()
	} catch {
		throw new TransferError(400, 'invalid_json', 'Invalid JSON body')
	}
}

function getClientIp(request) {
	return request.headers.get('eo-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown'
}

function getRequiredEnv(env, name) {
	const value = env[name]?.trim()
	if (!value) throw new TransferError(503, 'config_missing', `Missing ${name}`)
	return value
}

function transferStoreName(env) {
	return env.EDGEONE_BLOB_STORE || 'message-transfer'
}

async function getTransferStore(env) {
	const { getStore } = await getBlobApi()
	return getStore({
		name: transferStoreName(env),
		consistency: 'strong'
	})
}

function bytesToBase64Url(bytes) {
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

function randomBytes(length) {
	const bytes = new Uint8Array(length)
	crypto.getRandomValues(bytes)
	return bytes
}

function randomCode() {
	let code = ''
	for (const byte of randomBytes(CODE_LENGTH)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
	return code
}

function randomId(bytes = 18) {
	return bytesToBase64Url(randomBytes(bytes))
}

function formatBeijingDate(value) {
	const date = new Date(value + BEIJING_OFFSET_MS)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}${m}${d}`
}

function getNextBeijingCleanupAt(now = Date.now()) {
	const local = new Date(now + BEIJING_OFFSET_MS)
	const y = local.getUTCFullYear()
	const m = local.getUTCMonth()
	const d = local.getUTCDate()
	let cleanupAt = Date.UTC(y, m, d, 2, 0, 0, 0) - BEIJING_OFFSET_MS
	if (cleanupAt <= now) cleanupAt += 24 * 60 * 60 * 1000
	return cleanupAt
}

function isBeijingCleanupWindow(now = Date.now()) {
	return new Date(now + BEIJING_OFFSET_MS).getUTCHours() === 2
}

function keySet(id, code, expireAt) {
	const expireDate = formatBeijingDate(expireAt)
	return {
		payloadKey: `transfer/items/${id}/payload.bin`,
		metaKey: `transfer/items/${id}/meta.json`,
		codeKey: `transfer/codes/${code}.json`,
		expireKey: `transfer/expires/${expireDate}/${id}.json`,
		consumedKey: `transfer/items/${id}/consumed.json`
	}
}

function assertCode(code) {
	const normalized = String(code || '').trim().toUpperCase()
	if (!CODE_PATTERN.test(normalized)) throw new TransferError(400, 'invalid_code', 'Invalid transfer code')
	return normalized
}

function assertBase64Url(value, field) {
	if (!/^[A-Za-z0-9_-]{16,256}$/.test(String(value || ''))) throw new TransferError(400, 'invalid_payload', `Invalid ${field}`)
}

function assertCreateRequest(input) {
	if (input.kind !== 'text' && input.kind !== 'file') throw new TransferError(400, 'invalid_payload', 'Invalid content type')
	if (!input.name || input.name.length > 160) throw new TransferError(400, 'invalid_payload', 'Invalid file name')
	if (!Number.isFinite(input.size) || input.size <= 0) throw new TransferError(400, 'invalid_payload', 'Invalid size')
	if (input.kind === 'text' && input.size > LIMITS.maxTextBytes) throw new TransferError(413, 'too_large', 'Text is too large')
	if (input.kind === 'file' && input.size > LIMITS.maxFileBytes) throw new TransferError(413, 'too_large', 'File is too large')
	assertBase64Url(input.salt, 'salt')
	assertBase64Url(input.iv, 'iv')
	assertBase64Url(input.proof, 'proof')
}

function publicMeta(meta) {
	return {
		code: meta.code,
		kind: meta.kind,
		name: meta.name,
		contentType: meta.contentType,
		size: meta.size,
		salt: meta.salt,
		iv: meta.iv,
		status: meta.status,
		expireAt: meta.expireAt,
		createdAt: meta.createdAt
	}
}

async function readMeta(store, code) {
	const index = await store.get(`transfer/codes/${code}.json`, { type: 'json', consistency: 'strong' })
	if (!index) throw new TransferError(404, 'not_found', 'Transfer not found or already destroyed')
	const meta = await store.get(index.metaKey, { type: 'json', consistency: 'strong' })
	if (!meta) throw new TransferError(404, 'not_found', 'Transfer not found or already destroyed')
	return meta
}

async function deleteTransfer(store, meta, includeExpire = true) {
	const keys = keySet(meta.id, meta.code, meta.expireAt)
	const deleteKeys = [keys.payloadKey, keys.metaKey, keys.codeKey]
	if (includeExpire) deleteKeys.push(keys.expireKey, keys.consumedKey)
	await Promise.all(deleteKeys.map(key => store.delete(key)))
}

async function expireTransfer(store, meta) {
	await deleteTransfer(store, meta)
	throw new TransferError(410, 'expired', 'Transfer expired')
}

async function enforceCreateRateLimit(store, env, ip) {
	const salt = getRequiredEnv(env, 'TRANSFER_RATE_SALT')
	const key = `transfer/rate/${formatBeijingDate(Date.now())}/${await sha256(`${ip}:${salt}`)}.json`
	const record = (await store.get(key, { type: 'json', consistency: 'strong' })) || { count: 0 }
	if (record.count >= LIMITS.maxCreatePerIpPerDay) throw new TransferError(429, 'rate_limited', 'Daily upload limit reached')
	await store.setJSON(key, { count: record.count + 1, updatedAt: Date.now() }, { cacheControl: 'no-store' })
}

async function createTransfer(input, request, env) {
	assertCreateRequest(input)
	const store = await getTransferStore(env)
	const { PreconditionFailedError } = await getBlobApi()
	await enforceCreateRateLimit(store, env, getClientIp(request))

	for (let attempt = 0; attempt < 8; attempt++) {
		const code = randomCode()
		const id = randomId()
		const expireAt = getNextBeijingCleanupAt()
		const keys = keySet(id, code, expireAt)
		const meta = { ...input, id, code, status: 'pending', createdAt: Date.now(), expireAt, proofHash: await sha256(input.proof) }

		try {
			const upload = await store.createUploadUrl(keys.payloadKey, {
				expireSeconds: LIMITS.uploadUrlSeconds,
				contentType: UPLOAD_CONTENT_TYPE
			})
			await store.setJSON(keys.codeKey, { metaKey: keys.metaKey }, { onlyIfNew: true, cacheControl: 'no-store' })
			await store.setJSON(keys.metaKey, meta, { cacheControl: 'no-store' })
			await store.setJSON(keys.expireKey, { id, code, expireAt }, { cacheControl: 'no-store' })
			return { code, uploadUrl: upload.url, uploadExpiresAt: upload.expiresAt, expireAt }
		} catch (error) {
			if (isPreconditionFailed(error, PreconditionFailedError)) {
				await Promise.all([store.delete(keys.metaKey), store.delete(keys.expireKey)]).catch(() => {})
				continue
			}
			await Promise.all([store.delete(keys.codeKey), store.delete(keys.metaKey), store.delete(keys.expireKey)]).catch(() => {})
			throw error
		}
	}

	throw new TransferError(503, 'code_collision', 'Could not allocate transfer code')
}

async function completeTransfer(input, env) {
	const code = assertCode(input.code)
	const store = await getTransferStore(env)
	const meta = await readMeta(store, code)
	if (Date.now() >= meta.expireAt) await expireTransfer(store, meta)
	if (meta.status === 'ready') return publicMeta(meta)
	const keys = keySet(meta.id, meta.code, meta.expireAt)
	const uploaded = await store.getMetadata(keys.payloadKey, { consistency: 'strong' })
	if (!uploaded) throw new TransferError(400, 'upload_missing', 'Encrypted payload was not uploaded')
	const nextMeta = { ...meta, status: 'ready' }
	await store.setJSON(keys.metaKey, nextMeta, { cacheControl: 'no-store' })
	return publicMeta(nextMeta)
}

async function getTransferMeta(request, env) {
	const code = assertCode(new URL(request.url).searchParams.get('code') || '')
	const store = await getTransferStore(env)
	const meta = await readMeta(store, code)
	if (Date.now() >= meta.expireAt) await expireTransfer(store, meta)
	return publicMeta(meta)
}

async function openTransfer(input, env) {
	const code = assertCode(input.code)
	assertBase64Url(input.proof, 'proof')
	const store = await getTransferStore(env)
	const { PreconditionFailedError } = await getBlobApi()
	const meta = await readMeta(store, code)
	if (Date.now() >= meta.expireAt) await expireTransfer(store, meta)
	if (meta.status !== 'ready') throw new TransferError(409, 'upload_pending', 'Transfer is still uploading')
	if (!safeEqual(await sha256(input.proof), meta.proofHash)) throw new TransferError(401, 'bad_password', 'Password is incorrect')

	const keys = keySet(meta.id, meta.code, meta.expireAt)
	const payload = await store.get(keys.payloadKey, { type: 'arrayBuffer', consistency: 'strong' })
	if (!payload) {
		await deleteTransfer(store, meta)
		throw new TransferError(410, 'consumed', 'Transfer has already been destroyed')
	}

	try {
		await store.setJSON(keys.consumedKey, { id: meta.id, code, consumedAt: Date.now() }, { onlyIfNew: true, cacheControl: 'no-store' })
	} catch (error) {
		if (isPreconditionFailed(error, PreconditionFailedError)) throw new TransferError(410, 'consumed', 'Transfer has already been destroyed')
		throw error
	}

	await deleteTransfer(store, meta, false)
	return payload
}

async function cleanupExpiredTransfers(env, limit = 500) {
	const store = await getTransferStore(env)
	const now = Date.now()
	const { blobs } = await store.list({ prefix: 'transfer/expires/', limit, consistency: 'strong' })
	let cleaned = 0

	for (const blob of blobs) {
		const index = await store.get(blob.key, { type: 'json', consistency: 'strong' })
		if (!index || index.expireAt > now) continue
		const keys = keySet(index.id, index.code, index.expireAt)
		await Promise.all([keys.payloadKey, keys.metaKey, keys.codeKey, keys.consumedKey, blob.key].map(key => store.delete(key)))
		cleaned += 1
	}

	const todayRatePrefix = `transfer/rate/${formatBeijingDate(now)}/`
	const rates = await store.list({ prefix: 'transfer/rate/', limit, consistency: 'strong' })
	let rateCleaned = 0
	for (const blob of rates.blobs) {
		if (blob.key.startsWith(todayRatePrefix)) continue
		await store.delete(blob.key)
		rateCleaned += 1
	}

	return { cleaned, rateCleaned, scanned: blobs.length }
}

function classifyTransferObject(key) {
	if (key.endsWith('/payload.bin')) return 'payload'
	if (key.endsWith('/meta.json')) return 'meta'
	if (key.endsWith('/consumed.json')) return 'consumed'
	if (key.startsWith('transfer/codes/')) return 'code-index'
	if (key.startsWith('transfer/expires/')) return 'expire-index'
	if (key.startsWith('transfer/rate/')) return 'rate'
	return 'other'
}

function normalizeTopLimit(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return LIMITS.statsTopLimit
	return Math.max(0, Math.min(LIMITS.statsMaxTopLimit, Math.floor(number)))
}

function compactErrorMessage(error) {
	const message = error instanceof Error ? error.message : String(error)
	return message.replace(/\s+/g, ' ').slice(0, 300)
}

async function assertAdminPassword(input, env) {
	const expected = getRequiredEnv(env, 'TRANSFER_ADMIN_PASSWORD_HASH')
	const password = String(input?.password || '')
	if (!password || !safeEqual(await sha256(password), expected)) throw new TransferError(401, 'unauthorized', 'Invalid admin password')
}

async function collectTransferStats(input, env) {
	await assertAdminPassword(input, env)
	const store = await getTransferStore(env)
	const topLimit = normalizeTopLimit(input?.topLimit)
	const { blobs } = await store.list({ prefix: 'transfer/', consistency: 'strong' })
	const rows = []
	const errors = []
	const byType = {}
	let totalBytes = 0

	for (let index = 0; index < blobs.length; index += LIMITS.statsMetadataBatchSize) {
		const batch = blobs.slice(index, index + LIMITS.statsMetadataBatchSize)
		const details = await Promise.all(
			batch.map(async blob => {
				const type = classifyTransferObject(blob.key)
				try {
					const metadata = await store.getMetadata(blob.key, { consistency: 'strong' })
					const bytes = Number(metadata?.headers?.['content-length'] || 0)
					return {
						key: blob.key,
						type,
						bytes: Number.isFinite(bytes) ? bytes : 0,
						contentType: metadata?.contentType || '',
						etag: metadata?.etag || blob.etag || ''
					}
				} catch (error) {
					return {
						key: blob.key,
						type,
						bytes: 0,
						contentType: '',
						etag: blob.etag || '',
						error: compactErrorMessage(error)
					}
				}
			})
		)

		for (const item of details) {
			totalBytes += item.bytes
			const bucket = byType[item.type] || { count: 0, bytes: 0 }
			bucket.count += 1
			bucket.bytes += item.bytes
			byType[item.type] = bucket
			rows.push(item)
			if (item.error) errors.push({ key: item.key, type: item.type, message: item.error })
		}
	}

	rows.sort((a, b) => b.bytes - a.bytes)
	const top = rows
		.filter(item => !item.error)
		.slice(0, topLimit)
	return {
		ok: true,
		generatedAt: Date.now(),
		store: transferStoreName(env),
		objectCount: rows.length,
		totalBytes,
		byType,
		metadataErrorCount: errors.length,
		errors: errors.slice(0, topLimit),
		top
	}
}

function actionFromRequest(request) {
	const match = new URL(request.url).pathname.match(/\/api\/transfer\/([^/]+)$/)
	return match?.[1] || ''
}

export async function onRequest(context) {
	const { request, env = {} } = context
	if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request, env) })

	try {
		const action = actionFromRequest(request)
		if (request.method === 'POST' && action === 'create') return json(await createTransfer(await readJson(request), request, env), 200, request, env)
		if (request.method === 'POST' && action === 'complete') return json(await completeTransfer(await readJson(request), env), 200, request, env)
		if (request.method === 'GET' && action === 'meta') return json(await getTransferMeta(request, env), 200, request, env)
		if (request.method === 'POST' && action === 'stats') return json(await collectTransferStats(await readJson(request), env), 200, request, env)
		if (request.method === 'POST' && action === 'open') {
			const payload = await openTransfer(await readJson(request), env)
			return new Response(payload, {
				headers: {
					...corsHeaders(request, env),
					'Content-Type': UPLOAD_CONTENT_TYPE
				}
			})
		}
		if (request.method === 'POST' && action === 'cleanup') {
			if (!isBeijingCleanupWindow()) throw new TransferError(403, 'cleanup_window', 'Cleanup only runs during the scheduled window')
			return json({ ok: true, ...(await cleanupExpiredTransfers(env)) }, 200, request, env)
		}
		throw new TransferError(404, 'not_found', 'Transfer endpoint not found')
	} catch (error) {
		return errorResponse(error, request, env)
	}
}
