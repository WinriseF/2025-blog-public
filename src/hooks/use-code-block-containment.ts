import { useEffect, type RefObject } from 'react'

const CONTAINED_CLASS = 'code-block-contained'

export function useCodeBlockContainment(articleRef: RefObject<HTMLElement | null>, contentKey: unknown) {
	useEffect(() => {
		const article = articleRef.current
		if (!article) return

		let readFrame = 0
		let writeFrame = 0
		let resizeTimer = 0
		let cancelled = false

		const measure = () => {
			const blocks = Array.from(article.querySelectorAll<HTMLElement>('.code-block-wrapper'))
			if (!blocks.length) return

			for (const block of blocks) block.classList.remove(CONTAINED_CLASS)
			readFrame = window.requestAnimationFrame(() => {
				readFrame = 0
				const heights = blocks.map(block => block.getBoundingClientRect().height)

				writeFrame = window.requestAnimationFrame(() => {
					writeFrame = 0
					if (cancelled) return
					for (let index = 0; index < blocks.length; index++) {
						blocks[index].style.setProperty('--code-block-intrinsic-size', `${heights[index]}px`)
						blocks[index].classList.add(CONTAINED_CLASS)
					}
				})
			})
		}

		const scheduleMeasure = () => {
			window.clearTimeout(resizeTimer)
			resizeTimer = window.setTimeout(measure, 160)
		}

		measure()
		window.addEventListener('resize', scheduleMeasure)
		void document.fonts?.ready.then(() => {
			if (!cancelled) scheduleMeasure()
		})

		return () => {
			cancelled = true
			window.removeEventListener('resize', scheduleMeasure)
			window.clearTimeout(resizeTimer)
			if (readFrame) window.cancelAnimationFrame(readFrame)
			if (writeFrame) window.cancelAnimationFrame(writeFrame)
		}
	}, [articleRef, contentKey])
}
