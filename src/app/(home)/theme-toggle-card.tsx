import { ANIMATION_DELAY, CARD_SPACING } from '@/consts'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useConfigStore } from './stores/config-store'
import { useCenterStore } from '@/hooks/use-center'
import { useSize } from '@/hooks/use-size'
import { AppearanceControl } from '@/components/appearance-control'

export default function ThemeToggleCard() {
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const { maxSM } = useSize()
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
	return (
		<motion.div initial={{ left: x, top: y }} animate={{ left: x, top: y }} className='absolute'>
			<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
				<AppearanceControl
					variant='home'
					className='bg-card text-brand flex h-10 w-10 items-center justify-center rounded-full border shadow backdrop-blur-md'
				/>
			</motion.div>
		</motion.div>
	)
}
