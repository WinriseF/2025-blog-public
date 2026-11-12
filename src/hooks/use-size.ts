'use client'

import { useEffect } from 'react'
import { create } from 'zustand'

type SizeState = {
	init: boolean
	maxSM: boolean
	maxXS: boolean
	recalc: () => void
}

const initState = {
	init: false,
	maxSM: false,
	maxXS: false
}

const computeSize = (): Omit<SizeState, 'recalc'> => {
	const width = window.innerWidth

	return {
		init: true,
		maxSM: width < 640,
		maxXS: width < 360
	}
}

export const useSizeStore = create<SizeState>(set => ({
	...initState,
	recalc: () => {
		set(current => {
			const next = computeSize()
			if (
				current.init === next.init &&
				current.maxSM === next.maxSM &&
				current.maxXS === next.maxXS
			) {
				return current
			}
			return next
		})
	}
}))

export function useSizeInit() {
	useEffect(() => {
		let frame = 0
		const update = () => {
			if (frame) return
			frame = window.requestAnimationFrame(() => {
				frame = 0
				useSizeStore.getState().recalc()
			})
		}
		useSizeStore.getState().recalc()
		window.addEventListener('resize', update)
		return () => {
			if (frame) window.cancelAnimationFrame(frame)
			window.removeEventListener('resize', update)
		}
	}, [])
}

export const useSize = useSizeStore
