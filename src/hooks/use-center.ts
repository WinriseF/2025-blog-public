'use client'

import { useEffect } from 'react'
import { create } from 'zustand'

type CenterState = {
	x: number
	y: number
	centerX: number
	centerY: number
	width: number
	height: number
	setCenter: (x: number, y: number) => void
	recalc: () => void
}

const computeCenter = () => {
	const width = window.innerWidth
	const height = window.innerHeight
	return {
		x: Math.floor(width / 2),
		y: Math.floor(height / 2) - 24,
		centerX: Math.floor(width / 2),
		centerY: Math.floor(height / 2),
		width,
		height
	}
}

export const useCenterStore = create<CenterState>(set => ({
	x: 0,
	y: 0,
	centerX: 0,
	centerY: 0,
	width: 0,
	height: 0,
	setCenter: (x, y) => set({ x, y }),
	recalc: () => {
		const c = computeCenter()
		set(current => {
			if (
				current.x === c.x &&
				current.y === c.y &&
				current.centerX === c.centerX &&
				current.centerY === c.centerY &&
				current.width === c.width &&
				current.height === c.height
			) {
				return current
			}
			return c
		})
	}
}))

export function useCenterInit() {
	useEffect(() => {
		let frame = 0
		const update = () => {
			if (frame) return
			frame = window.requestAnimationFrame(() => {
				frame = 0
				useCenterStore.getState().recalc()
			})
		}
		useCenterStore.getState().recalc()
		window.addEventListener('resize', update)
		return () => {
			if (frame) window.cancelAnimationFrame(frame)
			window.removeEventListener('resize', update)
		}
	}, [])
}
