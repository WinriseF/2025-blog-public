'use client'

import { useState } from 'react'
import { DialogModal } from '@/components/dialog-modal'
import { getAssetUrl } from '@/lib/asset-url'
import { OptimizedImage } from '@/components/optimized-image'

type MarkdownImageProps = {
	src: string
	alt?: string
	title?: string
}

export function MarkdownImage({ src, alt = '', title = '' }: MarkdownImageProps) {
	const [display, setDisplay] = useState(false)
	const imageSrc = getAssetUrl(src)

	return (
		<>
			<OptimizedImage
				src={imageSrc}
				alt={alt}
				title={title}
				width={1200}
				height={800}
				onClick={() => setDisplay(true)}
				className='h-auto max-w-full cursor-pointer transition-opacity hover:opacity-80'
			/>
			<DialogModal open={display} onClose={() => setDisplay(false)} className='pointer-events-none max-w-none bg-transparent p-0'>
				<OptimizedImage
					src={imageSrc}
					alt={alt}
					width={1600}
					height={1200}
					onClick={() => setDisplay(false)}
					className='pointer-events-auto h-auto max-h-[90vh] max-w-full cursor-zoom-out rounded-2xl object-contain'
				/>
			</DialogModal>
		</>
	)
}
