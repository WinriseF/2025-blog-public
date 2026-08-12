'use client'

import { ANIMATION_DELAY } from '@/consts'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSize } from '@/hooks/use-size'

const CARD_TILT_DEGREES = 7
const CARD_PRESS_TILT_DEGREES = 10

const cardTiltSpring = {
	stiffness: 260,
	damping: 24,
	mass: 0.7
}

interface Props {
	className?: string
	order: number
	width: number
	height?: number
	x: number
	y: number
	children: React.ReactNode
}

export default function Card({ children, order, width, height, x, y, className }: Props) {
	const maxSM = useSize(state => state.maxSM)
	const init = useSize(state => state.init)
	const shouldReduceMotion = useReducedMotion()
	const [show, setShow] = useState(false)
	const pressingRef = useRef(false)
	const rectRef = useRef<DOMRect | null>(null)
	const frameRef = useRef<number | null>(null)
	const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
	const rotateXValue = useMotionValue(0)
	const rotateYValue = useMotionValue(0)
	const rotateX = useSpring(rotateXValue, cardTiltSpring)
	const rotateY = useSpring(rotateYValue, cardTiltSpring)

	if (maxSM && init) order = 0

	useEffect(() => {
		if (show) return
		if (x === 0 && y === 0) return
		const timer = setTimeout(
			() => {
				setShow(true)
			},
			order * ANIMATION_DELAY * 1000
		)

		return () => clearTimeout(timer)
	}, [order, x, y, show])

	useEffect(() => {
		return () => {
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current)
			}
		}
	}, [])

	const resetTilt = useCallback(() => {
		pressingRef.current = false
		rectRef.current = null
		pointerRef.current = null
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current)
			frameRef.current = null
		}
		rotateXValue.set(0)
		rotateYValue.set(0)
	}, [rotateXValue, rotateYValue])

	const applyTilt = useCallback(() => {
		frameRef.current = null

		const rect = rectRef.current
		const pointer = pointerRef.current
		if (!rect || !pointer || !rect.width || !rect.height) return

		const xProgress = Math.min(Math.max((pointer.clientX - rect.left) / rect.width, 0), 1)
		const yProgress = Math.min(Math.max((pointer.clientY - rect.top) / rect.height, 0), 1)
		const xOffset = xProgress * 2 - 1
		const yOffset = yProgress * 2 - 1
		const tilt = pressingRef.current ? CARD_PRESS_TILT_DEGREES : CARD_TILT_DEGREES

		rotateXValue.set(-yOffset * tilt)
		rotateYValue.set(xOffset * tilt)
	}, [rotateXValue, rotateYValue])

	const scheduleTilt = useCallback(
		(event: React.PointerEvent<HTMLDivElement>, shouldReadRect = false) => {
			if (shouldReduceMotion || event.pointerType === 'touch' || (maxSM && init)) return

			if (shouldReadRect || !rectRef.current) {
				rectRef.current = event.currentTarget.getBoundingClientRect()
			}

			pointerRef.current = {
				clientX: event.clientX,
				clientY: event.clientY
			}

			if (frameRef.current === null) {
				frameRef.current = requestAnimationFrame(applyTilt)
			}
		},
		[applyTilt, init, maxSM, shouldReduceMotion]
	)

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			pressingRef.current = true
			scheduleTilt(event, true)
		},
		[scheduleTilt]
	)

	const handlePointerEnter = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			scheduleTilt(event, true)
		},
		[scheduleTilt]
	)

	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			pressingRef.current = false
			scheduleTilt(event)
		},
		[scheduleTilt]
	)

	if (show)
		return (
			<motion.div
				className={cn('card transform-gpu', className)}
				initial={{ opacity: 0, scale: 0.6, left: x, top: y, width, height }}
				animate={{ opacity: 1, scale: 1, left: x, top: y, width, height }}
				whileHover={shouldReduceMotion ? undefined : { scale: 1.035 }}
				whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
				onPointerEnter={handlePointerEnter}
				onPointerMove={scheduleTilt}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				onPointerCancel={resetTilt}
				onPointerLeave={resetTilt}
				style={{
					rotateX: shouldReduceMotion ? 0 : rotateX,
					rotateY: shouldReduceMotion ? 0 : rotateY,
					transformPerspective: 900,
					transformStyle: 'preserve-3d',
					willChange: 'transform'
				}}>
				{children}
			</motion.div>
		)

	return null
}
