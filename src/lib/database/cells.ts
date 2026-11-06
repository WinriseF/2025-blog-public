import { applyEdits, format } from 'jsonc-parser'
import type { CellValue } from './types'

export type CellPosition = { row: number; column: number }
export type CellSelection = { anchor: CellPosition; focus: CellPosition; wholeRows?: boolean }
export function selectionBounds(selection: CellSelection) {
	return {
		top: Math.min(selection.anchor.row, selection.focus.row),
		bottom: Math.max(selection.anchor.row, selection.focus.row),
		left: Math.min(selection.anchor.column, selection.focus.column),
		right: Math.max(selection.anchor.column, selection.focus.column)
	}
}
export function isBlob(value: CellValue): value is { blobBytes: number; preview: string } {
	return value !== null && typeof value === 'object'
}
export function cellText(value: CellValue) {
	if (value === null) return 'NULL'
	if (isBlob(value)) return `BLOB (${value.blobBytes.toLocaleString()} bytes; ${Math.min(32, value.blobBytes)} bytes preview) ${value.preview}`.trimEnd()
	return String(value)
}
export function isJson(text: string) {
	if (!/^[\s]*[\[{]/.test(text)) return false
	try {
		JSON.parse(text)
		return true
	} catch {
		return false
	}
}
export function formattedJson(text: string) {
	// Apply whitespace edits to the source, never stringify parsed JS numbers.
	return applyEdits(text, format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }))
}
export function selectionClipboard(rows: CellValue[][], selection: CellSelection) {
	const bounds = selectionBounds(selection)
	const selected = rows.slice(bounds.top, bounds.bottom + 1).map(row => row.slice(bounds.left, bounds.right + 1).map(cellText))
	if (selected.length === 1 && selected[0].length === 1) return { text: selected[0][0] }
	const quote = (text: string) => (/[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
	const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
	return {
		text: selected.map(row => row.map(quote).join('\t')).join('\n'),
		html:
			'<table>' +
			selected
				.map(row => '<tr>' + row.map(text => `<td style="white-space:pre-wrap;mso-number-format:'\\@'">${escape(text)}</td>`).join('') + '</tr>')
				.join('') +
			'</table>'
	}
}
export async function writeCellClipboard(payload: { text: string; html?: string }) {
	if (payload.html && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
		await navigator.clipboard.write([
			new ClipboardItem({ 'text/plain': new Blob([payload.text], { type: 'text/plain' }), 'text/html': new Blob([payload.html], { type: 'text/html' }) })
		])
	} else await navigator.clipboard.writeText(payload.text)
}
