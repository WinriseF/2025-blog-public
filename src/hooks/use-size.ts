'use client'

import { useEffect } from 'react'
import { create } from 'zustand'

type SizeState = {
	init: boolean
	maxXL: boolean
	maxLG: boolean
	maxMD: boolean
	maxSM: boolean
	maxXS: boolean
	recalc: () => void
}

const initState = {
	init: false,
	maxXL: false,
	maxLG: false,
	maxMD: false,
	maxSM: false,
	maxXS: false
}

const computeSize = (): Omit<SizeState, 'recalc'> => {
	const width = window.innerWidth

	return {
		init: true,
		maxXL: width < 1280,
		maxLG: width < 1024,
		maxMD: width < 768,
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
				current.maxXL === next.maxXL &&
				current.maxLG === next.maxLG &&
				current.maxMD === next.maxMD &&
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
