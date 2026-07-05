'use client'

import initialList from './list.json'
import { RandomLayout } from './components/random-layout'

export interface Picture {
	id: string
	uploadedAt: string
	description?: string
	images: string[]
}

export default function Page() {
	const pictures = initialList as Picture[]

	return (
		<>
			<RandomLayout pictures={pictures} />

			{pictures.length === 0 && (
				<div className='text-secondary flex min-h-screen items-center justify-center text-center text-sm'>还没有图片。</div>
			)}
		</>
	)
}
