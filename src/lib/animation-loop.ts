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
	let accumulatedMs = 0
	let elapsedMs = 0
	let inViewport = true
	let lastTimestamp = 0
	let destroyed = false

	const canRun = () => !destroyed && !document.hidden && inViewport

	const schedule = () => {
		if (!animationFrame && canRun()) animationFrame = window.requestAnimationFrame(tick)
	}

	const tick = (timestamp: number) => {
		animationFrame = 0
		if (!canRun()) return

		const fallbackDelta = frameInterval || 1000 / 60
		const deltaMs = lastTimestamp ? Math.min(timestamp - lastTimestamp, maxDeltaMs) : fallbackDelta
		lastTimestamp = timestamp
		elapsedMs += deltaMs
		accumulatedMs += deltaMs

		if (!frameInterval || accumulatedMs + 0.5 >= frameInterval) {
			const drawDeltaMs = frameInterval ? accumulatedMs : deltaMs
			if (frameInterval) accumulatedMs %= frameInterval
			draw({ deltaMs: drawDeltaMs, elapsedMs, timestamp })
		}

		schedule()
	}

	const sync = () => {
		if (canRun()) {
			lastTimestamp = 0
			schedule()
			return
		}

		if (animationFrame) window.cancelAnimationFrame(animationFrame)
		animationFrame = 0
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
			animationFrame = 0
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			observer?.disconnect()
		}
	}
}
