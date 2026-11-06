'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { selectionBounds, type CellPosition, type CellSelection } from '@/lib/database/cells'

export function useCellSelection({
	container,
	rowCount,
	widths,
	onOpen,
	onMenu
}: {
	container: RefObject<HTMLDivElement | null>
	rowCount: number
	widths: number[]
	onOpen: () => void
	onMenu: (point: CellPosition, x: number, y: number) => void
}) {
	const [selection, setSelection] = useState<CellSelection | null>(null)
	const bounds = selection ? selectionBounds(selection) : null
	const drag = useRef<{
		anchor: CellPosition
		wholeRows: boolean
		bounds: DOMRect
		x: number
		y: number
		startX: number
		startY: number
		moved: boolean
	} | null>(null)
	const frame = useRef<number | null>(null)
	const latest = useRef({ widths, rowCount })
	latest.current = { widths, rowCount }
	function stopDrag() {
		drag.current = null
		if (frame.current !== null) cancelAnimationFrame(frame.current)
		frame.current = null
	}
	useEffect(() => stopDrag, [])
	function focusGrid() {
		container.current?.focus({ preventScroll: true })
	}
	function reveal(point: CellPosition) {
		const el = container.current
		if (!el) return
		const top = point.row * 28 + 30
		if (top < el.scrollTop + 30) el.scrollTop = top - 30
		else if (top + 28 > el.scrollTop + el.clientHeight) el.scrollTop = top + 28 - el.clientHeight
		const left = 44 + widths.slice(0, point.column).reduce((sum, value) => sum + value, 0)
		if (left < el.scrollLeft + 44) el.scrollLeft = left - 44
		else if (left + widths[point.column] > el.scrollLeft + el.clientWidth) el.scrollLeft = left + widths[point.column] - el.clientWidth
	}
	function select(point: CellPosition, extend = false, wholeRows = false) {
		const origin = extend && selection ? selection.anchor : point
		const anchor = wholeRows ? { row: origin.row, column: 0 } : origin
		setSelection({ anchor, focus: { ...point, column: wholeRows ? widths.length - 1 : point.column }, wholeRows })
		focusGrid()
		return anchor
	}
	function updateDrag() {
		frame.current = null
		const current = drag.current,
			el = container.current
		if (!current || !current.moved || !el) return
		const { bounds, x, y, anchor, wholeRows } = current
		const previousTop = el.scrollTop,
			previousLeft = el.scrollLeft
		const edge = 24
		const dx = x < bounds.left + 44 + edge ? -16 : x > bounds.right - edge ? 16 : 0
		const dy = y < bounds.top + 30 + edge ? -14 : y > bounds.bottom - edge ? 14 : 0
		if (dx && !wholeRows) el.scrollLeft += dx
		if (dy) el.scrollTop += dy
		const row = Math.max(
			0,
			Math.min(latest.current.rowCount - 1, Math.floor((Math.max(bounds.top + 30, Math.min(bounds.bottom - 1, y)) - bounds.top + el.scrollTop - 30) / 28))
		)
		const position = Math.max(44, Math.min(bounds.width - 1, x - bounds.left)) + el.scrollLeft
		let column = 0,
			right = 44 + latest.current.widths[0]
		while (column < latest.current.widths.length - 1 && position >= right) {
			column++
			right += latest.current.widths[column]
		}
		if (wholeRows) column = latest.current.widths.length - 1
		setSelection(previous => (previous?.focus.row === row && previous.focus.column === column ? previous : { anchor, focus: { row, column }, wholeRows }))
		if (el.scrollTop !== previousTop || el.scrollLeft !== previousLeft) frame.current = requestAnimationFrame(updateDrag)
	}
	function beginDrag(event: PointerEvent, point: CellPosition, wholeRows = false) {
		if (event.button !== 0 || !container.current) return
		event.preventDefault()
		stopDrag()
		const anchor = select(point, event.shiftKey, wholeRows)
		drag.current = {
			anchor,
			wholeRows,
			bounds: container.current.getBoundingClientRect(),
			x: event.clientX,
			y: event.clientY,
			startX: event.clientX,
			startY: event.clientY,
			moved: false
		}
		container.current.setPointerCapture(event.pointerId)
	}
	function moveDrag(event: PointerEvent) {
		if (!drag.current) return
		drag.current.x = event.clientX
		drag.current.y = event.clientY
		drag.current.moved ||= Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY) > 4
		if (frame.current === null) updateDrag()
	}
	function contains(point: CellPosition) {
		return !!bounds && point.row >= bounds.top && point.row <= bounds.bottom && point.column >= bounds.left && point.column <= bounds.right
	}
	function keyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.target !== event.currentTarget || !rowCount || !widths.length) return
		const point = selection?.focus || { row: 0, column: 0 }
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault()
			setSelection({ anchor: { row: 0, column: 0 }, focus: { row: rowCount - 1, column: widths.length - 1 } })
			return
		}
		if (event.key === 'Enter') {
			event.preventDefault()
			if (!selection) select(point)
			onOpen()
			return
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			setSelection(null)
			return
		}
		if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
			event.preventDefault()
			if (!selection) select(point)
			const box = container.current!.getBoundingClientRect()
			onMenu(point, box.left + 50, box.top + 50)
			return
		}
		let next = { ...point }
		switch (event.key) {
			case 'ArrowLeft':
				next.column--
				break
			case 'ArrowRight':
				next.column++
				break
			case 'ArrowUp':
				next.row--
				break
			case 'ArrowDown':
				next.row++
				break
			case 'Home':
				next.column = 0
				if (event.ctrlKey || event.metaKey) next.row = 0
				break
			case 'End':
				next.column = widths.length - 1
				if (event.ctrlKey || event.metaKey) next.row = rowCount - 1
				break
			case 'PageDown':
				next.row += Math.max(1, Math.floor((container.current!.clientHeight - 30) / 28))
				break
			case 'PageUp':
				next.row -= Math.max(1, Math.floor((container.current!.clientHeight - 30) / 28))
				break
			case 'Tab': {
				const index = point.row * widths.length + point.column + (event.shiftKey ? -1 : 1)
				if (index < 0 || index >= rowCount * widths.length) return
				next = { row: Math.floor(index / widths.length), column: index % widths.length }
				break
			}
			default:
				return
		}
		event.preventDefault()
		next.row = Math.max(0, Math.min(rowCount - 1, next.row))
		next.column = Math.max(0, Math.min(widths.length - 1, next.column))
		select(next, event.shiftKey && event.key !== 'Tab')
		reveal(next)
	}
	return { selection, bounds, setSelection, select, contains, beginDrag, moveDrag, stopDrag, keyDown, focusGrid }
}
