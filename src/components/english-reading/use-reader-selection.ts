'use client'

import { useEffect, useRef, type RefObject, type ReactNode } from 'react'
import { createReadingTextIndex, isReadingTextTarget } from '@/lib/reading-translation/text-selection'
import type { ReadingSelection } from '@/lib/reading-translation/types'

const HOLD_MS = 350
const SLOP_PX = 8

export function useReaderSelection({ rootRef, enabled, customTouchSelection, content, onPreview, onSelect, onCancel }: {
	rootRef: RefObject<HTMLDivElement | null>
	enabled: boolean
	customTouchSelection: boolean
	content: ReactNode
	onPreview: (selection: ReadingSelection) => void
	onSelect: (selection: ReadingSelection) => void
	onCancel: () => void
}) {
	const callbacks = useRef({ onPreview, onSelect, onCancel })
	useEffect(() => { callbacks.current = { onPreview, onSelect, onCancel } }, [onPreview, onSelect, onCancel])

	useEffect(() => {
		const root = rootRef.current
		if (!root || !enabled) return
		const index = createReadingTextIndex(root)
		type Word = NonNullable<ReturnType<typeof index.wordAtPoint>>
		let gesture: { id: number; x: number; y: number; anchor: Word; focus: Word; selecting: boolean } | null = null
		let mouse: { x: number; y: number } | null = null
		let holdTimer = 0
		let moveFrame = 0
		let ignoreMouseUntil = 0
		const reset = () => {
			window.clearTimeout(holdTimer)
			window.cancelAnimationFrame(moveFrame)
			holdTimer = moveFrame = 0
			gesture = null
		}
		const publish = (preview: boolean) => {
			if (!gesture) return
			const selection = index.select(gesture.anchor, gesture.focus)
			if (selection) callbacks.current[preview ? 'onPreview' : 'onSelect'](selection)
		}
		const cancelGesture = () => {
			const wasSelecting = gesture?.selecting
			reset()
			mouse = null
			if (wasSelecting) callbacks.current.onCancel()
		}
		const onTouchStart = (event: TouchEvent) => {
			cancelGesture()
			ignoreMouseUntil = performance.now() + 1000
			if (!customTouchSelection) return
			if (event.touches.length !== 1 || !isReadingTextTarget(root, event.target)) return
			const touch = event.touches[0]
			const anchor = index.wordAtPoint(touch.clientX, touch.clientY)
			if (!anchor) return
			// Disable native text menus in this reading surface, without disabling page scrolling.
			root.dataset.touchReading = 'true'
			gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, anchor, focus: anchor, selecting: false }
			holdTimer = window.setTimeout(() => {
				if (!gesture) return
				gesture.selecting = true
				window.getSelection()?.removeAllRanges()
				publish(true)
			}, HOLD_MS)
		}
		const onTouchMove = (event: TouchEvent) => {
			if (!gesture) return
			if (event.touches.length !== 1) { cancelGesture(); return }
			const touch = Array.from(event.touches).find(item => item.identifier === gesture?.id)
			if (!touch) return
			if (!gesture.selecting) {
				if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > SLOP_PX) reset()
				return
			}
			// touch-action cannot be changed retroactively. Claim a held touch with a non-passive move listener.
			if (!event.cancelable) { cancelGesture(); return }
			event.preventDefault()
			window.cancelAnimationFrame(moveFrame)
			moveFrame = window.requestAnimationFrame(() => {
				if (!gesture) return
				gesture.focus = index.wordAtPoint(touch.clientX, touch.clientY) || gesture.focus
				publish(true)
			})
		}
		const onTouchEnd = (event: TouchEvent) => {
			ignoreMouseUntil = performance.now() + 1000
			if (!gesture) return
			if (event.touches.length) { cancelGesture(); return }
			const touch = Array.from(event.changedTouches).find(item => item.identifier === gesture?.id)
			if (!touch) return
			if (event.cancelable) event.preventDefault()
			if (gesture.selecting) gesture.focus = index.wordAtPoint(touch.clientX, touch.clientY) || gesture.focus
			publish(false)
			reset()
		}
		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'touch' || event.button !== 0 || performance.now() < ignoreMouseUntil) return
			delete root.dataset.touchReading
			if (isReadingTextTarget(root, event.target)) mouse = { x: event.clientX, y: event.clientY }
		}
		const onPointerUp = (event: PointerEvent) => {
			if (!mouse || event.pointerType === 'touch') return
			const start = mouse
			mouse = null
			if (event.button !== 0) return
			const selected = index.fromNativeSelection()
			if (selected) { callbacks.current.onSelect(selected); return }
			if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) return
			const word = index.wordAtPoint(event.clientX, event.clientY)
			const selection = word && index.select(word, word)
			if (selection) callbacks.current.onSelect(selection)
		}
		const onContextMenu = (event: Event) => {
			if (root.dataset.touchReading && isReadingTextTarget(root, event.target)) event.preventDefault()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') { cancelGesture(); return }
			if (event.key !== 'Enter' || !event.altKey) return
			const selection = index.fromNativeSelection()
			if (selection) { event.preventDefault(); callbacks.current.onSelect(selection) }
		}
		const onScroll = () => { if (gesture) cancelGesture() }
		root.addEventListener('touchstart', onTouchStart, { passive: true })
		root.addEventListener('touchmove', onTouchMove, { passive: false })
		root.addEventListener('touchend', onTouchEnd, { passive: false })
		root.addEventListener('touchcancel', cancelGesture)
		root.addEventListener('contextmenu', onContextMenu)
		root.addEventListener('selectstart', onContextMenu)
		root.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('pointercancel', cancelGesture)
		document.addEventListener('keydown', onKeyDown)
		window.addEventListener('scroll', onScroll, { passive: true })
		window.addEventListener('blur', cancelGesture)
		return () => {
			reset()
			delete root.dataset.touchReading
			root.removeEventListener('touchstart', onTouchStart)
			root.removeEventListener('touchmove', onTouchMove)
			root.removeEventListener('touchend', onTouchEnd)
			root.removeEventListener('touchcancel', cancelGesture)
			root.removeEventListener('contextmenu', onContextMenu)
			root.removeEventListener('selectstart', onContextMenu)
			root.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('pointercancel', cancelGesture)
			document.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('scroll', onScroll)
			window.removeEventListener('blur', cancelGesture)
		}
	}, [rootRef, enabled, customTouchSelection, content])
}
