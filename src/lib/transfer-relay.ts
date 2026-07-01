'use client'

import {
	bytesToArrayBuffer,
	bytesToBase64Url,
	createTransferEncryptionContext,
	decodeTextPayload,
	decryptTransferChunk,
	deriveTransferProof,
	encodeTextPayload,
	encryptTransferChunk
} from './transfer-crypto'
import {
	TRANSFER_LIMITS,
	TRANSFER_UPLOAD_CONTENT_TYPE,
	type TransferChunkMeta,
	type TransferCreateResponse,
	type TransferErrorBody,
	type TransferKind,
	type TransferOpenResponse,
	type TransferPublicMeta
} from './transfer-types'

const contentLimitLabel = '4MB'
const AES_GCM_TAG_BYTES = 16

const errorText: Record<string, string> = {
	bad_password: '密码不正确',
	config_missing: 'Edge Functions 还没有配置中转站环境变量',
	consumed: '这条中转消息已经被销毁',
	expired: '这条中转消息已经过期',
	invalid_code: '请输入 6 位提取码',
	invalid_payload: '中转数据格式不支持，请重新读取',
	not_found: '没有找到这条中转消息，可能已经被销毁',
	rate_limited: '今天上传次数已达上限',
	too_large: '内容超过大小限制',
	upload_missing: '密文还没有上传完成',
	upload_pending: '密文还在上传中，请稍后再试'
}

type StatusSink = (message: string) => void

type CreateRelayOptions = {
	kind: TransferKind
	text: string
	file: File | null
	password: string
	createUrl: string
	completeUrl: string
	fileLimitBytes?: number
	fileTooLargeMessage?: string
	onStatus?: StatusSink
}

type OpenRelayOptions = {
	code: string
	password: string
	metaUrl: string
	openUrl: string
	onStatus?: StatusSink
}

type PreparedPayload = {
	kind: TransferKind
	name: string
	contentType: string
	size: number
	plain?: Uint8Array
	file?: File
}

export type OpenedRelayFile = {
	name: string
	contentType: string
	size: number
	url: string
	isImage: boolean
}

export type OpenedRelayTransfer = { text: string; file?: never } | { text?: never; file: OpenedRelayFile }

export async function readTransferApiError(response: Response) {
	const body = (await response.json().catch(() => null)) as TransferErrorBody | null
	return errorText[body?.error || ''] || body?.message || '请求失败'
}

async function fetchTransferJson<T>(url: string, init?: RequestInit) {
	const response = await fetch(url, init)
	if (!response.ok) throw new Error(await readTransferApiError(response))
	return (await response.json()) as T
}

function assertPassword(password: string) {
	if (password.length < TRANSFER_LIMITS.minPasswordLength) throw new Error(`密码至少 ${TRANSFER_LIMITS.minPasswordLength} 位`)
}

function createChunkIv(usedIvs: Set<string>) {
	let iv = ''
	do {
		iv = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)))
	} while (usedIvs.has(iv))
	usedIvs.add(iv)
	return iv
}

function createChunkManifest(size: number) {
	const chunkSize = TRANSFER_LIMITS.publicRelayChunkBytes
	const chunkCount = Math.ceil(size / chunkSize)
	const usedIvs = new Set<string>()
	return Array.from({ length: chunkCount }, (_, index): TransferChunkMeta => {
		const start = index * chunkSize
		const plainSize = Math.min(chunkSize, size - start)
		return {
			index,
			iv: createChunkIv(usedIvs),
			plainSize,
			cipherSize: plainSize + AES_GCM_TAG_BYTES
		}
	})
}

function concatBytes(chunks: Uint8Array[]) {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

function downloadObjectUrl(filename: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = filename || 'transfer-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
}

async function uploadCipher(url: string, cipher: Uint8Array, message: string) {
	const upload = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': TRANSFER_UPLOAD_CONTENT_TYPE },
		body: bytesToArrayBuffer(cipher)
	})
	if (!upload.ok) throw new Error(message)
}

async function completeTransfer(completeUrl: string, code: string) {
	await fetchTransferJson<TransferPublicMeta>(completeUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code })
	})
}

function preparePayload(options: CreateRelayOptions): PreparedPayload {
	if (options.kind === 'text') {
		const plain = encodeTextPayload(options.text)
		if (!plain.length) throw new Error('请先输入要中转的文本')
		if (plain.length > TRANSFER_LIMITS.maxTextBytes) throw new Error(`内容最多 ${contentLimitLabel}`)
		return {
			kind: 'text',
			name: 'message.txt',
			contentType: 'text/plain;charset=utf-8',
			size: plain.length,
			plain
		}
	}

	const file = options.file
	if (!file) throw new Error('请先选择文件')
	if (file.size <= 0) throw new Error('请选择非空文件')
	const fileLimitBytes = options.fileLimitBytes ?? TRANSFER_LIMITS.maxFileBytes
	if (file.size > fileLimitBytes) throw new Error(options.fileTooLargeMessage || '公网中转最多支持 200MB，大文件请使用局域网互传')
	return {
		kind: 'file',
		name: file.name || 'transfer-file',
		contentType: file.type || 'application/octet-stream',
		size: file.size,
		file
	}
}

async function readPlainChunk(payload: PreparedPayload, chunk: TransferChunkMeta) {
	if (payload.plain) return payload.plain.subarray(chunk.index * TRANSFER_LIMITS.publicRelayChunkBytes, chunk.index * TRANSFER_LIMITS.publicRelayChunkBytes + chunk.plainSize)
	if (!payload.file) throw new Error('请先选择文件')
	const start = chunk.index * TRANSFER_LIMITS.publicRelayChunkBytes
	return new Uint8Array(await payload.file.slice(start, start + chunk.plainSize).arrayBuffer())
}

export async function createRelayTransfer(options: CreateRelayOptions) {
	assertPassword(options.password)
	options.onStatus?.('正在准备分片...')
	const payload = preparePayload(options)
	const chunks = createChunkManifest(payload.size)
	const chunkSize = TRANSFER_LIMITS.publicRelayChunkBytes
	const context = await createTransferEncryptionContext(options.password)

	options.onStatus?.('正在创建中转链接...')
	const created = await fetchTransferJson<TransferCreateResponse>(options.createUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			kind: payload.kind,
			name: payload.name,
			contentType: payload.contentType,
			size: payload.size,
			salt: context.salt,
			proof: context.proof,
			chunked: true,
			chunkSize,
			chunkCount: chunks.length,
			chunks
		})
	})

	const uploadUrls = new Map(created.uploadUrls.map(item => [item.index, item.url]))
	if (uploadUrls.size !== chunks.length) throw new Error('分片上传地址生成失败')

	for (const chunk of chunks) {
		const displayIndex = chunk.index + 1
		const uploadUrl = uploadUrls.get(chunk.index)
		if (!uploadUrl) throw new Error(`第 ${displayIndex} 个分片上传失败，请重试`)

		options.onStatus?.(`正在加密并上传分片 ${displayIndex} / ${chunks.length}`)
		const plain = await readPlainChunk(payload, chunk)
		const encrypted = await encryptTransferChunk(plain, context.key, chunk.iv)
		await uploadCipher(uploadUrl, encrypted.cipher, `第 ${displayIndex} 个分片上传失败，请重试`)
	}

	options.onStatus?.('正在确认上传...')
	await completeTransfer(options.completeUrl, created.code)
	return created
}

function sortOpenChunks(opened: TransferOpenResponse) {
	const chunks = [...opened.chunks].sort((a, b) => a.index - b.index)
	if (chunks.length !== opened.chunkCount) throw new Error('分片清单不完整，请重新读取')
	for (let index = 0; index < chunks.length; index++) {
		if (chunks[index].index !== index || !chunks[index].url || !chunks[index].iv) throw new Error('分片清单不完整，请重新读取')
	}
	return chunks
}

async function openChunkManifest(response: Response, password: string, meta: TransferPublicMeta, onStatus?: StatusSink): Promise<OpenedRelayTransfer> {
	const opened = (await response.json()) as TransferOpenResponse
	const chunks = sortOpenChunks(opened)
	const { key } = await deriveTransferProof(password, meta)
	const parts: Uint8Array[] = []

	for (const chunk of chunks) {
		const displayIndex = chunk.index + 1
		onStatus?.(`正在下载分片 ${displayIndex} / ${chunks.length}`)
		const chunkResponse = await fetch(chunk.url)
		if (!chunkResponse.ok) throw new Error(`第 ${displayIndex} 个分片下载失败，请重新读取`)

		onStatus?.(`正在本地合并/解密 ${displayIndex} / ${chunks.length}`)
		try {
			parts.push(await decryptTransferChunk(await chunkResponse.arrayBuffer(), key, chunk.iv))
		} catch {
			throw new Error('密码不正确或文件分片已损坏')
		}
	}

	onStatus?.('正在本地合并/解密')
	if (opened.kind === 'text') return { text: decodeTextPayload(concatBytes(parts)) }
	const contentType = opened.contentType || 'application/octet-stream'
	const file: OpenedRelayFile = {
		name: opened.name || 'transfer-file',
		contentType,
		size: opened.size,
		url: URL.createObjectURL(new Blob(parts.map(bytesToArrayBuffer), { type: contentType })),
		isImage: contentType.toLowerCase().startsWith('image/')
	}
	if (!file.isImage) downloadObjectUrl(file.name, file.url)
	return { file }
}

export async function openRelayTransfer(options: OpenRelayOptions) {
	options.onStatus?.('正在读取元信息...')
	const meta = await fetchTransferJson<TransferPublicMeta>(options.metaUrl)
	if (meta.status !== 'ready') throw new Error('密文还在上传中，请稍后再试')

	options.onStatus?.('正在校验密码...')
	const { proof } = await deriveTransferProof(options.password, meta)
	const response = await fetch(options.openUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code: options.code, proof })
	})
	if (!response.ok) throw new Error(await readTransferApiError(response))

	const opened = await openChunkManifest(response, options.password, meta, options.onStatus)
	if ('file' in opened) options.onStatus?.(opened.file.isImage ? '图片读取成功，提取入口已销毁' : '文件已开始下载，提取入口已销毁，下载链接短时有效')
	else options.onStatus?.('读取成功，提取入口已销毁')
	return opened
}
