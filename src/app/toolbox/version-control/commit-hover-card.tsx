'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, GitCommit, Tag, User } from 'lucide-react'
import type { GraphCommit } from '@/lib/version-control/types'
import { GitRefBadges } from './git-ref-badges'

export function CommitHoverCard({
	anchorRect,
	commit,
	onMouseEnter,
	onMouseLeave
}: {
	anchorRect: DOMRect | null
	commit: GraphCommit | null
	onMouseEnter: () => void
	onMouseLeave: () => void
}) {
	const cardRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState({ top: 0, left: 0 })
	const [positioned, setPositioned] = useState(false)

	useLayoutEffect(() => {
		if (!anchorRect || !commit || !cardRef.current) {
			setPositioned(false)
			return
		}
		const card = cardRef.current.getBoundingClientRect()
		const padding = 12
		let left = anchorRect.right + padding
		let top = anchorRect.top - 6
		if (left + card.width > window.innerWidth - padding) left = anchorRect.left - card.width - padding
		if (top + card.height > window.innerHeight - padding) top = window.innerHeight - card.height - padding
		if (top < padding) top = padding
		setPosition({ top, left })
		setPositioned(true)
	}, [anchorRect, commit])

	if (!anchorRect || !commit) return null
	const date = formatCommitDate(commit.timestampMs, true)
	return createPortal(
		<div
			ref={cardRef}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			style={position}
			className={`fixed z-[160] w-80 transition-opacity duration-150 ${positioned ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
			<div className='border-border bg-article overflow-hidden rounded-xl border shadow-2xl'>
				<div className='border-border bg-background/45 border-b px-4 py-3'>
					<h3 className='text-sm leading-snug font-semibold break-words'>{commit.message}</h3>
					<div className='text-secondary mt-2 flex items-center gap-2 text-[11px]'>
						<span className='font-mono text-green-500'>{commit.shortHash}</span>
						<span>·</span>
						<span>{date}</span>
					</div>
				</div>
				<div className='space-y-3 px-4 py-3 text-xs'>
					<Info icon={User}>{commit.author}</Info>
					<Info icon={Calendar}>{date}</Info>
					{commit.refs.length > 0 && (
						<div className='space-y-2'>
							<Info icon={Tag}>Refs</Info>
							<GitRefBadges refs={commit.refs} />
						</div>
					)}
					<Info icon={GitCommit}>{commit.parentHashes.length} 个父提交</Info>
				</div>
			</div>
		</div>,
		document.body
	)
}

function Info({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
	return (
		<div className='text-secondary flex items-center gap-2'>
			<Icon size={12} />
			<span>{children}</span>
		</div>
	)
}
export function formatCommitDate(timestamp: number, detailed = false) {
	return new Intl.DateTimeFormat(
		'zh-CN',
		detailed ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { month: '2-digit', day: '2-digit' }
	).format(new Date(timestamp))
}
