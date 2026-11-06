'use client'

import { useLayoutEffect, useRef } from 'react'
import { Copy, Rows3, TextCursorInput } from 'lucide-react'
import styles from './database.module.css'

export function CellMenu({
	x,
	y,
	preview,
	hasRange,
	onCopyValue,
	onCopyRange,
	onCopyRow,
	onView,
	onClose
}: {
	x: number
	y: number
	preview: boolean
	hasRange: boolean
	onCopyValue: () => void
	onCopyRange: () => void
	onCopyRow: () => void
	onView: () => void
	onClose: (restoreFocus: boolean) => void
}) {
	const menu = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const element = menu.current!
		element.showPopover()
		element.querySelector<HTMLButtonElement>('button')?.focus()
		const close = () => element.hidePopover()
		window.addEventListener('resize', close)
		document.addEventListener('scroll', close, true)
		return () => {
			window.removeEventListener('resize', close)
			document.removeEventListener('scroll', close, true)
		}
	}, [])
	return (
		<div
			ref={menu}
			role='menu'
			aria-label='单元格操作'
			popover='auto'
			className={styles.cellMenu}
			style={{ left: Math.max(8, Math.min(x, window.innerWidth - 228)), top: Math.max(8, Math.min(y, window.innerHeight - 160)) }}
			onToggle={event => {
				if ((event.nativeEvent as ToggleEvent).newState === 'closed') onClose(false)
			}}
			onKeyDown={event => {
				const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
				const index = items.indexOf(document.activeElement as HTMLButtonElement)
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault()
					items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
				}
				if (event.key === 'Escape' || event.key === 'Tab') {
					event.preventDefault()
					menu.current?.hidePopover()
					onClose(true)
				}
			}}>
			<button role='menuitem' onClick={onCopyValue}>
				<Copy size={13} />
				{preview ? '复制 BLOB 预览' : '复制值'}
			</button>
			<button role='menuitem' disabled={!hasRange} onClick={onCopyRange}>
				<Copy size={13} />
				复制选中区域
			</button>
			<button role='menuitem' onClick={onCopyRow}>
				<Rows3 size={13} />
				复制整行
			</button>
			<button role='menuitem' onClick={onView}>
				<TextCursorInput size={13} />
				{preview ? '查看 BLOB 预览' : '查看完整内容'}
			</button>
		</div>
	)
}
