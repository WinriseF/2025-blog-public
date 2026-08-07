'use client'

import { motion } from 'motion/react'
import type { SolarTermContext } from './calendar-data'
import styles from './calendar.module.css'

type SolarTermTrackProps = {
	context: SolarTermContext
}

// Curve coordinates in the 800 × 80 SVG viewBox; CSS converts Y to the rendered 5rem track.
const nodePositions = [
	{ left: '7%', curveY: 48.202 },
	{ left: '34%', curveY: 42.42 },
	{ left: '65%', curveY: 26.065 },
	{ left: '92%', curveY: 33.64 }
]

export function SolarTermTrack({ context }: SolarTermTrackProps) {
	const activePathLength = Math.min(1, Math.max(0, (context.activeIndex + context.progress) / (context.terms.length - 1)))

	return (
		<section className={styles.solarTerms} aria-labelledby='solar-term-track-title'>
			<div className={styles.solarTermHeading}>
				<h2 id='solar-term-track-title'>节气行至此处</h2>
				<p>{context.phrase}</p>
			</div>

			<div className={styles.solarTermTrack} aria-label={`${context.current.name}至${context.next.name}的节气进程`}>
				<svg viewBox='0 0 800 80' preserveAspectRatio='none' role='img' aria-label='当前节气轨迹'>
					<path className={styles.solarTermPathBase} d='M20 56 C 204 10, 336 72, 486 34 S 684 20, 780 46' />
					<motion.path
						key={`${context.current.name}-${context.next.name}`}
						className={styles.solarTermPathActive}
						d='M20 56 C 204 10, 336 72, 486 34 S 684 20, 780 46'
						initial={{ pathLength: 0 }}
						animate={{ pathLength: activePathLength }}
						transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
					/>
				</svg>

				{context.terms.map((term, index) => (
					<motion.div
						key={`${term.name}-${term.date.year()}`}
						className={styles.solarTermNode}
						data-active={index === context.activeIndex}
						style={{ left: nodePositions[index].left, top: `${nodePositions[index].curveY / 16 - 0.3}rem` }}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.06 * index, duration: 0.28 }}>
						<i aria-hidden='true' />
						<strong>{term.name}</strong>
						<span>{term.date.format('MM.DD')}</span>
					</motion.div>
				))}
			</div>
		</section>
	)
}
