'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ScreenWakeLockSentinel = EventTarget & {
	released: boolean
	release: () => Promise<void>
}

type WakeLockNavigator = Navigator & {
	wakeLock?: {
		request: (type: 'screen') => Promise<ScreenWakeLockSentinel>
	}
}

export type ScreenWakeLockState = {
	ready: boolean
	supported: boolean
	enabled: boolean
	active: boolean
	setEnabled: (enabled: boolean) => void
}

type ScreenWakeLockOptions = {
	active?: boolean
	storageKey?: string
	defaultEnabled?: boolean
}

export function useScreenWakeLock({ active: engaged = true, storageKey, defaultEnabled = true }: ScreenWakeLockOptions = {}): ScreenWakeLockState {
	const lockRef = useRef<ScreenWakeLockSentinel | null>(null)
	const lifecycleRef = useRef(0)
	const [ready, setReady] = useState(false)
	const [supported, setSupported] = useState(false)
	const [enabled, setEnabledState] = useState(defaultEnabled)
	const [active, setActive] = useState(false)

	useEffect(() => {
		if (storageKey) {
			try {
				setEnabledState(localStorage.getItem(storageKey) !== 'false')
			} catch {}
		}
		setSupported(Boolean((navigator as WakeLockNavigator).wakeLock))
		setReady(true)
	}, [storageKey])

	useEffect(() => {
		if (!ready || !supported || !enabled || !engaged) return

		const lifecycle = ++lifecycleRef.current
		let disposed = false
		let requesting = false

		const releaseCurrent = async () => {
			const lock = lockRef.current
			lockRef.current = null
			setActive(false)
			if (lock && !lock.released) await lock.release().catch(() => {})
		}

		const requestLock = async () => {
			if (disposed || requesting || document.visibilityState !== 'visible' || lockRef.current) return
			requesting = true
			try {
				const lock = await (navigator as WakeLockNavigator).wakeLock!.request('screen')
				if (disposed || lifecycleRef.current !== lifecycle || !enabled) {
					await lock.release().catch(() => {})
					return
				}
				lockRef.current = lock
				setActive(true)
				lock.addEventListener('release', () => {
					if (lockRef.current !== lock) return
					lockRef.current = null
					setActive(false)
				}, { once: true })
			} catch {
				if (!disposed) setActive(false)
			} finally {
				requesting = false
			}
		}

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') void requestLock()
		}

		void requestLock()
		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => {
			disposed = true
			lifecycleRef.current += 1
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			void releaseCurrent()
		}
	}, [enabled, engaged, ready, supported])

	const setEnabled = useCallback((value: boolean) => {
		setEnabledState(value)
		if (!storageKey) return
		try {
			localStorage.setItem(storageKey, String(value))
		} catch {}
	}, [storageKey])

	return { ready, supported, enabled, active, setEnabled }
}

