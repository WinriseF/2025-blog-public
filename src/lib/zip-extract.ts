import { loadZipModule, type Entry, type Zip } from './zip-runtime'
import type { ZipNode } from './zip-packer'

export async function openZip(file: File, signal: AbortSignal) {
	const zip = await loadZipModule<Zip>()
	const reader = new zip.ZipReader(new zip.BlobReader(file))
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
	let saved = 0
	let skipped = 0
	for (const node of archive.nodes) {
		if (!ids.has(node.id)) continue
		signal.throwIfAborted()
		const parent = directories.get(node.parentId)!
		if (node.kind === 'directory') {
			directories.set(node.id, await parent.getDirectoryHandle(node.name, { create: true }))
			continue
		}
		onProgress(node.path, saved + skipped, 0)
		try {
			await parent.getFileHandle(node.name)
			skipped++
			continue
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
		}
		const handle = await parent.getFileHandle(node.name, { create: true })
		try {
			await writeZipEntry(archive.files.get(node.id)!, handle, signal, password, (current, total) => {
				if (total) onProgress(node.path, saved + skipped, current / total)
			})
		} catch (error) {
			await parent.removeEntry(node.name)
			throw error
		}
		saved++
	}
	return { saved, skipped }
}
