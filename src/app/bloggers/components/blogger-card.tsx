'use client'

import { motion } from 'motion/react'
import StarRating from '@/components/star-rating'
import { useSize } from '@/hooks/use-size'
import { cn } from '@/lib/utils'
import { Blogger } from '../grid-view'
import { useState } from 'react'
import { getAssetUrl } from '@/lib/asset-url'
import { OptimizedImage } from '@/components/optimized-image'

interface BloggerCardProps {
	blogger: Blogger
}

export function BloggerCard({ blogger }: BloggerCardProps) {
	const [expanded, setExpanded] = useState(false)
	const { maxSM } = useSize()

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.6 }}
			{...(maxSM ? { animate: { opacity: 1, scale: 1 } } : { whileInView: { opacity: 1, scale: 1 } })}
			className='card relative block overflow-hidden'>
			<div>
				<div className='mb-4 flex items-center gap-4'>
					<OptimizedImage
						src={getAssetUrl(blogger.avatar)}
						alt={blogger.name}
						width={64}
						height={64}
						className='h-16 w-16 rounded-full object-cover'
					/>
					<div className='flex-1'>
						<h3 className='group-hover:text-brand text-lg font-bold transition-colors'>{blogger.name}</h3>
						<a
							href={blogger.url}
							target='_blank'
							rel='noopener noreferrer'
							className='text-secondary hover:text-brand mt-1 block max-w-[200px] truncate text-xs hover:underline'>
							{blogger.url}
						</a>
					</div>
				</div>

				<StarRating stars={blogger.stars} />

				<p
					onClick={e => {
						e.preventDefault()
						setExpanded(!expanded)
					}}
					className={cn(
						'mt-3 cursor-pointer text-sm leading-relaxed text-gray-600 transition-all duration-300 focus:outline-none',
						expanded ? 'line-clamp-none' : 'line-clamp-3'
					)}>
					{blogger.description}
				</p>
			</div>
		</motion.div>
	)
}
