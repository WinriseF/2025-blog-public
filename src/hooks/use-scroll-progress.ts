'use client'

import { useCallback, useEffect, useRef } from 'react'

export const SCROLL_PROGRESS_MAX = 1000
const PROGRESS_SCALE_VAR = '--reading-progress-scale'

type ScrollContainerRef = {
	current: HTMLElement | null
}

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

function getMaxScroll(scrollContainer?: HTMLElement | null) {
	if (scrollContainer) return Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
	return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

export function useScrollProgress(scrollContainerRef?: ScrollContainerRef, contentRef?: ScrollContainerRef) {
	const rootRef = useRef<HTMLDivElement | null>(null)
	const inputRef = useRef<HTMLInputElement | null>(null)
	const frameRef = useRef<number | null>(null)
	const maxScrollRef = useRef(0)
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

	const measureMaxScroll = useCallback(() => {
		const scrollContainer = scrollContainerRef?.current
		maxScrollRef.current = getMaxScroll(scrollContainer)
	}, [scrollContainerRef])

	const updateProgress = useCallback(() => {
		const scrollContainer = scrollContainerRef?.current
		const scrollPosition = scrollContainer ? scrollContainer.scrollTop : window.scrollY
		const nextProgress = maxScrollRef.current > 0 ? scrollPosition / maxScrollRef.current : 0

		updateProgressValue(getProgressValue(nextProgress))
	}, [scrollContainerRef, updateProgressValue])

	useEffect(() => {
		let measureRequested = false

		const scheduleProgressUpdate = (measure = false) => {
			measureRequested ||= measure
			if (frameRef.current !== null) return

			frameRef.current = window.requestAnimationFrame(() => {
				frameRef.current = null
				if (measureRequested) {
					measureRequested = false
					measureMaxScroll()
				}
				updateProgress()
			})
		}

		const scrollContainer = scrollContainerRef?.current
		const scrollTarget = scrollContainer ?? window
		let resizeObserver: ResizeObserver | null = null

		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => scheduleProgressUpdate(true))
			resizeObserver.observe(scrollContainer ?? document.documentElement)
			if (!scrollContainer && document.body) resizeObserver.observe(document.body)
			if (contentRef?.current) resizeObserver.observe(contentRef.current)
		}

		const handleScroll = () => scheduleProgressUpdate()
		const handleResize = () => scheduleProgressUpdate(true)

		scrollTarget.addEventListener('scroll', handleScroll, { passive: true })
		window.addEventListener('resize', handleResize)
		measureMaxScroll()
		updateProgress()

		return () => {
			scrollTarget.removeEventListener('scroll', handleScroll)
			window.removeEventListener('resize', handleResize)
			resizeObserver?.disconnect()

			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current)
				frameRef.current = null
			}
		}
	}, [contentRef, measureMaxScroll, scrollContainerRef, updateProgress])

	const scrollToProgress = useCallback((nextProgress: number) => {
		const targetProgress = clampProgress(nextProgress)
		const scrollContainer = scrollContainerRef?.current
		measureMaxScroll()
		const maxScroll = maxScrollRef.current
		const targetScroll = maxScroll * targetProgress

		updateProgressValue(maxScroll > 0 ? getProgressValue(targetProgress) : 0)
		if (scrollContainer) {
			scrollContainer.scrollTop = targetScroll
			return
		}

		const root = document.documentElement
		const previousScrollBehavior = root.style.scrollBehavior
		root.style.scrollBehavior = 'auto'
		window.scrollTo({
			top: targetScroll,
			behavior: 'auto'
		})
		root.style.scrollBehavior = previousScrollBehavior
	}, [measureMaxScroll, scrollContainerRef, updateProgressValue])

	return {
		rootRef,
		inputRef,
		scrollToProgress
	}
}
