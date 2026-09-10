import { describe, expect, it } from 'vitest'
import { officeFormat, resolveTarget, inspectPackage } from '../../src/lib/office-compress/package'
import { readPart, type Entry } from '../../src/lib/office-compress/zip'

function entry(filename: string, content = new Uint8Array([1, 2, 3])): Entry {
	return {
		filename, directory: false, encrypted: false, uncompressedSize: content.length,
		compressedSize: content.length, compressionMethod: 0, signature: 0,
		lastModDate: new Date(0), comment: '',
		async getData(target) {
			const writer = (target as WritableStream<Uint8Array>).getWriter()
			try { await writer.write(content); await writer.close() }
			finally { writer.releaseLock() }
		}
	}
}

describe('Office package boundaries', () => {
	it('supports the three modern formats without accepting old binary documents', () => {
		for (const extension of ['pptx', 'docx', 'xlsx']) expect(officeFormat(`演示.${extension.toUpperCase()}`)).toBe(extension)
		for (const extension of ['ppt', 'doc', 'xls', 'pptm', 'zip']) expect(() => officeFormat(`test.${extension}`)).toThrow()
	})
	it('resolves slide, header and spreadsheet drawing relationships relative to their owners', () => {
		expect(resolveTarget('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
		expect(resolveTarget('word/header1.xml', 'media/image1.jpeg')).toBe('word/media/image1.jpeg')
		expect(resolveTarget('xl/drawings/drawing1.xml', '../media/image1.png')).toBe('xl/media/image1.png')
		expect(resolveTarget('', '/word/document.xml')).toBe('word/document.xml')
	})
	it('rejects traversal, encoded separators and external URLs masquerading as internal targets', () => {
		for (const target of ['../../outside.png', '%2e%2e/%2e%2e/outside.png', 'media%2fimage.png', 'https://host/image.png', '//host/image.png', 'media\\image.png']) {
			expect(() => resolveTarget('word/document.xml', target)).toThrow()
		}
	})
	it('rejects ambiguous, signed and encrypted packages before reading XML', async () => {
		const signal = new AbortController().signal
		await expect(inspectPackage([entry('word/a.xml'), entry('word/A.xml')], 'docx', signal)).rejects.toThrow('重复')
		await expect(inspectPackage([entry('_xmlsignatures/sig1.xml')], 'docx', signal)).rejects.toThrow('签名')
		await expect(inspectPackage([{ ...entry('word/document.xml'), encrypted: true }], 'docx', signal)).rejects.toThrow('加密')
	})
	it('retains exact extracted bytes and rejects oversized or truncated parts', async () => {
		const signal = new AbortController().signal
		const source = entry('word/media/image1.png')
		expect(new Uint8Array(await (await readPart(source, signal, 10)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		await expect(readPart(source, signal, 2)).rejects.toThrow('过大')
		await expect(readPart({ ...source, uncompressedSize: 2 }, signal, 10)).rejects.toThrow('声明大小')
		await expect(readPart({ ...source, uncompressedSize: 4 }, signal, 10)).rejects.toThrow('不完整')
	})
	it('does not swallow cancellation while extracting a part', async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(readPart(entry('word/media/image1.png'), controller.signal, 10)).rejects.toMatchObject({ name: 'AbortError' })
	})
})
