import { loadZipModule, type Entry, type Zip } from './zip-runtime'
import type { ZipNode } from './zip-packer'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const gb18030 = new TextDecoder('gb18030', { fatal: true })

// Returning undefined keeps zip.js's normal decoding, including its CP437 fallback.
export function decodeZipFilename(bytes: Uint8Array, encoding: string, type: string) {
	if (type !== 'filename' || encoding !== 'cp437' || !bytes.some(byte => byte >= 0x80)) return
	try {
		return utf8.decode(bytes)
	} catch {
		// Older Chinese ZIP tools often store GBK without an encoding flag.
	}
	// An isolated CP437 accent followed by a Latin letter can also be a valid GBK pair.
	if (!bytes.some((byte, i) => byte >= 0x80 && bytes[i + 1] >= 0x80)) return
	try {
		const name = gb18030.decode(bytes)
		if (/\p{Script=Han}/u.test(name)) return name
	} catch {
		return undefined
	}
}

export async function openZip(file: File, signal: AbortSignal) {
	const zip = await loadZipModule<Zip>()
	const reader = new zip.ZipReader(new zip.BlobReader(file), { decodeText: decodeZipFilename })
	const nodes = new Map<string, ZipNode>()
	const files = new Map<string, Entry>()
	try {
		for await (const entry of reader.getEntriesGenerator({ signal })) {
			signal.throwIfAborted()
			const path = entry.filename.replaceAll('\\', '/').replace(/\/$/, '')
			const parts = path.split('/')
			if (/^[A-Za-z]:/.test(path) || parts.some(part => !part || part === '..' || part.includes('\0'))) throw new Error(`无效的文件路径：${entry.filename}`)
			const names = parts.filter(part => part !== '.')
			let parentId: string | null = null
			for (const [index, name] of names.entries()) {
				const id: string = parentId ? parentId + '/' + name : name
				const kind = index === names.length - 1 && !entry.directory ? 'file' : 'directory'
				const existing = nodes.get(id)
				if (existing && (existing.kind !== kind || kind === 'file')) throw new Error(`压缩包内路径重复：${id}`)
				if (!existing) {
					nodes.set(id, {
						id,
						parentId,
						name,
						path: id,
						kind,
						children: [],
						loaded: true,
						suggestedExcluded: false,
						size: kind === 'file' ? entry.uncompressedSize : 0,
						lastModified: 0
					})
					if (parentId) nodes.get(parentId)!.children.push(id)
				}
				if (kind === 'file') files.set(id, entry)
				parentId = id
			}
		}
		signal.throwIfAborted()
		return { name: file.name, nodes: [...nodes.values()], rootId: '', files, close: () => reader.close() }
	} catch (error) {
		await reader.close()
		throw error
	}
}

export async function writeZipEntry(entry: Entry, handle: FileSystemFileHandle, signal: AbortSignal, password: string, onprogress?: (current: number, total: number) => void) {
	const output = await handle.createWritable()
	try {
		await entry.getData(output, { signal, password, checkSignature: true, preventClose: true, onprogress })
		signal.throwIfAborted()
		await output.close()
	} catch (error) {
		await output.abort().catch(() => {})
		throw error
	}
}

export async function extractToDirectory(
	archive: Awaited<ReturnType<typeof openZip>>,
	ids: Set<string>,
	target: FileSystemDirectoryHandle,
	signal: AbortSignal,
	password: string,
	onProgress: (path: string, completed: number, fraction: number) => void
) {
	const directories = new Map<string | null, FileSystemDirectoryHandle>([[null, target]])
	const files: ZipNode[] = []
	const paths = new Set<string>()
	let concurrency = 4
	for (const node of archive.nodes) {
		if (!ids.has(node.id)) continue
		signal.throwIfAborted()
		if (node.kind === 'directory') {
			const parent = directories.get(node.parentId)!
			directories.set(node.id, await parent.getDirectoryHandle(node.name, { create: true }))
		} else {
			// Some volumes map case or Unicode variants to the same file. Preserve archive order there.
			const path = node.path.normalize().toLowerCase()
			if (paths.has(path)) concurrency = 1
			paths.add(path)
			files.push(node)
		}
	}

	const stop = new AbortController()
	const active = AbortSignal.any([signal, stop.signal])
	const pending = files.values()
	const fractions = Array<number>(Math.min(concurrency, files.length)).fill(0)
	let saved = 0
	await Promise.all(fractions.map(async (_, slot) => {
		try {
			for (const node of pending) {
				active.throwIfAborted()
				const report = () => onProgress(node.path, saved, fractions.reduce((sum, n) => sum + n, 0))
				report()
				const handle = await directories.get(node.parentId)!.getFileHandle(node.name, { create: true })
				active.throwIfAborted()
				await writeZipEntry(archive.files.get(node.id)!, handle, active, password, (current, total) => {
					if (total && !active.aborted) {
						fractions[slot] = current / total
						report()
					}
				})
				fractions[slot] = 0
				saved++
				if (!active.aborted) report()
			}
		} catch (error) {
			stop.abort(error)
		}
	}))
	active.throwIfAborted()
	return saved
}
