import { expect, it } from 'vitest'
import { decodeZipFilename } from '../../src/lib/zip-extract'

it('reads unflagged GBK and UTF-8 filenames', () => {
	const gbk = Uint8Array.of(0x31, 0x2e, 0xd0, 0xf7, 0xc2, 0xdb, 0x2e, 0x70, 0x64, 0x66)
	expect(decodeZipFilename(gbk, 'cp437', 'filename')).toBe('1.绪论.pdf')
	const name = '资料/绪论.pdf'
	expect(decodeZipFilename(new TextEncoder().encode(name), 'cp437', 'filename')).toBe(name)
})

it('keeps explicit UTF-8, comments, ASCII and legacy Western names on the library decoder', () => {
	const bytes = new TextEncoder().encode('资料')
	expect(decodeZipFilename(bytes, 'utf-8', 'filename')).toBeUndefined()
	expect(decodeZipFilename(bytes, 'cp437', 'comment')).toBeUndefined()
	expect(decodeZipFilename(new TextEncoder().encode('README.md'), 'cp437', 'filename')).toBeUndefined()
	// grün — CP437 0x81 is ü, while 0x81 0x6e is also a valid GBK pair.
	expect(decodeZipFilename(Uint8Array.of(0x67, 0x72, 0x81, 0x6e), 'cp437', 'filename')).toBeUndefined()
})
