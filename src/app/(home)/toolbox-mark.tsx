import styles from './toolbox-mark.module.css'

export function ToolboxMark() {
	return <svg className={`${styles.mark} text-brand drop-shadow-[0_0_10px_var(--color-brand)]`} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width={36} height={36} fill='none' stroke='currentColor' strokeWidth={3.1} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
		<svg width={64} height={28} viewBox='0 0 64 28' overflow='hidden'>
			<g className={styles.wrench}>
				<path className={styles.line} pathLength={1} d='M16 6a8 8 0 0 0-3 14v20h8V20a8 8 0 0 0 1-14v6l-3 2-3-2V6Z'/>
			</g>
			<g className={styles.driver}>
				<path className={styles.line} pathLength={1} d='M39 8a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v7l-3 3v22h-4V18l-3-3V8Z'/>
				<path className={styles.line} pathLength={1} d='M44 9v4' opacity={.55}/>
			</g>
		</svg>
		<path className={styles.line} pathLength={1} d='M9 28h46v22a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V28Z'/>
		<path className={styles.line} pathLength={1} d='M9 36h18m10 0h18' opacity={.65}/>
		<rect className={styles.line} pathLength={1} x={27} y={32} width={10} height={9} rx={2}/>
		<path className={styles.line} pathLength={1} d='M17 45v3m30-3v3' opacity={.5}/>
	</svg>
}
