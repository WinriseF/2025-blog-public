'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'click-effect-enabled'

type ClickEffectPreferenceValue = {
	ready: boolean
	enabled: boolean
	setEnabled: (enabled: boolean) => void
}

const ClickEffectPreferenceContext = createContext<ClickEffectPreferenceValue>({
	ready: false,
	enabled: true,
	setEnabled: () => {}
})

export function ClickEffectPreferenceProvider({ children }: { children: React.ReactNode }) {
	const [ready, setReady] = useState(false)
	const [enabled, setEnabledState] = useState(true)

	useEffect(() => {
		try {
			setEnabledState(localStorage.getItem(STORAGE_KEY) !== 'false')
		} catch {}
		setReady(true)
	}, [])

	const setEnabled = useCallback((nextEnabled: boolean) => {
		setEnabledState(nextEnabled)
		try {
			localStorage.setItem(STORAGE_KEY, String(nextEnabled))
		} catch {}
	}, [])

	const value = useMemo(() => ({ ready, enabled, setEnabled }), [ready, enabled, setEnabled])
	return <ClickEffectPreferenceContext.Provider value={value}>{children}</ClickEffectPreferenceContext.Provider>
}

export function useClickEffectPreference() {
	return useContext(ClickEffectPreferenceContext)
}
