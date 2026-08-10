'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

type VirtualListProps<T> = {
	items: T[]
	estimateSize: number
	getKey: (item: T) => string
	renderItem: (item: T) => ReactNode
	empty?: ReactNode
	scrollToKey?: string
}

export function VirtualList<T>({ items, estimateSize, getKey, renderItem, empty, scrollToKey }: VirtualListProps<T>) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => estimateSize, overscan: 8, getItemKey: index => getKey(items[index]), useFlushSync: false })
	useEffect(() => {
		if (!scrollToKey) return
		const index = items.findIndex(item => getKey(item) === scrollToKey)
		if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
	}, [getKey, items, scrollToKey, virtualizer])

	if (!items.length) return <div className='text-secondary flex min-h-48 items-center justify-center border-y border-border px-6 text-center'>{empty ?? '没有匹配的记录'}</div>

	return (
		<div ref={scrollRef} className='h-[min(68vh,720px)] overflow-auto overscroll-contain border-t border-border pr-1 max-sm:h-[calc(100dvh-18rem)]'>
			<div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
				{virtualizer.getVirtualItems().map(row => {
					const item = items[row.index]
					return (
						<div
							key={getKey(item)}
							ref={virtualizer.measureElement}
							data-index={row.index}
							className='absolute top-0 left-0 w-full'
							style={{ transform: `translateY(${row.start}px)` }}>
							{renderItem(item)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
