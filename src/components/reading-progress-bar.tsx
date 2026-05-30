'use client'

import { type ChangeEvent, type CSSProperties } from 'react'
import { SCROLL_PROGRESS_MAX, useScrollProgress } from '@/hooks/use-scroll-progress'

export function ReadingProgressBar() {
	const { progress, progressValue, scrollToProgress } = useScrollProgress()
	const progressScale = progress.toFixed(3)
	const progressLabel = `${Math.round(progress * 100)}%`

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		scrollToProgress(Number(event.currentTarget.value) / SCROLL_PROGRESS_MAX)
	}

	return (
		<div className='reading-progress' style={{ '--reading-progress-scale': progressScale } as CSSProperties}>
			<div className='reading-progress-visual' aria-hidden='true'>
				<div className='reading-progress-fill' />
			</div>
			<input
				type='range'
				min={0}
				max={SCROLL_PROGRESS_MAX}
				step={1}
				value={progressValue}
				onChange={handleChange}
				className='reading-progress-input'
				aria-label='阅读进度'
				aria-valuetext={progressLabel}
			/>
		</div>
	)
}
