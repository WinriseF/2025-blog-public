import { DATABASE_OPERATION_TIMEOUT_MS, DATABASE_TIMEOUT_MESSAGE, type DatabaseCommand, type DatabaseInfo, type DatabaseResponse } from './types'

export async function cleanDatabaseScratch() {
	const root = await navigator.storage.getDirectory()
	let directory: FileSystemDirectoryHandle
	try {
		directory = await root.getDirectoryHandle('database-viewer')
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotFoundError') return
		throw error
	}
	const entries = directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }
	for await (const name of entries.keys()) {
		await navigator.locks.request(`database-viewer:${name}`, { ifAvailable: true }, async lock => {
			if (!lock) return
			for (let attempt = 0; ; attempt++) {
				try {
					await directory.removeEntry(name, { recursive: true })
					break
				} catch (error) {
					if (error instanceof DOMException && error.name === 'NotFoundError') break
					if (!(error instanceof DOMException) || error.name !== 'NoModificationAllowedError' || attempt >= 8) throw error
					// Chrome releases a terminated Worker's sync handles asynchronously.
					await new Promise(resolve => setTimeout(resolve, Math.min(50 * 2 ** attempt, 1000)))
				}
			}
		})
	}
}

export class DatabaseClient {
	private worker: Worker | undefined
	private sequence = 0
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
	private file: File | undefined
	private needsReopen = false
	private releaseLock: (() => void) | undefined
	private epoch = 0

	async open(file: File): Promise<DatabaseInfo> {
		this.terminate()
		this.file = file
		const epoch = this.epoch
		if (!navigator.storage?.getDirectory || !navigator.locks) throw new Error('请使用桌面 Chrome 或 Edge，并允许浏览器本地存储。')
		await cleanDatabaseScratch()
		if (epoch !== this.epoch) throw new Error('操作已取消。')
		const session = crypto.randomUUID()
		await new Promise<void>((resolve, reject) => {
			void navigator.locks
				.request(
					`database-viewer:${session}`,
					() =>
						new Promise<void>(release => {
							if (epoch !== this.epoch) {
								release()
								reject(new Error('操作已取消。'))
								return
							}
							this.releaseLock = release
							resolve()
						})
				)
				.catch(reject)
		})
		if (epoch !== this.epoch) throw new Error('操作已取消。')
		const worker = (this.worker = new Worker(new URL('./database.worker.ts', import.meta.url), { type: 'module' }))
		worker.onmessage = (event: MessageEvent<DatabaseResponse>) => {
			const message = event.data
			const pending = this.pending.get(message.id)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pending.delete(message.id)
			if (message.ok) pending.resolve(message.data)
			else pending.reject(new Error(message.error))
		}
		worker.onerror = event => {
			this.terminate(new Error(event.message || '数据库引擎加载或执行失败，请重新打开文件。'))
			this.needsReopen = true
		}
		this.needsReopen = false
		try {
			return await this.send<DatabaseInfo>({ type: 'open', file, session })
		} catch (error) {
			if (epoch === this.epoch) this.terminate()
			throw error
		}
	}

	async call<T>(command: DatabaseCommand): Promise<T> {
		if (this.needsReopen && this.file) {
			if (command.type === 'next') throw new Error('查询已取消，请重新运行 SQL。')
			await this.open(this.file)
		}
		return this.send<T>(command)
	}

	private send<T>(command: DatabaseCommand): Promise<T> {
		if (!this.worker) return Promise.reject(new Error('请先打开数据库。'))
		const id = ++this.sequence
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!this.pending.has(id)) return
				this.terminate(new Error(DATABASE_TIMEOUT_MESSAGE))
				this.needsReopen = !!this.file
			}, DATABASE_OPERATION_TIMEOUT_MS)
			this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
			this.worker!.postMessage({ ...command, id })
		})
	}

	cancel() {
		this.terminate()
		this.needsReopen = !!this.file
	}
	dispose() {
		this.terminate()
		this.file = undefined
		this.needsReopen = false
	}
	private terminate(error = new Error('操作已取消。')) {
		this.epoch++
		this.worker?.terminate()
		this.worker = undefined
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(error)
		}
		this.pending.clear()
		this.releaseLock?.()
		this.releaseLock = undefined
		// A stopped Worker's OPFS handles may be released after terminate returns.
		// Clean on the next open, when no live session owns the directory.
	}
}
