import { describe, expect, it, vi } from 'vitest'
import { BrowserDirectory, decodeText } from '../../src/lib/version-control/browser-directory'

function workspace(initial: string) {
	let disk = new Blob([initial])
	const createWritable = vi.fn(async () => {
		let pending: Uint8Array | null = null
		return {
			write: async (bytes: Uint8Array) => { pending = bytes },
			close: async () => { if (pending) disk = new Blob([pending as Uint8Array<ArrayBuffer>]) },
			abort: vi.fn()
		}
	})
	const getFileHandle = vi.fn(async () => ({ getFile: async () => disk, createWritable }))
	const handle = { name: 'project', getFileHandle, requestPermission: vi.fn(async () => 'granted') }
	const directory = new BrowserDirectory(handle as unknown as ConstructorParameters<typeof BrowserDirectory>[0])
	return { directory, handle, createWritable, disk: () => disk, replace: (text: string) => { disk = new Blob([text]) } }
}

describe('browser directory writes', () => {
	it('preserves UTF-8 BOM and CRLF while editing normalized text', async () => {
		const { directory, disk } = workspace('\uFEFF你好\r\nworld\r\n')
		const baseline = await directory.readText('file.txt')
		expect(baseline.content).toBe('你好\nworld\n')
		await directory.saveText('file.txt', '你好\nchanged\n', baseline)
		expect((await decodeText(disk())).raw).toBe('\uFEFF你好\r\nchanged\r\n')
	})

	it('does not open a writer when an external edit has occurred', async () => {
		const { directory, replace, createWritable } = workspace('old')
		const baseline = await directory.readText('file.txt')
		replace('external')
		expect(await directory.saveText('file.txt', 'mine', baseline)).toBeNull()
		expect(createWritable).not.toHaveBeenCalled()
	})

	it('does not request creation when opening an existing file', async () => {
		const { directory, handle } = workspace('old')
		await directory.readText('file.txt')
		expect(handle.getFileHandle).toHaveBeenCalledWith('file.txt')
	})

	it('rejects metadata paths, traversal, binary and invalid UTF-8 before editing', async () => {
		const { directory, handle } = workspace('text')
		for (const path of ['../file', '.git/config', '.svn/wc.db', 'C:/file', 'a\\b']) {
			await expect(directory.readText(path)).rejects.toThrow()
		}
		expect(handle.getFileHandle).not.toHaveBeenCalled()
		await expect(decodeText(new Blob(['a\0b']))).rejects.toThrow()
		await expect(decodeText(new Blob([new Uint8Array([0xff])]))).rejects.toThrow()
	})

	it('keeps writing disabled if the browser refuses permission', async () => {
		const { directory, handle } = workspace('text')
		handle.requestPermission.mockResolvedValue('denied')
		await expect(directory.enableWriting()).rejects.toThrow(/写入权限/)
	})

})
