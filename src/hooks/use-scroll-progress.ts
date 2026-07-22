'use client'

import { useCallback, useEffect, useRef } from 'react'

export const SCROLL_PROGRESS_MAX = 1000
const PROGRESS_SCALE_VAR = '--reading-progress-scale'

function clampProgress(progress: number) {
	if (!Number.isFinite(progress)) return 0
	return Math.min(1, Math.max(0, progress))
}

function clampProgressValue(progressValue: number) {
	if (!Number.isFinite(progressValue)) return 0
	return Math.min(SCROLL_PROGRESS_MAX, Math.max(0, Math.round(progressValue)))
}

function getProgressValue(progress: number) {
	return Math.round(clampProgress(progress) * SCROLL_PROGRESS_MAX)
}

function getMaxScroll() {
	return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

export function useScrollProgress() {
	const rootRef = useRef<HTMLDivElement | null>(null)
	const inputRef = useRef<HTMLInputElement | null>(null)
	const frameRef = useRef<number | null>(null)
	const progressValueRef = useRef(-1)
	const progressLabelRef = useRef('')

	const updateProgressValue = useCallback((progressValue: number) => {
		const nextProgressValue = clampProgressValue(progressValue)

		if (progressValueRef.current === nextProgressValue) return

		progressValueRef.current = nextProgressValue
		const progress = nextProgressValue / SCROLL_PROGRESS_MAX
		const progressLabel = `${Math.round(progress * 100)}%`
		const input = inputRef.current

		rootRef.current?.style.setProperty(PROGRESS_SCALE_VAR, progress.toFixed(3))

		if (!input) return
		input.value = String(nextProgressValue)

		if (progressLabelRef.current !== progressLabel) {
			progressLabelRef.current = progressLabel
			input.setAttribute('aria-valuetext', progressLabel)
		}
	}, [])

	const updateProgress = useCallback(() => {
		const maxScroll = getMaxScroll()
		const nextProgress = maxScroll > 0 ? window.scrollY / maxScroll : 0

		updateProgressValue(getProgressValue(nextProgress))
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

		updateProgressValue(maxScroll > 0 ? getProgressValue(targetProgress) : 0)
		window.scrollTo({
			top: maxScroll * targetProgress,
			behavior: 'auto'
		})
	}, [updateProgressValue])

	return {
		rootRef,
		inputRef,
		scrollToProgress
	}
}
