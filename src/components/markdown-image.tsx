'use client'

import { useState } from 'react'
import { DialogModal } from '@/components/dialog-modal'
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
				className='cursor-pointer transition-opacity hover:opacity-80'
			/>
			<DialogModal open={display} onClose={() => setDisplay(false)} className='max-w-none bg-transparent p-0'>
				<img src={imageSrc} alt={alt} loading='lazy' decoding='async' className='max-h-[90vh] max-w-full rounded-2xl object-contain' />
			</DialogModal>
		</>
	)
}
