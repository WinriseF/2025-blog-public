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
import { requestTransferChunk, runTransferChunks } from './transfer-chunks'
import { createRelayDownloadStorage, type RelayDownloadStorage } from './transfer-download-storage'
import {
	TRANSFER_FILE_LIMIT_LABEL,
	TRANSFER_LIMITS,
	TRANSFER_UPLOAD_CONTENT_TYPE,
	type TransferChunkMeta,
	type TransferCreateResponse,
	type TransferErrorBody,
	type TransferKind,
	type TransferOpenResponse,
	type TransferReceivedResponse,
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
	signal?: AbortSignal
	onStatus?: StatusSink
}

type OpenRelayOptions = {
	code: string
	password: string
	metaUrl: string
	openUrl: string
	receivedUrl: string
	signal?: AbortSignal
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
	dispose: () => Promise<void>
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

async function uploadCipher(url: string, cipher: Uint8Array, signal: AbortSignal, message: string) {
	await requestTransferChunk(url, {
		method: 'PUT',
		headers: { 'Content-Type': TRANSFER_UPLOAD_CONTENT_TYPE },
		body: bytesToArrayBuffer(cipher)
	}, async () => {}, signal, message)
}

async function completeTransfer(completeUrl: string, code: string, signal?: AbortSignal) {
	await fetchTransferJson<TransferPublicMeta>(completeUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code }),
		signal
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
	if (file.size > fileLimitBytes) throw new Error(options.fileTooLargeMessage || `公网中转最多支持 ${TRANSFER_FILE_LIMIT_LABEL}，大文件请使用局域网互传`)
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
	options.signal?.throwIfAborted()
	assertPassword(options.password)
	options.onStatus?.('正在准备分片...')
	const payload = preparePayload(options)
	const chunks = createChunkManifest(payload.size)
	const chunkSize = TRANSFER_LIMITS.publicRelayChunkBytes
	const context = await createTransferEncryptionContext(options.password)
	options.signal?.throwIfAborted()

	options.onStatus?.('正在创建中转链接...')
	const created = await fetchTransferJson<TransferCreateResponse>(options.createUrl, {
		method: 'POST',
		signal: options.signal,
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

	let uploadedBytes = 0
	let uploadedChunks = 0
	options.onStatus?.('正在加密并上传 0%')
	await runTransferChunks(chunks, async (chunk, signal) => {
		const displayIndex = chunk.index + 1
		const uploadUrl = uploadUrls.get(chunk.index)
		if (!uploadUrl) throw new Error(`第 ${displayIndex} 个分片上传失败，请重试`)

		const plain = await readPlainChunk(payload, chunk)
		signal.throwIfAborted()
		const encrypted = await encryptTransferChunk(plain, context.key, chunk.iv)
		signal.throwIfAborted()
		await uploadCipher(uploadUrl, encrypted.cipher, signal, `第 ${displayIndex} 个分片上传失败，请重新发送`)
		signal.throwIfAborted()
		uploadedBytes += chunk.plainSize
		uploadedChunks++
		options.onStatus?.(`正在加密并上传 ${Math.floor(uploadedBytes / payload.size * 100)}%（${uploadedChunks} / ${chunks.length} 片）`)
	}, { signal: options.signal })

	options.signal?.throwIfAborted()
	options.onStatus?.('正在确认上传...')
	await completeTransfer(options.completeUrl, created.code, options.signal)
	options.signal?.throwIfAborted()
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

async function openChunkManifest(opened: TransferOpenResponse, key: CryptoKey, storage: RelayDownloadStorage | null, onStatus?: StatusSink, signal?: AbortSignal): Promise<OpenedRelayTransfer> {
	const chunks = sortOpenChunks(opened)
	const parts: Uint8Array[] = []
	let savedBytes = 0
	let savedChunks = 0

	onStatus?.('正在下载并解密 0%')
	await runTransferChunks(chunks, async (chunk, chunkSignal) => {
		const displayIndex = chunk.index + 1
		const cipher = await requestTransferChunk(chunk.url, {}, response => response.arrayBuffer(), chunkSignal, `第 ${displayIndex} 个分片下载失败，提取入口已销毁，请让发送方重新发送`)
		chunkSignal.throwIfAborted()

		try {
			const plain = await decryptTransferChunk(cipher, key, chunk.iv)
			chunkSignal.throwIfAborted()
			return plain
		} catch {
			chunkSignal.throwIfAborted()
			throw new Error('密码不正确或文件分片已损坏')
		}
	}, {
		signal,
		async consume(plain, chunk, chunkSignal) {
			if (storage) await storage.write(plain)
			else parts.push(plain)
			chunkSignal.throwIfAborted()
			savedBytes += chunk.plainSize
			savedChunks++
			onStatus?.(`正在下载并解密${storage ? '保存' : ''} ${Math.floor(savedBytes / opened.size * 100)}%（${savedChunks} / ${chunks.length} 片）`)
		}
	})

	signal?.throwIfAborted()
	onStatus?.('正在准备下载文件')
	if (opened.kind === 'text') return { text: decodeTextPayload(concatBytes(parts)) }
	const contentType = opened.contentType || 'application/octet-stream'
	const blob = storage ? await storage.finish(contentType) : new Blob(parts.map(bytesToArrayBuffer), { type: contentType })
	signal?.throwIfAborted()
	const url = URL.createObjectURL(blob)
	const file: OpenedRelayFile = {
		name: opened.name || 'transfer-file',
		contentType,
		size: opened.size,
		url,
		isImage: contentType.toLowerCase().startsWith('image/'),
		async dispose() {
			URL.revokeObjectURL(url)
			await storage?.dispose()
		}
	}
	if (!file.isImage) downloadObjectUrl(file.name, file.url)
	return { file }
}

async function clearReceivedTransfer(options: OpenRelayOptions, receipt: TransferOpenResponse['receipt']) {
	const signal = options.signal ?? new AbortController().signal
	let startIndex = 0
	while (true) {
		const page = await requestTransferChunk<TransferReceivedResponse>(options.receivedUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...receipt, startIndex })
		}, response => response.json(), signal, '中转数据清理未完成')
		if (page.nextIndex === null) return
		if (!Number.isInteger(page.nextIndex) || page.nextIndex <= startIndex) throw new Error('中转数据清理进度异常')
		startIndex = page.nextIndex
	}
}

export async function openRelayTransfer(options: OpenRelayOptions) {
	options.signal?.throwIfAborted()
	options.onStatus?.('正在读取元信息...')
	const meta = await fetchTransferJson<TransferPublicMeta>(options.metaUrl, { signal: options.signal })
	if (meta.status !== 'ready') throw new Error('密文还在上传中，请稍后再试')

	options.onStatus?.('正在校验密码...')
	const { proof, key } = await deriveTransferProof(options.password, meta)
	options.signal?.throwIfAborted()
	// Reserve local storage before the one-time open request consumes the transfer code.
	if (meta.kind === 'file' && meta.size > TRANSFER_LIMITS.memoryFileBytes) options.onStatus?.('正在准备大文件存储...')
	const storage = meta.kind === 'file' && meta.size > TRANSFER_LIMITS.memoryFileBytes ? await createRelayDownloadStorage(meta.size) : null
	let opened: OpenedRelayTransfer | undefined
	try {
		options.signal?.throwIfAborted()
		const response = await fetch(options.openUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: options.code, proof }),
			signal: options.signal
		})
		if (!response.ok) throw new Error(await readTransferApiError(response))

		const manifest = (await response.json()) as TransferOpenResponse
		opened = await openChunkManifest(manifest, key, storage, options.onStatus, options.signal)
		options.onStatus?.('接收成功，正在清理中转数据...')
		let cleaned = false
		try {
			await clearReceivedTransfer(options, manifest.receipt)
			cleaned = true
		} catch {
			options.signal?.throwIfAborted()
		}
		options.onStatus?.(cleaned ? '接收成功，中转数据已清理' : '接收成功，中转数据清理未完成，将由定时任务清理')
		return opened
	} catch (error) {
		if (opened?.file) await opened.file.dispose()
		else await storage?.dispose()
		throw error
	}
}
