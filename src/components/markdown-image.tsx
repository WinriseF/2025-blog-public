'use client'

import { useState } from 'react'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { getAssetUrl } from '@/lib/asset-url'

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
			<img
				src={imageSrc}
				alt={alt}
				title={title}
				loading='lazy'
				decoding='async'
				onClick={() => setDisplay(true)}
				className='h-auto max-w-full cursor-pointer transition-opacity hover:opacity-80'
			/>
			{display && <ImagePreviewDialog src={imageSrc} alt={alt} onClose={() => setDisplay(false)} />}
		</>
	)
}
