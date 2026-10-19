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
import { StackMark } from '@/app/home/stack-mark'
import { ToolboxMark } from './toolbox-mark'

type SocialButtonType = 'github' | 'juejin' | 'email' | 'link'
const STACK_ENTRY_WIDTH = 64
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
				setShowStates(prev => ({ ...prev, entryButtons: true }))
			}, baseDelay + sortedButtons.length * delay)
		)

		return () => {
			timers.forEach(timer => clearTimeout(timer))
		}
	}, [order, delay, sortedButtons])

	const width = styles.width + STACK_ENTRY_WIDTH + TOOLBOX_ENTRY_WIDTH
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
		<motion.div className='absolute max-sm:static' animate={{ left: x, top: y }} initial={{ left: x, top: y }}>
			<div className='absolute top-0 left-0 flex flex-row-reverse items-center gap-3 max-sm:static max-sm:max-w-[calc(100vw-2rem)] max-sm:flex-wrap max-sm:justify-center' style={maxSM ? undefined : { width }}>
				{sortedButtons.map(button => renderButton(button))}
				{showStates.entryButtons && (
					<>
						<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
							<a
								href='/home'
								aria-label='打开墨栈登录页'
								title='墨栈'
								className='card relative flex h-12 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl p-0'>
								<StackMark size={36} className='text-brand drop-shadow-[0_0_10px_var(--color-brand)]' />
							</a>
						</motion.div>
						<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
							<Link
								href='/toolbox'
								aria-label='打开工具箱'
								title='工具箱'
								className='card group relative flex h-12 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl p-0'>
								<ToolboxMark />
							</Link>
						</motion.div>
					</>
				)}
			</div>
		</motion.div>
	)
}
