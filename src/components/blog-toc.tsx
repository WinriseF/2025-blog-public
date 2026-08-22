'use client'

import clsx from 'clsx'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

type TocItem = {
	id: string
	text: string
	level: number
}

type BlogTocProps = {
	toc: TocItem[]
	delay?: number
}

export function BlogToc({ toc, delay = 0 }: BlogTocProps) {
	const activeIdsRef = useRef(new Set<string>())
	const [activeId, setActiveId] = useState<string>()
	const frameRef = useRef<number | null>(null)

	useEffect(() => {
		if (toc.length === 0) return

		activeIdsRef.current.clear()
		setActiveId(undefined)
		const observer = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					if (entry.isIntersecting) activeIdsRef.current.add(entry.target.id)
					else activeIdsRef.current.delete(entry.target.id)
				}

				// zero-visual coalesce: same frame dedupe, no extra renders
				if (frameRef.current !== null) return
				frameRef.current = window.requestAnimationFrame(() => {
					frameRef.current = null
					const nextActiveId = toc.find(item => activeIdsRef.current.has(item.id))?.id
					setActiveId(current => (current === nextActiveId ? current : nextActiveId))
				})
			},
			{
				rootMargin: '-100px 0px -100px 0px',
				threshold: 0
			}
		)

		for (const item of toc) {
			const element = document.getElementById(item.id)
			if (element) observer.observe(element)
		}

		return () => {
			observer.disconnect()
			activeIdsRef.current.clear()
			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current)
				frameRef.current = null
			}
		}
	}, [toc])

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.8 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ delay }}
			className='bg-card w-full rounded-xl border p-3 text-sm'>
			<h2 className='text-secondary mb-2 font-medium'>目录</h2>
			<div className='relative max-h-[300px] space-y-2 overflow-auto'>
				{toc.length === 0 && <div className='text-secondary'>暂无</div>}
				{toc.map(item => (
					<a
						key={item.id + item.level}
						href={`#${item.id}`}
						className={clsx('hover:text-brand relative block pl-3 transition-colors', item.id === activeId && 'text-brand')}
						style={{ paddingLeft: (item.level - 1) * 8 }}>
						{item.text}
					</a>
				))}
			</div>
		</motion.div>
	)
}
