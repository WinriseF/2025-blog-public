import styles from './toolbox-mark.module.css'

export function ToolboxMark() {
	return <svg className={`${styles.mark} text-brand drop-shadow-[0_0_10px_var(--color-brand)]`} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width={36} height={36} fill='none' stroke='currentColor' strokeWidth={3.4} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
		<g className={styles.tool}>
			<path pathLength={1} d='M42 10a13 13 0 0 0-16 16L10 42a7.1 7.1 0 0 0 10 10l16-16a13 13 0 0 0 16-16l-8 8-8-8 6-10Z'/>
			<circle pathLength={1} cx={15} cy={47} r={2.2}/>
		</g>
	</svg>
}
