import { ExactStreamReader, hexBytes, type WebTransportLike, withTimeout } from '@/lib/lan-transfer/native-agent/webtransport'
import {
	VERSION_CONTROL_BRIDGE_VERSION,
	type ConflictPerspective,
	type DiffFile,
	type DiffSessionInfo,
	type ExportEvent,
	type ExportFormat,
	type ExportLayout,
	type GraphCommit,
	type PreviewContent,
	type RepositoryBranch,
	type RepositoryCandidate,
	type RepositoryOverview,
	type RepositoryTreeEntry,
	type RevisionRef,
	type VersionControlCallback,
	type WorkingTreeGroup
} from './types'

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type StreamWaiter = {
	kind: 'text' | 'image'
	resolve: (value: PreviewContent | Blob) => void
	reject: (error: Error) => void
}
type ControlOutput = { type: string; requestId?: number; ok?: boolean; result?: unknown; error?: string }

export class VersionControlBridge {
	private transport: WebTransportLike | null = null
	private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
	private requestId = 0
	private pending = new Map<number, PendingRequest>()
	private streams = new Map<number, StreamWaiter>()
	private exportListeners = new Set<(event: ExportEvent) => void>()
	private closed = false

	async connect(callback: VersionControlCallback) {
		const Constructor = (window as unknown as { WebTransport?: new (url: string, options: object) => WebTransportLike }).WebTransport
		if (!Constructor) throw new Error('当前浏览器不支持 WebTransport')
		const certificate = hexBytes(callback.certificateSha256, 32, '证书摘要')
		this.transport = new Constructor(callback.bridgeEndpoint, {
			serverCertificateHashes: [{ algorithm: 'sha-256', value: Uint8Array.from(certificate).buffer }],
			congestionControl: 'low-latency',
			anticipatedConcurrentIncomingUnidirectionalStreams: 4
		})
		await withTimeout(this.transport.ready, 5_000, '版本控制器连接超时')
		const stream = await this.transport.createBidirectionalStream()
		this.writer = stream.writable.getWriter()
		void this.readControl(stream.readable)
		void this.readPreviewStreams()
		const helloPromise = this.readHello()
		await this.writeFrame({ type: 'hello', version: VERSION_CONTROL_BRIDGE_VERSION, launchToken: callback.launchToken })
		const hello = await withTimeout(helloPromise, 5_000, '版本控制器认证超时')
		if (!hello.accepted || hello.version !== VERSION_CONTROL_BRIDGE_VERSION) throw new Error(hello.error || 'Agent 协议版本不兼容')
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.transport?.close({ closeCode: 0, reason: 'version-control page closed' })
		this.failAll(new Error('版本控制器连接已关闭'))
		this.exportListeners.clear()
	}

	onExport(listener: (event: ExportEvent) => void) {
		this.exportListeners.add(listener)
		return () => this.exportListeners.delete(listener)
	}

	selectRepository() {
		return this.request<{ cancelled: boolean; repositoryId?: string; overview?: RepositoryOverview; candidates?: RepositoryCandidate[] }>('select-repository')
	}
	openRepositoryCandidate(candidateId: string) {
		return this.request<{ cancelled: boolean; repositoryId?: string; overview?: RepositoryOverview }>('open-repository-candidate', { candidateId })
	}
	connectHistory(repositoryId: string) {
		return this.request<RepositoryOverview>('connect-history', { repositoryId })
	}
	closeRepository(repositoryId: string) {
		return this.request('close-repository', { repositoryId })
	}
	refresh(repositoryId: string) {
		return this.request<RepositoryOverview>('refresh-repository', { repositoryId })
	}
	getHistory(repositoryId: string, query: string | null, skip: number, limit = 48, branchRefs: string[] = []) {
		return this.request<{ items: GraphCommit[]; nextSkip: number; hasMore: boolean }>('get-history-page', {
			repositoryId,
			query: query || null,
			branchRefs: branchRefs.length ? branchRefs : null,
			skip,
			limit
		})
	}
	getBranches(repositoryId: string, skip: number, limit = 128) {
		return this.request<{ items: RepositoryBranch[]; nextSkip: number; hasMore: boolean }>('get-branches-page', { repositoryId, skip, limit })
	}
	getDirectory(repositoryId: string, path: string, skip: number, limit = 96) {
		return this.request<{ items: RepositoryTreeEntry[]; nextSkip: number; hasMore: boolean }>('get-directory-page', { repositoryId, path, skip, limit })
	}
	async openRepositoryFile(repositoryId: string, path: string) {
		return (await this.requestStream<PreviewContent>('open-repository-file', 'text', { repositoryId, path })).modified
	}
	openRepositoryImage(repositoryId: string, path: string) {
		return this.requestStream<Blob>('open-repository-image', 'image', { repositoryId, path })
	}
	openDiff(repositoryId: string, oldRevision: RevisionRef, newRevision: RevisionRef, group: WorkingTreeGroup) {
		return this.request<DiffSessionInfo>('open-diff', { repositoryId, oldRevision, newRevision, group })
	}
	getDiffFiles(repositoryId: string, diffId: string, skip: number, limit = 96) {
		return this.request<{ items: DiffFile[]; nextSkip: number; hasMore: boolean }>('get-diff-files-page', { repositoryId, diffId, skip, limit })
	}
	async openPreview(repositoryId: string, diffId: string, fileId: number, perspective: ConflictPerspective, mode: 'full' | 'patch' = 'full') {
		return this.requestStream<PreviewContent>('open-file-preview', 'text', { repositoryId, diffId, fileId, perspective, mode })
	}

	private async requestStream<T extends PreviewContent | Blob>(type: string, kind: StreamWaiter['kind'], fields: Record<string, unknown>) {
		const requestId = this.nextRequestId()
		const preview = new Promise<T>((resolve, reject) =>
			this.streams.set(requestId, { kind, resolve: value => resolve(value as T), reject })
		)
		try {
			await this.requestWithId(requestId, type, fields)
			return await preview
		} catch (error) {
			this.streams.delete(requestId)
			throw error
		}
	}

	prepareExport(repositoryId: string, diffId: string, format: ExportFormat, layout: ExportLayout, selectedFileIds: number[], totalFiles: number) {
		return this.request<{ cancelled: boolean; exportTargetId?: string; insideRepository?: boolean }>('prepare-export', {
			repositoryId,
			diffId,
			format,
			layout,
			fileSelection: compactFileSelection(selectedFileIds, totalFiles)
		})
	}
	confirmExport(exportTargetId: string, allowInsideRepository: boolean) {
		return this.request<{ started: boolean }>('confirm-export', { exportTargetId, allowInsideRepository })
	}
	cancelExport(exportTargetId: string) {
		return this.request<{ cancelled: boolean }>('cancel-export', { exportTargetId })
	}

	private request<T = unknown>(type: string, fields: Record<string, unknown> = {}) {
		return this.requestWithId<T>(this.nextRequestId(), type, fields)
	}

	private requestWithId<T>(requestId: number, type: string, fields: Record<string, unknown>) {
		const response = new Promise<T>((resolve, reject) => this.pending.set(requestId, { resolve: value => resolve(value as T), reject }))
		void this.writeFrame({ type, requestId, ...fields }).catch(error => {
			const normalized = normalizeError(error)
			this.pending.get(requestId)?.reject(normalized)
			this.pending.delete(requestId)
			this.streams.get(requestId)?.reject(normalized)
			this.streams.delete(requestId)
		})
		return response
	}

	private nextRequestId() {
		this.requestId = (this.requestId + 1) >>> 0 || 1
		return this.requestId
	}

	private helloResolver: PendingRequest | null = null
	private readHello() {
		return new Promise<{ version: number; accepted: boolean; error?: string }>((resolve, reject) => {
			this.helloResolver = { resolve: value => resolve(value as { version: number; accepted: boolean; error?: string }), reject }
		})
	}

	private async readControl(stream: ReadableStream<Uint8Array>) {
		const reader = new ExactStreamReader(stream)
		try {
			while (!this.closed) {
				const prefix = await reader.readExact(4)
				const length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0)
				if (!length || length > 64 * 1024) throw new Error('Agent 返回了无效控制帧')
				const output = JSON.parse(new TextDecoder().decode(await reader.readExact(length))) as ControlOutput
				if (output.type === 'hello-ack') {
					this.helloResolver?.resolve(output)
					this.helloResolver = null
				} else if (output.type === 'response' && output.requestId) {
					const pending = this.pending.get(output.requestId)
					this.pending.delete(output.requestId)
					if (output.ok) pending?.resolve(output.result)
					else pending?.reject(new Error(output.error || 'Agent 请求失败'))
				} else if (output.type.startsWith('export-')) {
					for (const listener of this.exportListeners) listener(output as ExportEvent)
				}
			}
		} catch (error) {
			if (!this.closed) this.failAll(error instanceof Error ? error : new Error(String(error)))
		} finally {
			reader.release()
		}
	}

	private async readPreviewStreams() {
		if (!this.transport) return
		const streams = this.transport.incomingUnidirectionalStreams.getReader()
		try {
			while (!this.closed) {
				const next = await streams.read()
				if (next.done) break
				void this.readPreview(next.value)
			}
		} catch (error) {
			if (!this.closed) this.failStreams(normalizeError(error))
		} finally {
			streams.releaseLock()
		}
	}

	private async readPreview(stream: ReadableStream<Uint8Array>) {
		const reader = new ExactStreamReader(stream)
		let requestId: number | null = null
		try {
			const prefix = await reader.readExact(4)
			const metadataLength = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0)
			if (!metadataLength || metadataLength > 4096) throw new Error('预览流头无效')
			const metadata = JSON.parse(new TextDecoder().decode(await reader.readExact(metadataLength))) as {
				requestId: number
				originalBytes: number
				modifiedBytes: number
				contentType?: string
			}
			if (!Number.isSafeInteger(metadata.requestId) || metadata.requestId <= 0) throw new Error('预览流 requestId 无效')
			requestId = metadata.requestId
			const isImage = metadata.contentType?.startsWith('image/') === true
			const limit = isImage ? 16 * 1024 * 1024 : 2 * 1024 * 1024
			if (![metadata.originalBytes, metadata.modifiedBytes].every(value => Number.isSafeInteger(value) && value >= 0 && value <= limit))
				throw new Error('预览流长度无效')
			const originalBytes = await reader.readExact(metadata.originalBytes)
			const modifiedBytes = await reader.readExact(metadata.modifiedBytes)
			const preview = this.streams.get(requestId)
			if (preview && preview.kind !== (isImage ? 'image' : 'text')) throw new Error('预览流类型不匹配')
			if (isImage) {
				if (metadata.originalBytes) throw new Error('图片预览流无效')
				preview?.resolve(new Blob([modifiedBytes.buffer], { type: metadata.contentType }))
			} else {
				const decoder = new TextDecoder('utf-8', { fatal: true })
				preview?.resolve({ original: decoder.decode(originalBytes), modified: decoder.decode(modifiedBytes) })
			}
			this.streams.delete(requestId)
		} catch (error) {
			const normalized = normalizeError(error)
			if (requestId !== null) {
				this.streams.get(requestId)?.reject(normalized)
				this.streams.delete(requestId)
			} else this.failStreams(normalized)
		} finally {
			reader.release()
		}
	}

	private async writeFrame(value: unknown) {
		if (!this.writer) throw new Error('版本控制器尚未连接')
		const body = new TextEncoder().encode(JSON.stringify(value))
		if (!body.byteLength || body.byteLength > 64 * 1024) throw new Error('版本控制器命令过大')
		const frame = new Uint8Array(body.byteLength + 4)
		new DataView(frame.buffer).setUint32(0, body.byteLength)
		frame.set(body, 4)
		await this.writer.write(frame)
	}

	private failAll(error: Error) {
		this.helloResolver?.reject(error)
		this.helloResolver = null
		for (const pending of this.pending.values()) pending.reject(error)
		for (const preview of this.streams.values()) preview.reject(error)
		this.pending.clear()
		this.streams.clear()
	}

	private failStreams(error: Error) {
		for (const preview of this.streams.values()) preview.reject(error)
		this.streams.clear()
	}
}

function normalizeError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error))
}

function compactFileSelection(selectedFileIds: number[], totalFiles: number) {
	const included = ranges([...selectedFileIds].sort((left, right) => left - right))
	const excluded: Array<[number, number]> = []
	let cursor = 0
	for (const [start, end] of included) {
		if (cursor < start) excluded.push([cursor, start - 1])
		cursor = end + 1
	}
	if (cursor < totalFiles) excluded.push([cursor, totalFiles - 1])
	return excluded.length < included.length ? { mode: 'exclude', ranges: excluded } : { mode: 'include', ranges: included }
}

function ranges(ids: number[]) {
	const result: Array<[number, number]> = []
	for (const id of ids) {
		const last = result.at(-1)
		if (last && id <= last[1] + 1) last[1] = Math.max(last[1], id)
		else result.push([id, id])
	}
	return result
}
