'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { applyTimeTheme, getMsUntilNextTimeTheme, getTimeTheme, getTimeThemeName, timeThemes, type TimeTheme, type TimeThemeName } from '@/lib/time-theme'

const themeCycle: TimeThemeName[] = ['dawn', 'noon', 'sunset', 'night']

type TimeThemeContextValue = {
	theme: TimeTheme
	manual: boolean
	cycleTheme: () => void
}

function getInitialThemeFromDom(): TimeTheme {
	if (typeof document === 'undefined') return getTimeTheme()

	const name = document.documentElement.dataset.timeTheme as TimeThemeName | undefined
	return name && timeThemes[name] ? timeThemes[name] : getTimeTheme()
}

const TimeThemeContext = createContext<TimeThemeContextValue>({
	theme: getTimeTheme(),
	manual: false,
	cycleTheme: () => {}
})

export function TimeThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<TimeTheme>(() => getInitialThemeFromDom())
	const [manualThemeName, setManualThemeName] = useState<TimeThemeName | null>(null)

	const applyTheme = useCallback((nextTheme: TimeTheme) => {
		const root = document.documentElement
		if (root.dataset.timeTheme !== nextTheme.name) applyTimeTheme(nextTheme, root)
		setTheme(current => (current.name === nextTheme.name ? current : nextTheme))
	}, [])

	useEffect(() => {
		if (manualThemeName) return

		let timer: number | null = null

		const updateTheme = () => {
			applyTheme(getTimeTheme())

			if (timer !== null) window.clearTimeout(timer)
			timer = window.setTimeout(updateTheme, getMsUntilNextTimeTheme())
		}

		updateTheme()
		document.addEventListener('visibilitychange', updateTheme)

		return () => {
			if (timer !== null) window.clearTimeout(timer)
			document.removeEventListener('visibilitychange', updateTheme)
		}
	}, [applyTheme, manualThemeName])

	const cycleTheme = useCallback(() => {
		const activeName = manualThemeName ?? theme.name ?? getTimeThemeName()
		const activeIndex = themeCycle.indexOf(activeName)
		const nextName = themeCycle[(activeIndex + 1) % themeCycle.length]

		setManualThemeName(nextName)
		applyTheme(timeThemes[nextName])
	}, [applyTheme, manualThemeName, theme.name])

	const value = useMemo(
		() => ({
			theme,
			manual: manualThemeName !== null,
			cycleTheme
		}),
		[theme, manualThemeName, cycleTheme]
	)

	return <TimeThemeContext.Provider value={value}>{children}</TimeThemeContext.Provider>
}

export function useTimeTheme() {
	return useContext(TimeThemeContext)
}
