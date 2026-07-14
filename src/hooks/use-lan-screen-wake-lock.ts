'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const WAKE_LOCK_PREFERENCE_KEY = 'lan-screen-wake-lock-enabled'

type ScreenWakeLockSentinel = EventTarget & {
	released: boolean
	release: () => Promise<void>
}

type WakeLockNavigator = Navigator & {
	wakeLock?: {
		request: (type: 'screen') => Promise<ScreenWakeLockSentinel>
	}
}

export type LanScreenWakeLockState = {
	ready: boolean
	supported: boolean
	enabled: boolean
	active: boolean
	setEnabled: (enabled: boolean) => void
}

export function useLanScreenWakeLock(): LanScreenWakeLockState {
	const lockRef = useRef<ScreenWakeLockSentinel | null>(null)
	const lifecycleRef = useRef(0)
	const [ready, setReady] = useState(false)
	const [supported, setSupported] = useState(false)
	const [enabled, setEnabledState] = useState(true)
	const [active, setActive] = useState(false)

	useEffect(() => {
		try {
			setEnabledState(localStorage.getItem(WAKE_LOCK_PREFERENCE_KEY) !== 'false')
		} catch {}
		setSupported(Boolean((navigator as WakeLockNavigator).wakeLock))
		setReady(true)
	}, [])

	useEffect(() => {
		if (!ready || !supported || !enabled) return

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
			} catch (error) {
				if (!disposed) {
					setActive(false)
					console.warn('[LAN] 无法保持屏幕常亮：', error instanceof Error ? error.message : error)
				}
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
	}, [enabled, ready, supported])

	const setEnabled = useCallback((value: boolean) => {
		setEnabledState(value)
		try {
			localStorage.setItem(WAKE_LOCK_PREFERENCE_KEY, String(value))
		} catch {}
	}, [])

	return { ready, supported, enabled, active, setEnabled }
}
