type AnimationLoopFrame = {
	deltaMs: number
	elapsedMs: number
	timestamp: number
}

type AnimationLoopOptions = {
	active?: () => boolean
	element?: Element | null
	maxDeltaMs?: number
	targetFps?: number | (() => number)
}

type AnimationLoop = {
	destroy: () => void
	wake: () => void
}

/**
 * Runs a visual frame loop only while its page, optional target, and active predicate are visible.
 * Pauses reset frame timing so returning to a tab never produces a giant delta.
 * On-demand callers can wake a stopped loop after making the active predicate true.
 */
export function startAnimationLoop(
	draw: (frame: AnimationLoopFrame) => void,
	{ active, element, maxDeltaMs = 100, targetFps }: AnimationLoopOptions = {}
): AnimationLoop {
	const getFrameInterval = () => {
		const fps = typeof targetFps === 'function' ? targetFps() : targetFps
		return fps ? 1000 / Math.max(1, fps) : 0
	}
	let animationFrame = 0
	let wakeTimer = 0
	let elapsedMs = 0
	let inViewport = true
	let lastTimestamp: number | null = null
	let nextTimestamp = 0
	let scheduledInterval = 0
	let destroyed = false

	const canRun = () => !destroyed && !document.hidden && inViewport
	const isActive = () => active?.() ?? true

	const requestFrame = () => {
		wakeTimer = 0
		if (!animationFrame && canRun() && isActive()) animationFrame = window.requestAnimationFrame(tick)
	}

	const schedule = () => {
		if (animationFrame || wakeTimer || !canRun() || !isActive()) return
		const frameInterval = getFrameInterval()
		// Fast loops stay on RAF; timers can miss the next display refresh.
		if (frameInterval <= 1000 / 30 || lastTimestamp === null) {
			requestFrame()
			return
		}

		const waitMs = Math.max(0, nextTimestamp - performance.now() - 4)
		if (waitMs <= 0) requestFrame()
		else wakeTimer = window.setTimeout(requestFrame, waitMs)
	}

	const tick = (timestamp: number) => {
		animationFrame = 0
		if (!canRun() || !isActive()) return

		const frameInterval = getFrameInterval()
		if (frameInterval !== scheduledInterval) {
			nextTimestamp = lastTimestamp === null ? timestamp : lastTimestamp + frameInterval
			scheduledInterval = frameInterval
		}
		// Allow sub-millisecond RAF rounding, but never draw on every high-Hz refresh.
		if (lastTimestamp !== null && frameInterval && timestamp + 0.5 < nextTimestamp) {
			schedule()
			return
		}
		const fallbackDelta = frameInterval || 1000 / 60
		const deltaLimit = frameInterval ? Math.max(maxDeltaMs, frameInterval) : maxDeltaMs
		const deltaMs = lastTimestamp !== null ? Math.min(timestamp - lastTimestamp, deltaLimit) : fallbackDelta
		if (lastTimestamp === null || !frameInterval) nextTimestamp = timestamp + frameInterval
		else nextTimestamp += (Math.max(0, Math.floor((timestamp - nextTimestamp) / frameInterval)) + 1) * frameInterval
		lastTimestamp = timestamp
		elapsedMs += deltaMs
		draw({ deltaMs, elapsedMs, timestamp })

		schedule()
	}

	const sync = () => {
		if (canRun()) {
			schedule()
			return
		}

		if (animationFrame) window.cancelAnimationFrame(animationFrame)
		if (wakeTimer) window.clearTimeout(wakeTimer)
		animationFrame = 0
		wakeTimer = 0
		lastTimestamp = null
		nextTimestamp = 0
	}

	const handleVisibilityChange = () => sync()
	document.addEventListener('visibilitychange', handleVisibilityChange)

	const observer =
		element && typeof IntersectionObserver !== 'undefined'
			? new IntersectionObserver(
					entries => {
						inViewport = entries[0]?.isIntersecting ?? true
						sync()
					},
					{ rootMargin: '160px' }
				)
			: null

	if (element && observer) observer.observe(element)
	schedule()

	return {
		wake() {
			if (!canRun() || !isActive() || animationFrame || wakeTimer) return
			lastTimestamp = null
			nextTimestamp = 0
			requestFrame()
		},
		destroy() {
			destroyed = true
			if (animationFrame) window.cancelAnimationFrame(animationFrame)
			if (wakeTimer) window.clearTimeout(wakeTimer)
			animationFrame = 0
			wakeTimer = 0
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			observer?.disconnect()
		}
	}
}
