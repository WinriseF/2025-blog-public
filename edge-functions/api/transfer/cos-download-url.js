const encoder = new TextEncoder()
const signedHeaders = new Set(['cache-control', 'content-disposition', 'content-encoding', 'content-length', 'content-md5', 'content-type', 'expect', 'expires', 'if-match', 'if-modified-since', 'if-none-match', 'if-unmodified-since', 'origin', 'range', 'transfer-encoding'])

function bytes(value) {
	return encoder.encode(value)
}

function hex(buffer) {
	return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function hmacSha1(key, value) {
	const cryptoKey = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
	return hex(await crypto.subtle.sign('HMAC', cryptoKey, bytes(value)))
}

async function sha1(value) {
	return hex(await crypto.subtle.digest('SHA-1', bytes(value)))
}

function encodeComponent(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function decodeComponent(value) {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function canonicalPath(value, encode) {
	return value
		.split('/')
		.map(part => (encode ? encodeComponent(decodeComponent(part)) : decodeComponent(part)))
		.join('/')
}

function canonicalEntries(input = {}) {
	return Object.entries(input)
		.filter(([, value]) => value != null)
		.map(([key, value]) => [key.toLowerCase(), String(value)])
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function canonicalPairString(entries) {
	return entries.map(([key, value]) => `${encodeComponent(key)}=${encodeComponent(value)}`).join('&')
}

function canonicalKeyString(entries) {
	return entries.map(([key]) => encodeComponent(key)).join(';')
}

async function signCosUrl({ domain, method, key, credential, expireSeconds }) {
	const rawPath = `/${canonicalPath(key, false)}`
	const encodedPath = `/${canonicalPath(key, true)}`
	const now = Math.floor(Date.now() / 1000)
	const expiresAt = now + expireSeconds
	const signTime = `${now};${expiresAt}`
	const headers = canonicalEntries({}).filter(([key]) => key === 'host' || key === 'x-cos-security-token' ? false : signedHeaders.has(key) || key.startsWith('x-cos-'))
	const query = canonicalEntries({})
	const headerList = canonicalKeyString(headers)
	const queryList = canonicalKeyString(query)
	const httpString = `${method.toLowerCase()}\n${rawPath}\n${canonicalPairString(query)}\n${canonicalPairString(headers)}\n`
	const stringToSign = `sha1\n${signTime}\n${await sha1(httpString)}\n`
	const signKey = await hmacSha1(credential.secretKey, signTime)
	const signature = await hmacSha1(signKey, stringToSign)
	const url = new URL(domain)
	url.pathname = encodedPath
	url.searchParams.set('q-sign-algorithm', 'sha1')
	url.searchParams.set('q-ak', credential.secretId)
	url.searchParams.set('q-sign-time', signTime)
	url.searchParams.set('q-key-time', signTime)
	url.searchParams.set('q-header-list', headerList)
	url.searchParams.set('q-url-param-list', queryList)
	url.searchParams.set('q-signature', signature)
	if (credential.sessionToken) url.searchParams.set('x-cos-security-token', credential.sessionToken)
	return { url: url.toString(), expiresAt }
}

export async function createDownloadUrl(store, key, expireSeconds) {
	const client = store?.cosClient
	if (!client?.resolveDomain || !client?.resolveCredential || !client?.buildCosKey || !store?.storeName) throw new Error('Pages Blob SDK does not expose signing internals')
	const domain = await client.resolveDomain('strong')
	const credential = await client.resolveCredential()
	return signCosUrl({
		domain,
		method: 'GET',
		key: client.buildCosKey(store.storeName, key),
		credential,
		expireSeconds
	})
}
