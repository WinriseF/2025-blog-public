import type { ImageCompressionPreset } from '../image-compress/types'
import { inspectPackage, officeFormat } from './package'
import { loadOfficeZip, readPart, type Entry } from './zip'

export type OfficeProgress = { stage: string; progress: number }

export async function compressOffice(file: File, options: {
	preset: ImageCompressionPreset
	signal: AbortSignal
	onProgress: (progress: OfficeProgress) => void
}): Promise<Blob> {
	const { signal, onProgress } = options
	const format = officeFormat(file.name)
	if (file.size > 350 * 1024 * 1024) throw new Error('当前浏览器内存下载模式最多支持 350 MB 文档')
	const header = new Uint8Array(await file.slice(0, 4).arrayBuffer())
	if (header[0] === 208 && header[1] === 207) throw new Error('文档已加密或使用旧版二进制格式，请先另存为未加密的 PPTX、DOCX 或 XLSX')
	if (header[0] !== 80 || header[1] !== 75 || header[2] !== 3 || header[3] !== 4) throw new Error('不是有效的 Office Open XML 文件')
	signal.throwIfAborted()
	onProgress({ stage: '读取文档结构', progress: 0.02 })
	const zip = await loadOfficeZip()
	signal.throwIfAborted()
	const reader = new zip.ZipReader(new zip.BlobReader(file), { useWebWorkers: false })
	let worker: Worker | undefined
	let outputBytes = 0
	const chunks: Uint8Array[] = []
	try {
		const entries: Entry[] = []
		for await (const entry of reader.getEntriesGenerator({ signal })) {
			signal.throwIfAborted()
			entries.push(entry)
			if (entries.length > 50_000) throw new Error('文档内部文件数量过多')
		}
		const images = await inspectPackage(entries, format, signal)
		let processed = 0
		const encode = (image: File) => new Promise<ArrayBuffer | null>((resolve, reject) => {
			signal.throwIfAborted()
			try { worker ??= new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }) }
			catch { resolve(null); return }
			const current = worker
			const cleanup = () => { signal.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; current.onmessageerror = null }
			const abort = () => { cleanup(); current.terminate(); worker = undefined; reject(signal.reason) }
			const fail = () => { cleanup(); current.terminate(); worker = undefined; resolve(null) }
			signal.addEventListener('abort', abort, { once: true })
			current.onmessage = (event: MessageEvent<ArrayBuffer | null>) => { cleanup(); resolve(event.data) }
			current.onerror = event => { event.preventDefault(); fail() }
			current.onmessageerror = fail
			try { current.postMessage({ file: image, preset: options.preset }) } catch { fail() }
		})
		const sink = new WritableStream<Uint8Array>({
			write(chunk) {
				signal.throwIfAborted()
				outputBytes += chunk.byteLength
				if (outputBytes > 350 * 1024 * 1024) throw new Error('输出超过浏览器内存下载上限')
				chunks.push(new Uint8Array(chunk))
			}
		})
		const writer = new zip.ZipWriter(sink, { keepOrder: true, useWebWorkers: false })
		for (let index = 0; index < entries.length; index++) {
			signal.throwIfAborted()
			const entry = entries[index]
			let replacement: Blob | undefined
			const mime = images.get(entry.filename)
			if (mime) {
				onProgress({ stage: `压缩图片 ${processed + 1} / ${images.size}`, progress: 0.1 + index / entries.length * 0.85 })
				if (entry.uncompressedSize <= 256 * 1024 * 1024) {
					// ZIP read/CRC failures are fatal; codec failures alone preserve the original image.
					const blob = await readPart(entry, signal, 256 * 1024 * 1024)
					const bytes = await encode(new File([blob], entry.filename, { type: mime }))
					if (bytes && bytes.byteLength < entry.compressedSize) replacement = new Blob([bytes])
				}
				processed++
			}
			const metadata = { directory: entry.directory, lastModDate: entry.lastModDate, comment: entry.comment, signal }
			if (replacement) await writer.add(entry.filename, new zip.BlobReader(replacement), { ...metadata, level: 0 })
			else if (entry.directory) await writer.add(entry.filename, undefined, metadata)
			else {
				const stream = new TransformStream<Uint8Array, Uint8Array>()
				const transfer = new AbortController()
				const abort = () => transfer.abort(signal.reason)
				signal.addEventListener('abort', abort, { once: true })
				const copying = entry.getData(stream.writable, { signal: transfer.signal, passThrough: true })
				const writing = writer.add(entry.filename, stream.readable, { ...metadata, signal: transfer.signal, passThrough: true, compressionMethod: entry.compressionMethod, uncompressedSize: entry.uncompressedSize, signature: entry.signature })
				try { await Promise.all([copying, writing]) }
				catch (error) { transfer.abort(error); await Promise.allSettled([copying, writing]); throw error }
				finally { signal.removeEventListener('abort', abort) }
			}
			onProgress({ stage: '写入文档', progress: 0.1 + (index + 1) / entries.length * 0.85 })
		}
		await writer.close()
		signal.throwIfAborted()
		const blob = outputBytes < file.size ? new Blob(chunks, { type: file.type || 'application/octet-stream' }) : file
		onProgress({ stage: '完成', progress: 1 })
		return blob
	} finally {
		worker?.terminate()
		await reader.close().catch(() => {})
	}
}
