import { useCenterStore } from '@/hooks/use-center'
import Card from '@/components/card'
import cardStyles from '@/config/card-styles.json'
import AnimatedCore from './animated-core'
import cardAppearance from './hi-card.module.css'
import Starfield from './starfield'

function getGreeting() {
	const hour = new Date().getHours()

	if (hour >= 6 && hour < 12) {
		return 'Good Morning'
	} else if (hour >= 12 && hour < 18) {
		return 'Good Afternoon'
	} else if (hour >= 18 && hour < 22) {
		return 'Good Evening'
	} else {
		return 'Good Night'
	}
}

export default function HiCard() {
	const center = useCenterStore()
	const greeting = getGreeting()
	const styles = cardStyles.hiCard

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x - styles.width / 2
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - styles.height / 2

	return (
		<Card
			order={styles.order}
			width={styles.width}
			height={styles.height}
			x={x}
			y={y}
			className={`${cardAppearance.surface} core-card relative overflow-hidden p-0 text-center max-sm:static max-sm:translate-0`}>
			<Starfield />
			<AnimatedCore className={`${cardAppearance.planet} absolute inset-0 h-full w-full rounded-[40px] [&>img]:scale-[1.15] [&>div]:scale-[1.15]`} />
			<div aria-hidden='true' className={cardAppearance.lowerShade} />
			<div className='pointer-events-none absolute right-6 bottom-4 left-6 z-20'>
				<h1 className={`${cardAppearance.greeting} font-averia text-2xl leading-none`}>{greeting}</h1>
			</div>
		</Card>
	)
}
