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
	let lastTimestamp = 0
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
		if (!frameInterval || !lastTimestamp) {
			requestFrame()
			return
		}

		const waitMs = Math.max(0, frameInterval - (performance.now() - lastTimestamp) - 4)
		if (waitMs <= 0) requestFrame()
		else wakeTimer = window.setTimeout(requestFrame, waitMs)
	}

	const tick = (timestamp: number) => {
		animationFrame = 0
		if (!canRun() || !isActive()) return

		const frameInterval = getFrameInterval()
		const fallbackDelta = frameInterval || 1000 / 60
		const deltaLimit = frameInterval ? Math.max(maxDeltaMs, frameInterval) : maxDeltaMs
		const deltaMs = lastTimestamp ? Math.min(timestamp - lastTimestamp, deltaLimit) : fallbackDelta
		lastTimestamp = timestamp
		elapsedMs += deltaMs
		draw({ deltaMs, elapsedMs, timestamp })

		schedule()
	}

	const sync = () => {
		if (canRun()) {
			lastTimestamp = 0
			schedule()
			return
		}

		if (animationFrame) window.cancelAnimationFrame(animationFrame)
		if (wakeTimer) window.clearTimeout(wakeTimer)
		animationFrame = 0
		wakeTimer = 0
		lastTimestamp = 0
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
			lastTimestamp = 0
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
