import { useCenterStore } from '@/hooks/use-center'
import GithubSVG from '@/svgs/github.svg'
import Link from 'next/link'
import { ANIMATION_DELAY, CARD_SPACING } from '@/consts'
import { useConfigStore } from './stores/config-store'
import JuejinSVG from '@/svgs/juejin.svg'
import EmailSVG from '@/svgs/email.svg'
import { motion } from 'motion/react'
import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useSize } from '@/hooks/use-size'
import { HomeDraggableLayer } from './home-draggable-layer'
import { Wrench } from 'lucide-react'

type SocialButtonType = 'github' | 'juejin' | 'email' | 'link'
const SPHERE_ENTRY_WIDTH = 64
const TOOLBOX_ENTRY_WIDTH = 64

interface SocialButtonConfig {
	id: string
	type: SocialButtonType
	value: string
	label?: string
	order: number
}

export default function SocialButtons() {
	const center = useCenterStore()
	const { cardStyles, siteContent } = useConfigStore()
	const { maxSM, init } = useSize()
	const styles = cardStyles.socialButtons
	const hiCardStyles = cardStyles.hiCard
	const order = maxSM && init ? 0 : styles.order
	const delay = maxSM && init ? 0 : 100

	const sortedButtons = useMemo(() => {
		const buttons = (siteContent.socialButtons || []) as SocialButtonConfig[]
		return [...buttons].sort((a, b) => a.order - b.order)
	}, [siteContent.socialButtons])

	const [showStates, setShowStates] = useState<Record<string, boolean>>({})

	useEffect(() => {
		const baseDelay = order * ANIMATION_DELAY * 1000
		const timers: Array<ReturnType<typeof setTimeout>> = []

		sortedButtons.forEach((button, index) => {
			const showDelay = baseDelay + index * delay
			timers.push(
				setTimeout(() => {
					setShowStates(prev => ({ ...prev, [button.id]: true }))
				}, showDelay)
			)
		})

		timers.push(
			setTimeout(() => {
				setShowStates(prev => ({ ...prev, container: true }))
			}, baseDelay)
		)

		timers.push(
			setTimeout(() => {
				setShowStates(prev => ({ ...prev, sphereEntry: true }))
			}, baseDelay + sortedButtons.length * delay)
		)

		return () => {
			timers.forEach(timer => clearTimeout(timer))
		}
	}, [order, delay, sortedButtons])

	const width = styles.width + SPHERE_ENTRY_WIDTH + TOOLBOX_ENTRY_WIDTH
	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + hiCardStyles.width / 2 - width
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y + hiCardStyles.height / 2 + CARD_SPACING

	if (!showStates.container) return null

	const renderButton = (button: SocialButtonConfig) => {
		if (!showStates[button.id]) return null

		const commonProps = {
			initial: { opacity: 0, scale: 0.6 } as const,
			animate: { opacity: 1, scale: 1 } as const,
			whileHover: { scale: 1.05 } as const,
			whileTap: { scale: 0.95 } as const
		}

		switch (button.type) {
			case 'github':
				return (
					<motion.a
						key={button.id}
						href={button.value}
						target='_blank'
						{...commonProps}
						className='font-averia flex items-center gap-2 rounded-xl border bg-[#070707] px-3 py-2 text-xl text-white'
						style={{ boxShadow: ' inset 0 0 12px rgba(255, 255, 255, 0.4)' }}>
						<GithubSVG />
						{button.label || 'Github'}
					</motion.a>
				)

			case 'juejin':
				return (
					<motion.a
						key={button.id}
						href={button.value}
						target='_blank'
						{...commonProps}
						className='card relative flex items-center gap-2 rounded-xl px-3 py-2.5 font-medium whitespace-nowrap'>
						<JuejinSVG className='h-6 w-6' />
						{button.label || '稀土掘金'}
					</motion.a>
				)

			case 'email':
				return (
					<motion.button
						key={button.id}
						onClick={() => {
							navigator.clipboard.writeText(button.value).then(() => {
								toast.success('邮箱已复制到剪贴板')
							})
						}}
						{...commonProps}
						className='card btn relative rounded-xl p-1.5'>
						<EmailSVG />
					</motion.button>
				)

			case 'link':
				return (
					<motion.a
						key={button.id}
						href={button.value}
						target='_blank'
						{...commonProps}
						className='card relative flex items-center gap-2 rounded-xl px-3 py-2.5 font-medium whitespace-nowrap'>
						{button.label || button.value}
					</motion.a>
				)

			default:
				return null
		}
	}

	return (
		<HomeDraggableLayer cardKey='socialButtons' x={x} y={y} width={width} height={styles.height}>
			<motion.div className='absolute max-sm:static' animate={{ left: x, top: y }} initial={{ left: x, top: y }}>
				<div className='absolute top-0 left-0 flex flex-row-reverse items-center gap-3 max-sm:static max-sm:max-w-[calc(100vw-2rem)] max-sm:flex-wrap max-sm:justify-center' style={maxSM ? undefined : { width }}>
					{sortedButtons.map(button => renderButton(button))}
					{showStates.sphereEntry && (
						<>
							<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
								<Link
									href='/home'
									aria-label='打开 3D 卡片球'
									title='3D 卡片球'
									className='card group relative flex h-12 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl p-0'>
									<span className='absolute inset-1.5 rounded-lg border border-white/70 bg-white/20' />
									<span className='relative h-6 w-6 rounded-full border border-white bg-linear shadow-sm'>
										<span className='absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[6px] border border-white/80 bg-white/35 shadow-sm' />
										<span className='absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white' />
									</span>
								</Link>
							</motion.div>
							<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
								<Link
									href='/t'
									aria-label='打开工具箱'
									title='工具箱'
									className='card group relative flex h-12 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl p-0'>
									<Wrench className='text-brand h-7 w-7 drop-shadow-[0_0_10px_var(--color-brand)]' strokeWidth={2.35} />
								</Link>
							</motion.div>
						</>
					)}
				</div>
			</motion.div>
		</HomeDraggableLayer>
	)
}
