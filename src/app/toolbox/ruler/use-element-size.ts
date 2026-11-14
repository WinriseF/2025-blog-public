'use client'

import { useEffect, useRef, useState } from 'react'

export function useElementSize<T extends HTMLElement>() {
	const ref = useRef<T>(null)
	const [size, setSize] = useState({ width: 0, height: 0 })
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	return { ref, ...size }
}
