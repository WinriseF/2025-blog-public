import { outputFileName } from './presets'
import { loadZipModule } from '../zip-runtime'
import type { ImageFormat } from './types'

const BLOB_ARCHIVE_SOFT_LIMIT = 350 * 1024 * 1024

type ZipWriterInstance = {
	add: (name: string, reader: unknown, options?: { level?: number; lastModDate?: Date }) => Promise<void>
	close: () => Promise<Blob | void>
}

type ZipRuntime = {
	BlobReader: new (blob: Blob) => unknown
	BlobWriter: new (mime?: string) => unknown
	ZipWriter: new (writer: unknown, options?: { keepOrder?: boolean; useWebWorkers?: boolean }) => ZipWriterInstance
	terminateWorkers: () => void
}

type ImageArchiveWritable = WritableStream<Uint8Array> & { abort: (reason?: unknown) => Promise<void> }
type ImageArchiveFileHandle = FileSystemFileHandle & { createWritable: () => Promise<ImageArchiveWritable> }
type SaveFilePicker = (options?: {
	suggestedName?: string
	types?: Array<{ description?: string; accept: Record<string, string[]> }>
}) => Promise<ImageArchiveFileHandle>

export type ImageArchiveEntry = {
	sourceName: string
	format: ImageFormat
	blob: Blob
	lastModified: number
}

async function loadZip() {
	return loadZipModule<ZipRuntime>()
}

function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function uniqueNames(entries: ImageArchiveEntry[]) {
	const seen = new Map<string, number>()
	return entries.map(entry => {
		const base = outputFileName(entry.sourceName, entry.format)
		const count = seen.get(base) ?? 0
		seen.set(base, count + 1)
		if (!count) return base
		return base.replace(/(\.[^.]+)$/, `-${count + 1}$1`)
	})
}

export function downloadImage(entry: ImageArchiveEntry) {
	downloadBlob(entry.blob, outputFileName(entry.sourceName, entry.format))
}

export async function downloadImageArchive(entries: ImageArchiveEntry[]) {
	if (!entries.length) return
	if (entries.length === 1) {
		downloadImage(entries[0])
		return
	}
	const names = uniqueNames(entries)
	const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
	let output: ImageArchiveWritable | null = null
	if (picker) {
		try {
			const handle = await picker.call(window, {
				suggestedName: 'compressed-images.zip',
				types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }]
			})
			output = await handle.createWritable()
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return
			throw error
		}
	}
	const totalBytes = entries.reduce((total, entry) => total + entry.blob.size, 0)
	if (!output && totalBytes > BLOB_ARCHIVE_SOFT_LIMIT) throw new Error('当前浏览器需要在内存中生成 ZIP；结果超过 350 MB，请逐个下载')

	let runtime: ZipRuntime | undefined
	try {
		runtime = await loadZip()
		const writerTarget = output ?? new runtime.BlobWriter('application/zip')
		const writer = new runtime.ZipWriter(writerTarget, { keepOrder: true, useWebWorkers: true })
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]
			await writer.add(names[index], new runtime.BlobReader(entry.blob), { level: 0, lastModDate: new Date(entry.lastModified) })
		}
		const blob = await writer.close()
		if (blob instanceof Blob) downloadBlob(blob, 'compressed-images.zip')
	} catch (error) {
		if (output) await output.abort(error).catch(() => {})
		throw error
	} finally {
		runtime?.terminateWorkers()
	}
}
