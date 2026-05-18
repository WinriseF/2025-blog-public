'use client'

import { useScrollProgress } from '@/hooks/use-scroll-progress'

export function ReadingProgressBar() {
	const progress = useScrollProgress()

	return (
		<div className='fixed top-0 left-0 z-50 h-1 w-full bg-transparent'>
			<div
				className='h-full bg-linear transition-all duration-150 ease-out'
				style={{ width: `${progress * 100}%` }}
			/>
		</div>
	)
}
