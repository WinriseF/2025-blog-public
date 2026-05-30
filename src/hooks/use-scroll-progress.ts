'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const SCROLL_PROGRESS_MAX = 1000

function clampProgress(progress: number) {
	if (!Number.isFinite(progress)) return 0
	return Math.min(1, Math.max(0, progress))
}

function getProgressValue(progress: number) {
	return Math.round(clampProgress(progress) * SCROLL_PROGRESS_MAX)
}

function getMaxScroll() {
	if (typeof window === 'undefined') return 0
	return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

export function useScrollProgress() {
	const [progressValue, setProgressValue] = useState(0)
	const frameRef = useRef<number | null>(null)
	const progressValueRef = useRef(0)

	const updateProgressValue = useCallback((nextProgress: number) => {
		const nextProgressValue = getProgressValue(nextProgress)

		if (progressValueRef.current === nextProgressValue) return

		progressValueRef.current = nextProgressValue
		setProgressValue(nextProgressValue)
	}, [])

	const updateProgress = useCallback(() => {
		const maxScroll = getMaxScroll()
		const nextProgress = maxScroll > 0 ? window.scrollY / maxScroll : 0

		updateProgressValue(nextProgress)
	}, [updateProgressValue])

	useEffect(() => {
		const scheduleProgressUpdate = () => {
			if (frameRef.current !== null) return

			frameRef.current = window.requestAnimationFrame(() => {
				frameRef.current = null
				updateProgress()
			})
		}

		let resizeObserver: ResizeObserver | null = null

		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(scheduleProgressUpdate)
			resizeObserver.observe(document.documentElement)
			if (document.body) resizeObserver.observe(document.body)
		}

		window.addEventListener('scroll', scheduleProgressUpdate, { passive: true })
		window.addEventListener('resize', scheduleProgressUpdate)
		updateProgress()

		return () => {
			window.removeEventListener('scroll', scheduleProgressUpdate)
			window.removeEventListener('resize', scheduleProgressUpdate)
			resizeObserver?.disconnect()

			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current)
				frameRef.current = null
			}
		}
	}, [updateProgress])

	const scrollToProgress = useCallback((nextProgress: number) => {
		const targetProgress = clampProgress(nextProgress)
		const maxScroll = getMaxScroll()

		updateProgressValue(maxScroll > 0 ? targetProgress : 0)
		window.scrollTo({
			top: maxScroll * targetProgress,
			behavior: 'instant'
		})
	}, [updateProgressValue])

	return {
		progress: progressValue / SCROLL_PROGRESS_MAX,
		progressValue,
		scrollToProgress
	}
}
