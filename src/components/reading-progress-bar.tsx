'use client'

import { type ChangeEvent } from 'react'
import { SCROLL_PROGRESS_MAX, useScrollProgress } from '@/hooks/use-scroll-progress'

export function ReadingProgressBar() {
	const { rootRef, inputRef, scrollToProgress } = useScrollProgress()

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		scrollToProgress(Number(event.currentTarget.value) / SCROLL_PROGRESS_MAX)
	}

	return (
		<div ref={rootRef} className='reading-progress'>
			<div className='reading-progress-visual' aria-hidden='true'>
				<div className='reading-progress-fill' />
			</div>
			<input
				ref={inputRef}
				type='range'
				min={0}
				max={SCROLL_PROGRESS_MAX}
				step={1}
				defaultValue={0}
				onChange={handleChange}
				className='reading-progress-input'
				aria-label='阅读进度'
				aria-valuetext='0%'
			/>
		</div>
	)
}
