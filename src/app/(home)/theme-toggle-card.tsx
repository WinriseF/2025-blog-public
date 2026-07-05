import { ANIMATION_DELAY, CARD_SPACING } from '@/consts'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useConfigStore } from './stores/config-store'
import { useCenterStore } from '@/hooks/use-center'
import { useSize } from '@/hooks/use-size'
import { useTimeTheme } from '@/components/time-theme-provider'
import { Moon, SunMedium, Sunrise, Sunset } from 'lucide-react'

export default function ThemeToggleCard() {
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const { maxSM } = useSize()
	const { theme, cycleTheme } = useTimeTheme()
	const styles = cardStyles.themeToggle
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard

	const [show, setShow] = useState(false)

	useEffect(() => {
		const timer = setTimeout(() => setShow(true), styles.order * ANIMATION_DELAY * 1000)
		return () => clearTimeout(timer)
	}, [styles.order])

	if (maxSM || !show) return null

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset - styles.height - CARD_SPACING / 2 - clockCardStyles.height
	const ThemeIcon = {
		dawn: Sunrise,
		noon: SunMedium,
		sunset: Sunset,
		night: Moon
	}[theme.name]

	return (
		<motion.div initial={{ left: x, top: y }} animate={{ left: x, top: y }} className='absolute'>
			<motion.button
				type='button'
				initial={{ opacity: 0, scale: 0.6 }}
				animate={{ opacity: 1, scale: 1 }}
				whileHover={{ scale: 1.05 }}
				whileTap={{ scale: 0.95 }}
				onClick={cycleTheme}
				className='bg-card flex h-10 w-10 items-center justify-center rounded-full border shadow backdrop-blur-md'
				aria-label='切换时间主题'>
				<ThemeIcon className='text-brand h-5 w-5' />
			</motion.button>
		</motion.div>
	)
}
