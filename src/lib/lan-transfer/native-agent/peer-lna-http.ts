import type { LanNativeAgentTicket, LanNativeBenchmarkDirection, LanNativeBenchmarkProgress, LanNativeBenchmarkResult } from './types'
import { NATIVE_AGENT_SESSION_COUNT } from './types'
import { validLanFileHttpEndpoint, validLanHttpBaseEndpoint } from './endpoint-validation'

const HTTP_REQUEST_BYTES = 30 * 1024 * 1024
const PAYLOAD_BLOCK_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000

export type LocalNetworkAccessDecision = { state: 'unsupported' | 'denied' } | { state: 'unavailable'; reason: string } | { state: 'available'; endpoint: string }
type PermissionNameWithLna = PermissionName | 'local-network-access'

export async function selectLocalNetworkAccessEndpoint(endpoints: string[]): Promise<LocalNetworkAccessDecision> {
	return selectLocalNetworkEndpoint(
		endpoints,
		validLanHttpBaseEndpoint,
		'本地网络权限可用，但无法连接加速电脑的 HTTP/TCP 端口，请检查 Agent 版本和防火墙'
	)
}

export async function selectLocalNetworkAccessFileEndpoint(endpoints: string[]): Promise<LocalNetworkAccessDecision> {
	return selectLocalNetworkEndpoint(
		endpoints,
		validLanFileHttpEndpoint,
		'本地网络权限可用，但无法连接加速电脑的正式文件端口，请检查 Agent 和防火墙'
	)
}

async function selectLocalNetworkEndpoint(
	endpoints: string[],
	validate: (endpoint: string) => boolean,
	unreachableMessage: string
): Promise<LocalNetworkAccessDecision> {
	const initialPermission = await queryLocalNetworkAccessPermission()
	if (initialPermission === 'unsupported') return { state: 'unsupported' }
	if (initialPermission === 'denied') return { state: 'denied' }
	const candidates = [...new Set(endpoints.filter(validate))]
	if (!candidates.length) return { state: 'unavailable', reason: '加速电脑没有发布可用的私网 HTTP 地址' }
	for (const endpoint of candidates) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 3_000)
		try {
			const response = await fetch(endpointUrl(endpoint, 'probe'), { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
			if (response.status === 204) return { state: 'available', endpoint }
		} catch {
		} finally {
			clearTimeout(timer)
		}
	}
	const permissionAfterProbe = await queryLocalNetworkAccessPermission()
	if (permissionAfterProbe === 'denied') return { state: 'denied' }
	return { state: 'unavailable', reason: unreachableMessage }
}

export function nativeAgentLnaTicketCount(totalBytes: number) {
	return createWorkerRequestSizes(totalBytes, NATIVE_AGENT_SESSION_COUNT).reduce((count, requests) => count + requests.length, 0)
}

export async function runLanNativeHttpBenchmark(options: {
	tickets: LanNativeAgentTicket[]
	endpoint: string
	direction: LanNativeBenchmarkDirection
	totalBytes: number
	onProgress?: (progress: LanNativeBenchmarkProgress) => void
}): Promise<LanNativeBenchmarkResult> {
	const sessionCount = NATIVE_AGENT_SESSION_COUNT
	const workerRequests = createWorkerRequestSizes(options.totalBytes, sessionCount)
	const requiredTickets = workerRequests.reduce((count, requests) => count + requests.length, 0)
	if (options.tickets.length !== requiredTickets) throw new Error('HTTP/TCP 极速通道凭据数量不完整')
	if (options.tickets.some(ticket => ticket.expiresAt <= Date.now() || !ticket.lnaHttpEndpoints.includes(options.endpoint) || ticket.lnaHttpVersion !== 1))
		throw new Error('HTTP/TCP 极速通道凭据无效或已过期')

	let ticketIndex = 0
	const workerTickets = workerRequests.map(requests => requests.map(() => options.tickets[ticketIndex++]!))
	const workerProgress = new Array<number>(sessionCount).fill(0)
	const startedAt = performance.now()
	let lastProgressAt = startedAt
	const report = (workerIndex: number, bytes: number) => {
		workerProgress[workerIndex] = bytes
		const transferred = workerProgress.reduce((sum, value) => sum + value, 0)
		const now = performance.now()
		if (now - lastProgressAt >= 100 || transferred === options.totalBytes) {
			lastProgressAt = now
			options.onProgress?.({
				direction: options.direction,
				transport: 'lna-http',
				sessionCount,
				bytes: transferred,
				totalBytes: options.totalBytes,
				startedAt
			})
		}
	}
	options.onProgress?.({ direction: options.direction, transport: 'lna-http', sessionCount, bytes: 0, totalBytes: options.totalBytes, startedAt })

	await Promise.all(
		workerRequests.map((requests, workerIndex) =>
			runHttpWorker(options.endpoint, options.direction, requests, workerTickets[workerIndex]!, bytes => report(workerIndex, bytes))
		)
	)
	const clientElapsedMs = performance.now() - startedAt
	return {
		direction: options.direction,
		transport: 'lna-http',
		sessionCount,
		bytes: options.totalBytes,
		clientElapsedMs,
		agentElapsedMs: clientElapsedMs,
		clientMbps: (options.totalBytes * 8) / Math.max(clientElapsedMs, 0.001) / 1_000,
		agentMbps: (options.totalBytes * 8) / Math.max(clientElapsedMs, 0.001) / 1_000
	}
}

async function queryLocalNetworkAccessPermission(): Promise<PermissionState | 'unsupported'> {
	if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported'
	try {
		const descriptor = { name: 'local-network-access' as PermissionNameWithLna } as PermissionDescriptor
		return (await navigator.permissions.query(descriptor)).state
	} catch {
		return 'unsupported'
	}
}

function createWorkerRequestSizes(totalBytes: number, workerCount: number) {
	if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error('测速大小无效')
	const shardSizes = splitBytes(totalBytes, workerCount)
	return shardSizes.map(shardBytes => {
		const requests: number[] = []
		for (let remaining = shardBytes; remaining > 0; remaining -= HTTP_REQUEST_BYTES) requests.push(Math.min(HTTP_REQUEST_BYTES, remaining))
		return requests
	})
}

async function runHttpWorker(
	endpoint: string,
	direction: LanNativeBenchmarkDirection,
	requestSizes: number[],
	tickets: LanNativeAgentTicket[],
	onProgress: (bytes: number) => void
) {
	let completedBytes = 0
	for (let index = 0; index < requestSizes.length; index += 1) {
		const bytes = requestSizes[index]!
		const reportRequest = (currentBytes: number) => onProgress(completedBytes + currentBytes)
		if (direction === 'browser-to-agent') await uploadRequest(endpoint, bytes, tickets[index]!, reportRequest)
		else await downloadRequest(endpoint, bytes, tickets[index]!, reportRequest)
		completedBytes += bytes
		onProgress(completedBytes)
	}
}

function uploadRequest(endpoint: string, bytes: number, ticket: LanNativeAgentTicket, onProgress: (bytes: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', endpointUrl(endpoint, 'benchmark'))
		xhr.responseType = 'json'
		xhr.timeout = REQUEST_TIMEOUT_MS
		xhr.setRequestHeader('X-WinriseF-Ticket', ticket.token)
		xhr.upload.onprogress = event => onProgress(Math.min(bytes, event.loaded))
		xhr.onerror = () => reject(new Error('HTTP/TCP 上传连接失败，请检查防火墙和本地网络权限'))
		xhr.ontimeout = () => reject(new Error('HTTP/TCP 上传超时'))
		xhr.onabort = () => reject(new Error('HTTP/TCP 上传被浏览器中止'))
		xhr.onload = () => {
			try {
				const response = xhr.response as { bytes?: unknown } | null
				if (xhr.status !== 200) return reject(httpStatusError(xhr.status, response))
				if (response?.bytes !== bytes) return reject(new Error('Agent 报告的 HTTP/TCP 上传字节数不一致'))
				onProgress(bytes)
				resolve()
			} catch (error) {
				reject(error instanceof Error ? error : new Error('无法解析 Agent 的 HTTP/TCP 上传结果'))
			}
		}
		xhr.send(createPayloadBlob(bytes))
	})
}

function downloadRequest(endpoint: string, bytes: number, ticket: LanNativeAgentTicket, onProgress: (bytes: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const url = new URL(endpointUrl(endpoint, 'benchmark'))
		url.searchParams.set('bytes', String(bytes))
		const xhr = new XMLHttpRequest()
		xhr.open('GET', url)
		xhr.responseType = 'arraybuffer'
		xhr.timeout = REQUEST_TIMEOUT_MS
		xhr.setRequestHeader('X-WinriseF-Ticket', ticket.token)
		xhr.onprogress = event => onProgress(Math.min(bytes, event.loaded))
		xhr.onerror = () => reject(new Error('HTTP/TCP 下载连接失败，请检查防火墙和本地网络权限'))
		xhr.ontimeout = () => reject(new Error('HTTP/TCP 下载超时'))
		xhr.onabort = () => reject(new Error('HTTP/TCP 下载被浏览器中止'))
		xhr.onload = () => {
			try {
				if (xhr.status !== 200) return reject(httpStatusError(xhr.status))
				if (!(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength !== bytes)
					return reject(new Error('Agent 返回的 HTTP/TCP 下载字节数不一致'))
				onProgress(bytes)
				resolve()
			} catch (error) {
				reject(error instanceof Error ? error : new Error('无法解析 Agent 的 HTTP/TCP 下载结果'))
			}
		}
		xhr.send()
	})
}

let payloadBlock: Blob | null = null

function createPayloadBlob(bytes: number) {
	payloadBlock ??= new Blob([new Uint8Array(PAYLOAD_BLOCK_BYTES)], { type: 'application/octet-stream' })
	const parts: Blob[] = []
	for (let remaining = bytes; remaining > 0; remaining -= PAYLOAD_BLOCK_BYTES)
		parts.push(remaining >= PAYLOAD_BLOCK_BYTES ? payloadBlock : payloadBlock.slice(0, remaining))
	return new Blob(parts, { type: 'application/octet-stream' })
}

function splitBytes(totalBytes: number, count: number) {
	const quotient = Math.floor(totalBytes / count)
	const remainder = totalBytes % count
	return Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1 : 0))
}

function endpointUrl(base: string, resource: 'probe' | 'benchmark') {
	const url = new URL(base)
	url.pathname = `${url.pathname}/${resource}`
	url.search = ''
	url.hash = ''
	return url.toString()
}

function httpStatusError(status: number, response?: unknown) {
	const error = response && typeof response === 'object' && 'error' in response ? response.error : null
	const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
	return new Error(message || `Agent 拒绝了 HTTP/TCP 测速请求（${status || '网络错误'}）`)
}
