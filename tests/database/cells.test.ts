import { describe, expect, it } from 'vitest'
import { cellText, formattedJson, isJson, selectionClipboard } from '../../src/lib/database/cells'

describe('database cell values and clipboard', () => {
	it('keeps a single value verbatim including whitespace, tabs, quotes and newlines', () => {
		const text = '  long\tvalue\n"quoted"\r\nend  '
		expect(selectionClipboard([[text]], { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } })).toEqual({ text })
	})
	it('copies a reverse rectangular selection in row/column order, escaping multi-line TSV and HTML', () => {
		const payload = selectionClipboard(
			[
				[1, 'a\tb', '<img src=x onerror=alert(1)>'],
				[2, 'line\nbreak', '"quoted"']
			],
			{ anchor: { row: 1, column: 2 }, focus: { row: 0, column: 1 } }
		)
		expect(payload.text).toBe('"a\tb"\t<img src=x onerror=alert(1)>\n"line\nbreak"\t"""quoted"""')
		expect(payload.html).toContain('&lt;img')
		expect(payload.html).not.toContain('<img')
	})
	it('distinguishes null and empty values and preserves exact integers', () => {
		expect(cellText(null)).toBe('NULL')
		expect(cellText('')).toBe('')
		expect(cellText(9223372036854775807n)).toBe('9223372036854775807')
	})
	it('labels binary values as previews instead of claiming complete bytes', () => {
		expect(cellText({ blobBytes: 2000, preview: '00 ff' })).toContain('32 bytes preview')
	})
	it('formats JSON without changing numbers, duplicate properties or escape sequences', () => {
		const text = '{"n":9223372036854775807,"decimal":1.0000,"word":"\\u4e2d","key":1,"key":2}'
		const result = formattedJson(text)
		expect(result).toContain('\n')
		for (const value of ['9223372036854775807', '1.0000', '\\u4e2d', '"key": 1', '"key": 2']) expect(result).toContain(value)
		expect(isJson(text)).toBe(true)
		expect(isJson('{broken')).toBe(false)
	})
})
