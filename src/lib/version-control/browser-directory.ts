import type { WorkspaceFileSource, DirectoryPage } from './repository-data-source'
import type { RepositoryTreeEntry } from './types'

type DirectoryHandle = FileSystemDirectoryHandle & {
	values(): AsyncIterableIterator<FileSystemHandle>
	requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
type WritableFile = FileSystemFileHandle & {
	createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
export type TextSnapshot = { content: string; raw: string; bom: boolean; newline: '\n' | '\r\n' }
const TEXT_LIMIT = 2 * 1024 * 1024
const hiddenEntry = (name: string) => name === '.git' || name === '.svn'

export class BrowserDirectory implements WorkspaceFileSource {
	readonly source = 'browser-directory'
	readonly key = `browser-directory:${crypto.randomUUID()}`
	private directories = new Map<string, RepositoryTreeEntry[]>()

	constructor(readonly handle: DirectoryHandle) {}

	static async pick(mode: 'read' | 'readwrite' = 'read') {
		const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<DirectoryHandle> }).showDirectoryPicker
		if (!window.isSecureContext || !picker) throw new Error('请使用支持目录访问的 Chrome 或 Edge，通过 HTTPS 打开此页面。')
		return new BrowserDirectory(await picker.call(window, { id: 'version-control-workspace', mode }))
	}

	get name() { return this.handle.name }

	async enableWriting() {
		if (await this.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('未获得文件夹写入权限，仍保持只读。')
	}

	refresh() { this.directories.clear() }

	async getDirectory(path: string, cursor: string | null, limit = 96): Promise<DirectoryPage> {
		let entries = this.directories.get(path)
		if (!entries) {
			const directory = await this.directory(path)
			entries = []
			for await (const handle of directory.values()) {
				if (hiddenEntry(handle.name)) continue
				entries.push({ name: handle.name, path: path ? `${path}/${handle.name}` : handle.name, kind: handle.kind, size: null, isBinary: false })
			}
			entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
			this.directories.set(path, entries)
		}
		const start = Number(cursor || 0)
		const end = start + limit
		const items = entries.slice(start, end)
		await Promise.all(items.map(async entry => {
			if (entry.kind !== 'file' || entry.size !== null) return
			try { entry.size = (await (await this.file(entry.path)).getFile()).size } catch { /* Keep unreadable entries visible. */ }
		}))
		return { items, nextCursor: end < entries.length ? String(end) : null }
	}

	async openRepositoryFile(path: string) {
		const snapshot = await this.readText(path)
		return { path, content: snapshot.raw, size: new TextEncoder().encode(snapshot.raw).length }
	}

	async openRepositoryImage(path: string) {
		const file = await (await this.file(path)).getFile()
		if (file.size > 16 * 1024 * 1024) throw new Error('图片超过 16 MiB 预览限制')
		return file
	}

	async readText(path: string): Promise<TextSnapshot> {
		return decodeText(await (await this.file(path)).getFile())
	}

	async saveText(path: string, content: string, baseline: TextSnapshot): Promise<TextSnapshot | null> {
		const handle = await this.file(path) as WritableFile
		const current = await decodeText(await handle.getFile())
		if (current.raw !== baseline.raw) return null
		const raw = (baseline.bom ? '\uFEFF' : '') + content.replace(/\r\n|\r|\n/g, baseline.newline)
		const bytes = new TextEncoder().encode(raw)
		if (bytes.length > TEXT_LIMIT) throw new Error('文件超过 2 MiB 编辑限制')
		const writable = await handle.createWritable()
		try {
			await writable.write(bytes)
			await writable.close()
		} catch (error) {
			await writable.abort().catch(() => {})
			throw error
		}
		return { ...baseline, raw, content }
	}

	private async directory(path: string) {
		let directory = this.handle
		for (const name of parts(path)) directory = await directory.getDirectoryHandle(name) as DirectoryHandle
		return directory
	}

	private async file(path: string) {
		const names = parts(path)
		const name = names.pop()
		if (!name) throw new Error('文件路径为空')
		return (await this.directory(names.join('/'))).getFileHandle(name)
	}
}

function parts(path: string) {
	if (!path) return []
	const names = path.split('/')
	if (names.some(name => !name || name === '.' || name === '..' || /[\\:]/.test(name) || name === '.git' || name === '.svn')) throw new Error('无效文件路径')
	return names
}

export async function decodeText(file: Blob): Promise<TextSnapshot> {
	if (file.size > TEXT_LIMIT) throw new Error('文件超过 2 MiB 预览和编辑限制')
	const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
	if (raw.includes('\0')) throw new Error('二进制文件无法在线编辑')
	const bom = raw.startsWith('\uFEFF')
	return { raw, bom, newline: raw.includes('\r\n') ? '\r\n' : '\n', content: (bom ? raw.slice(1) : raw).replace(/\r\n|\r/g, '\n') }
}
