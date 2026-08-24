'use client'

import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import LikeButton from '@/components/like-button'
import { BlogToc } from '@/components/blog-toc'
import { ScrollTopButton } from '@/components/scroll-top-button'
import { getBlogCover } from '@/lib/blog-cover'
import { OptimizedImage } from '@/components/optimized-image'

type TocItem = {
	id: string
	text: string
	level: number
}

type BlogSidebarProps = {
	cover?: string
	summary?: string
	toc: TocItem[]
	slug?: string
}

export function BlogSidebar({ cover, summary, toc, slug }: BlogSidebarProps) {
	const coverSrc = getBlogCover(cover)

	return (
		<div className='sticky top-6 flex w-[200px] shrink-0 flex-col items-start gap-4 self-start max-sm:hidden'>
			<motion.div
				initial={{ opacity: 0, scale: 0.8 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ delay: INIT_DELAY + ANIMATION_DELAY * 1 }}
				className='bg-card w-full rounded-xl p-3'>
				<OptimizedImage src={coverSrc} alt='cover' width={176} height={110} className='h-auto w-full rounded-xl border object-cover' />
			</motion.div>

			{summary && (
				<motion.div
					initial={{ opacity: 0, scale: 0.8 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + ANIMATION_DELAY * 2 }}
					tabIndex={0}
					className='group bg-card w-full rounded-xl border p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/50'>
					<h2 className='text-secondary mb-2 font-medium'>摘要</h2>
					<div className='text-secondary scrollbar-none max-h-[3.75rem] cursor-text overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:max-h-[320px] group-hover:overflow-auto group-focus:max-h-[320px] group-focus:overflow-auto motion-reduce:transition-none'>
						{summary}
					</div>
				</motion.div>
			)}

			<BlogToc toc={toc} delay={INIT_DELAY + ANIMATION_DELAY * 3} />

			<div className='flex w-full items-center gap-3'>
				<LikeButton slug={slug} delay={(INIT_DELAY + ANIMATION_DELAY * 4) * 1000} />
				<ScrollTopButton className='border-brand/35 bg-brand/20 text-brand [&_path]:fill-brand [&_path]:fill-opacity-90' delay={INIT_DELAY + ANIMATION_DELAY * 5} />
			</div>
		</div>
	)
}
