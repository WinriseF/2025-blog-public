export type ZipSelectionState = 'checked' | 'mixed' | 'unchecked'

export type ZipCompressionOptions = {
	level: number
	skipAlreadyCompressed: boolean
}

export type ZipNode = {
	id: string
	parentId: string | null
	children: string[]
	name: string
	path: string
	kind: 'directory' | 'file'
	size: number
	lastModified: number
	suggestedExcluded: boolean
	loaded?: boolean
	handle?: FileSystemFileHandle
	directoryHandle?: FileSystemDirectoryHandle
	file?: File
}

export type ZipScanResult = {
	rootId: string
	rootName: string
	rootHandle?: FileSystemDirectoryHandle
	nodes: ZipNode[]
	totalBytes: number
	unloadedDirectories: number
}

export type ZipSelectionAnalysis = {
	states: Map<string, ZipSelectionState>
	stats: { files: number; bytes: number }
}

export type ZipWriteProgress = {
	currentFile: string
	processedFiles: number
	totalFiles: number
	processedBytes: number
	totalBytes: number
	elapsedMs: number
}

type DirectoryHandle = FileSystemDirectoryHandle & {
	entries(): AsyncIterableIterator<[string, DirectoryHandle | FileSystemFileHandle]>
}

type ZipWriter = {
	add(name: string, reader?: unknown, options?: {
		directory?: boolean
		lastModDate?: Date
		level?: number
		signal?: AbortSignal
		onprogress?: (current: number) => void
	}): Promise<void>
	close(): Promise<void>
}

type ZipRuntime = {
	BlobReader: new (blob: Blob) => unknown
	ZipWriter: new (writer: WritableStream<Uint8Array>, options: { keepOrder: boolean; useWebWorkers: boolean }) => ZipWriter
	terminateWorkers(): void
}

const DEFAULT_EXCLUDES = new Set(['.git', '.svn', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'target', '.idea', '__pycache__', '.venv'])
const ALREADY_COMPRESSED = new Set([
	'7z', 'aac', 'apk', 'avif', 'br', 'bz2', 'flac', 'gif', 'gz', 'heic', 'jpeg', 'jpg', 'm4a', 'm4v', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'pdf', 'png', 'rar', 'webm', 'webp', 'woff', 'woff2', 'xz', 'zip'
])
const SCAN_PROGRESS_INTERVAL = 100
const ZIP_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8.59/index-native.min.js'
let zipRuntimePromise: Promise<ZipRuntime> | undefined

export async function scanZipDirectory(directory: FileSystemDirectoryHandle, signal: AbortSignal, onProgress: (files: number, bytes: number) => void = () => {}) {
	const rootHandle = directory as DirectoryHandle
	const root = createDirectoryNode(rootHandle, null, rootHandle.name, false, true)
	const nodes = [root]
	const fileNodes: ZipNode[] = []

	await scanDirectoryChildren(root, rootHandle, nodes, fileNodes, signal)
	await readFileMetadata(fileNodes, signal, onProgress)

	return { ...buildScanResult(rootHandle.name, nodes), rootHandle: directory }
}

export async function loadZipDirectory(scan: ZipScanResult, directoryId: string, signal: AbortSignal, onProgress: (files: number, bytes: number) => void = () => {}) {
	const index = scan.nodes.findIndex(node => node.id === directoryId)
	const current = scan.nodes[index]
	if (!current || current.kind !== 'directory') throw new Error('找不到待读取的目录')
	if (current.loaded) return scan
	if (!current.directoryHandle) throw new Error(`无法读取 ${current.path}`)

	const nodes = scan.nodes.slice()
	const directory = { ...current, children: [], loaded: true }
	nodes[index] = directory
	const fileNodes: ZipNode[] = []
	await scanDirectoryChildren(directory, current.directoryHandle as DirectoryHandle, nodes, fileNodes, signal)
	await readFileMetadata(fileNodes, signal, onProgress)

	return { ...buildScanResult(scan.rootName, nodes, scan.rootId), rootHandle: scan.rootHandle }
}

export function scanZipFiles(files: File[]): ZipScanResult {
	const rootName = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') || 'archive' : 'archive'
	const nodes = files.map((file, index): ZipNode => ({
		id: `${index}:${file.name}`,
		parentId: null,
		children: [],
		name: file.name,
		path: file.name,
		kind: 'file',
		size: file.size,
		lastModified: file.lastModified,
		suggestedExcluded: false,
		file
	}))
	return buildScanResult(rootName, nodes, '')
}

export function initialZipSelection(nodes: ZipNode[]) {
	return new Set(nodes.filter(node => !node.suggestedExcluded).map(node => node.id))
}

export function analyzeZipSelection(nodes: ZipNode[], selected: Set<string>): ZipSelectionAnalysis {
	const states = new Map<string, ZipSelectionState>()
	let files = 0
	let bytes = 0
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index]
		if (node.kind === 'file' || !node.children.length) {
			const state = selected.has(node.id) ? 'checked' : 'unchecked'
			states.set(node.id, state)
			if (node.kind === 'file' && state === 'checked') {
				files += 1
				bytes += node.size
			}
			continue
		}
		const childStates = node.children.map(id => states.get(id) || 'unchecked')
		states.set(node.id, childStates.every(state => state === 'checked') ? 'checked' : childStates.every(state => state === 'unchecked') ? 'unchecked' : 'mixed')
	}
	return { states, stats: { files, bytes } }
}

export function toggleZipSubtree(nodesById: Map<string, ZipNode>, selected: Set<string>, id: string, checked: boolean) {
	const next = new Set(selected)
	const pending = [id]
	while (pending.length) {
		const currentId = pending.pop()!
		const node = nodesById.get(currentId)
		if (!node) continue
		if (checked) next.add(currentId)
		else next.delete(currentId)
		pending.push(...node.children)
	}
	return next
}

export function selectedZipEntries(nodes: ZipNode[], states: Map<string, ZipSelectionState>) {
	return new Set(nodes.filter(node => states.get(node.id) !== 'unchecked').map(node => node.id))
}

export function suggestedZipName(name: string) {
	const safe = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').trim() || 'archive'
	return `${safe}.zip`
}

export async function writeZipArchive(options: {
	scan: ZipScanResult
	selectedIds: Set<string>
	compression: ZipCompressionOptions
	includeRoot: boolean
	outputHandle: FileSystemFileHandle
	signal: AbortSignal
	onProgress: (progress: ZipWriteProgress) => void
}) {
	const { scan, selectedIds, compression, includeRoot, outputHandle, signal, onProgress } = options
	if (scan.nodes.some(node => node.kind === 'directory' && !node.loaded && selectedIds.has(node.id))) throw new Error('仍有已选目录尚未读取完成')
	const selectedFiles = scan.nodes.filter(node => node.kind === 'file' && selectedIds.has(node.id))
	const totalBytes = selectedFiles.reduce((total, node) => total + node.size, 0)
	if (scan.rootHandle) {
		const outputPath = await scan.rootHandle.resolve(outputHandle)
		if (outputPath && selectedIds.has(`${scan.rootName}/${outputPath.join('/')}`)) throw new Error('输出 ZIP 不能同时作为输入文件，请更换文件名或保存位置')
	}
	const { BlobReader, ZipWriter, terminateWorkers } = await loadZipRuntime()
	const output = await outputHandle.createWritable()
	const startedAt = performance.now()
	let processedBytes = 0
	let processedFiles = 0
	let lastUpdate = 0

	const report = (currentFile: string, force = false) => {
		const now = performance.now()
		if (!force && now - lastUpdate < 120) return
		lastUpdate = now
		onProgress({ currentFile, processedFiles, totalFiles: selectedFiles.length, processedBytes, totalBytes, elapsedMs: now - startedAt })
	}

	try {
		const writer = new ZipWriter(output, { keepOrder: true, useWebWorkers: true })
		for (const node of scan.nodes) {
			if (!selectedIds.has(node.id)) continue
			assertActive(signal)
			const entryPath = archiveEntryPath(node.path, scan.rootName, includeRoot)
			if (!entryPath) continue
			if (node.kind === 'directory') {
				await writer.add(`${entryPath}/`, undefined, { directory: true, signal })
				continue
			}

			const file = node.handle ? await node.handle.getFile() : node.file
			if (!file) throw new Error(`无法读取 ${node.path}`)
			if (file.size !== node.size || file.lastModified !== node.lastModified) throw new Error(`${node.path} 在扫描后发生变化，请重新选择目录`)
			let entryProgress = 0
			await writer.add(entryPath, new BlobReader(file), {
				level: zipLevel(node.name, compression),
				lastModDate: new Date(file.lastModified),
				signal,
				onprogress(current) {
					processedBytes += Math.max(0, current - entryProgress)
					entryProgress = current
					report(node.path)
				}
			})
			processedBytes += Math.max(0, file.size - entryProgress)
			processedFiles += 1
			report(node.path, true)
		}
		await writer.close()
		const result = await outputHandle.getFile()
		return { outputBytes: result.size, elapsedMs: performance.now() - startedAt }
	} catch (error) {
		try {
			await output.abort(error)
		} catch {
			// The stream may already be closed or aborted.
		}
		throw error
	} finally {
		void terminateWorkers()
	}
}

export function preloadZipRuntime() {
	void loadZipRuntime().catch(() => undefined)
}

async function scanDirectoryChildren(parent: ZipNode, directory: DirectoryHandle, nodes: ZipNode[], fileNodes: ZipNode[], signal: AbortSignal) {
	assertActive(signal)
	const entries: Array<[string, DirectoryHandle | FileSystemFileHandle]> = []
	for await (const entry of directory.entries()) entries.push(entry)
	entries.sort(([leftName, left], [rightName, right]) => left.kind === right.kind ? leftName.localeCompare(rightName, 'zh-CN', { numeric: true }) : left.kind === 'directory' ? -1 : 1)

	for (const [name, child] of entries) {
		assertActive(signal)
		const childPath = `${parent.path}/${name}`
		const suggestedExcluded = parent.suggestedExcluded || (child.kind === 'directory' && DEFAULT_EXCLUDES.has(name))
		parent.children.push(childPath)
		if (child.kind === 'directory') {
			const childDirectory = createDirectoryNode(child as DirectoryHandle, parent.id, childPath, suggestedExcluded, !suggestedExcluded)
			nodes.push(childDirectory)
			if (childDirectory.loaded) await scanDirectoryChildren(childDirectory, child as DirectoryHandle, nodes, fileNodes, signal)
			continue
		}
		const fileNode: ZipNode = {
			id: childPath,
			parentId: parent.id,
			children: [],
			name,
			path: childPath,
			kind: 'file',
			size: 0,
			lastModified: 0,
			suggestedExcluded,
			handle: child as FileSystemFileHandle
		}
		nodes.push(fileNode)
		fileNodes.push(fileNode)
	}
}

async function readFileMetadata(nodes: ZipNode[], signal: AbortSignal, onProgress: (files: number, bytes: number) => void) {
	let filesRead = 0
	let bytesRead = 0
	let lastUpdate = 0
	const report = (force = false) => {
		const now = performance.now()
		if (!force && now - lastUpdate < SCAN_PROGRESS_INTERVAL) return
		lastUpdate = now
		onProgress(filesRead, bytesRead)
	}

	await mapLimit(nodes, 12, async node => {
		assertActive(signal)
		const file = await node.handle!.getFile()
		node.size = file.size
		node.lastModified = file.lastModified
		filesRead += 1
		bytesRead += file.size
		report()
	})
	report(true)
}

function createDirectoryNode(handle: DirectoryHandle, parentId: string | null, path: string, suggestedExcluded: boolean, loaded: boolean): ZipNode {
	return {
		id: path,
		parentId,
		children: [],
		name: handle.name,
		path,
		kind: 'directory',
		size: 0,
		lastModified: 0,
		suggestedExcluded,
		loaded,
		directoryHandle: handle
	}
}

async function loadZipRuntime() {
	if (!zipRuntimePromise) zipRuntimePromise = import(/* webpackIgnore: true */ ZIP_RUNTIME_URL) as Promise<ZipRuntime>
	try {
		return await zipRuntimePromise
	} catch {
		zipRuntimePromise = undefined
		throw new Error('压缩内核加载失败，请检查网络后重试')
	}
}

function buildScanResult(rootName: string, nodes: ZipNode[], rootId = rootName): Omit<ZipScanResult, 'rootHandle'> {
	let totalBytes = 0
	let unloadedDirectories = 0
	for (const node of nodes) {
		if (node.kind === 'file') totalBytes += node.size
		if (node.kind === 'directory' && !node.loaded) unloadedDirectories += 1
	}
	return { rootId, rootName, nodes, totalBytes, unloadedDirectories }
}

function archiveEntryPath(path: string, rootName: string, includeRoot: boolean) {
	const value = includeRoot ? path : path === rootName ? '' : path.startsWith(`${rootName}/`) ? path.slice(rootName.length + 1) : path
	const parts = value.replace(/\\/g, '/').split('/').filter(Boolean)
	if (parts.some(part => part === '.' || part === '..')) throw new Error(`不安全的 ZIP 路径：${path}`)
	return parts.join('/')
}

function zipLevel(name: string, compression: ZipCompressionOptions) {
	if (compression.level === 0) return 0
	const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
	if (compression.skipAlreadyCompressed && ALREADY_COMPRESSED.has(extension)) return 0
	return compression.level
}

function assertActive(signal: AbortSignal) {
	if (signal.aborted) throw signal.reason || new DOMException('任务已取消', 'AbortError')
}

async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
	let nextIndex = 0
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (nextIndex < items.length) {
			const item = items[nextIndex]
			nextIndex += 1
			await task(item)
		}
	}))
}
