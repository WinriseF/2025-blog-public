type AnimationLoopFrame = {
	deltaMs: number
	elapsedMs: number
	timestamp: number
}

type AnimationLoopOptions = {
	element?: Element | null
	maxDeltaMs?: number
	targetFps?: number
}

type AnimationLoop = {
	destroy: () => void
}

/**
 * Runs a visual frame loop only while its page and optional target are visible.
 * Pauses reset frame timing so returning to a tab never produces a giant delta.
 */
export function startAnimationLoop(
	draw: (frame: AnimationLoopFrame) => void,
	{ element, maxDeltaMs = 100, targetFps }: AnimationLoopOptions = {}
): AnimationLoop {
	const frameInterval = targetFps ? 1000 / targetFps : 0
	let animationFrame = 0
	let wakeTimer = 0
	let elapsedMs = 0
	let inViewport = true
	let lastTimestamp = 0
	let destroyed = false

	const canRun = () => !destroyed && !document.hidden && inViewport

	const requestFrame = () => {
		wakeTimer = 0
		if (!animationFrame && canRun()) animationFrame = window.requestAnimationFrame(tick)
	}

	const schedule = () => {
		if (animationFrame || wakeTimer || !canRun()) return
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
		if (!canRun()) return

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
