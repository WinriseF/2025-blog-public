import styles from './nav-mark.module.css'

const shapes = {
	articles: <>
		<path d='M38 9H17a5 5 0 0 0-5 5v36a5 5 0 0 0 5 5h30a5 5 0 0 0 5-5V23Z' />
		<path className={styles.fold} d='M38 9v10q0 4 4 4h10' />
		<path className={styles.text} d='M22 31h15' />
		<path className={`${styles.text} ${styles.second}`} d='M22 39h20' />
		<path className={`${styles.text} ${styles.third}`} d='M22 47h12' />
		<path className={styles.spark} d='m53 9 2-4m3 11 4-2' />
	</>,
	projects: <>
		<rect className={styles.squareOne} x={10} y={10} width={18} height={18} rx={4} />
		<rect className={styles.squareTwo} x={36} y={10} width={18} height={18} rx={4} />
		<rect className={styles.squareThree} x={10} y={36} width={18} height={18} rx={4} />
		<rect className={styles.squareFour} x={36} y={36} width={18} height={18} rx={4} />
	</>,
	about: <g className={styles.face}>
		<circle cx={32} cy={32} r={23} />
		<circle cx={24} cy={27} r={1.5} fill='currentColor' stroke='none' />
		<circle className={styles.eye} cx={41} cy={27} r={1.5} fill='currentColor' stroke='none' />
		<path className={styles.wink} d='M37 28q4-5 8 0' />
		<path d='M24 38q8 9 16 0' />
	</g>,
	news: <>
		<path d='M17 21h-4a4 4 0 0 0-4 4v24a5 5 0 0 0 5 5h35a5 5 0 0 0 5-5V14a5 5 0 0 0-5-5H22a5 5 0 0 0-5 5v35q0 5-4 5' />
		<path d='M26 19h18m-18 8h11' />
		<path className={styles.trend} pathLength={1} d='m25 44 6-7 7 5 10-12' />
		<circle className={styles.tip} cx={48} cy={30} r={1.4} fill='currentColor' />
	</>,
	blogs: <>
		<circle cx={32} cy={32} r={23} />
		<path d='M9 32h46' />
		<ellipse className={styles.meridian} cx={32} cy={32} rx={11} ry={23} />
		<circle className={styles.node} cx={45} cy={32} r={3.5} />
		<path className={styles.spark} d='m55 14 3-3m0 11 4-1' />
	</>
}

export type NavMarkName = keyof typeof shapes

export function NavMark({ name }: { name: NavMarkName }) {
	return (
		<svg className={styles.mark} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width={28} height={28} fill='none' stroke='currentColor' strokeWidth={3.4} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
			{shapes[name]}
		</svg>
	)
}
