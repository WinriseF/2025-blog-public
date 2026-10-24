'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { startAnimationLoop } from '@/lib/animation-loop'
import { createYearLettering, getWrittenFrame } from './year-lettering'
import styles from './calendar.module.css'

export const CalendarYear = memo(function CalendarYear({ year }: { year: number }) {
	const svgRef = useRef<SVGSVGElement>(null)
	const lettering = useMemo(() => createYearLettering(year), [year])

	useEffect(() => {
		const svg = svgRef.current
		if (!svg) return
		const paths = Array.from(svg.querySelectorAll('[data-year-stroke]'), group => Array.from(group.querySelectorAll('path')))
		paths.flat().forEach(path => path.setAttribute('d', ''))
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
		const progressCache = lettering.tracks.map(() => -1)
		const completed = lettering.tracks.map(() => 0)
		let finished = false
		const paint = (time: number) => {
			lettering.tracks.forEach((track, index) => {
				const progress = Math.max(0, Math.min(1, (time - track.start) / track.duration))
				if (progress === progressCache[index]) return
				const frame = getWrittenFrame(track.stroke, progress)
				for (let part = completed[index]; part < frame.complete; part++) {
					paths[index][part].setAttribute('d', track.stroke.chunks[part])
				}
				if (frame.complete < paths[index].length) paths[index][frame.complete].setAttribute('d', frame.path)
				completed[index] = frame.complete
				progressCache[index] = progress
			})
			finished = time >= lettering.duration
		}
		paint(reducedMotion.matches ? lettering.duration : 0)
		const loop = startAnimationLoop(({ elapsedMs }) => paint(elapsedMs), {
			element: svg,
			active: () => !finished,
			targetFps: 60
		})
		const handleReducedMotion = () => {
			if (reducedMotion.matches) {
				paint(lettering.duration)
				loop.destroy()
			}
		}
		reducedMotion.addEventListener('change', handleReducedMotion)
		return () => {
			loop.destroy()
			reducedMotion.removeEventListener('change', handleReducedMotion)
		}
	}, [lettering])

	return (
		<svg ref={svgRef} className={styles.yearArtwork} viewBox={lettering.viewBox} role='img' aria-label={`${year}年`}>
			<g fill='currentColor' fillRule='nonzero' stroke='none'>
				{lettering.tracks.map((track, index) => (
					<g key={index} data-year-stroke='' transform={`translate(${track.x} 0)`}>
						{track.stroke.chunks.map((_, part) => <path key={part} d='' />)}
					</g>
				))}
			</g>
		</svg>
	)
})
