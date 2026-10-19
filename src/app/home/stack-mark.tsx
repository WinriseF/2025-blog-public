import styles from './stack-mark.module.css'

export function StackMark({ size = 24, className = '' }: { size?: number; className?: string }) {
	return <svg className={`${styles.mark} ${className}`} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width={size} height={size} fill='none' stroke='currentColor' strokeWidth={3.2} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
		<g className={styles.back}>
			<path className={styles.line} pathLength={1} d='M11 19v29a10 10 0 0 0 10 10h24' opacity='.55'/>
		</g>
		<g className={styles.front}>
			<path className={styles.line} pathLength={1} d='M25 7h17l12 12v25a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6V13a6 6 0 0 1 6-6Z'/>
			<path className={styles.line} pathLength={1} d='M42 7v9a3 3 0 0 0 3 3h9'/>
			<path className={styles.ink} d='M35.5 42.93A7.5 7.5 0 0 1 29 35.5c0-4.4 5.3-8.3 7.5-12.5C38.7 27.2 44 31.1 44 35.5a7.5 7.5 0 0 1-6.5 7.43v-6.7a2 2 0 1 0-2 0Z' fill='currentColor' stroke='none'/>
		</g>
	</svg>
}
