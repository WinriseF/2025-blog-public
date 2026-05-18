'use client'

import { useEffect, useState } from 'react'

export function useScrollProgress() {
	const [progress, setProgress] = useState(0)

	useEffect(() => {
		const updateProgress = () => {
			const currentScroll = window.scrollY
			const scrollHeight = document.documentElement.scrollHeight - window.innerHeight

			if (scrollHeight > 0) {
				setProgress(Number((currentScroll / scrollHeight).toFixed(2)))
			}
		}

		window.addEventListener('scroll', updateProgress, { passive: true })
		updateProgress()

		return () => window.removeEventListener('scroll', updateProgress)
	}, [])

	return progress
}
