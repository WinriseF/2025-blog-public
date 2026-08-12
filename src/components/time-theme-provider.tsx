'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { applyTimeTheme, getMsUntilNextTimeTheme, getTimeTheme, getTimeThemeName, timeThemes, type TimeTheme, type TimeThemeName } from '@/lib/time-theme'

const themeCycle: TimeThemeName[] = ['dawn', 'noon', 'sunset', 'night']

type TimeThemeContextValue = {
	theme: TimeTheme
	manual: boolean
	transitioning: boolean
	cycleTheme: () => void
}

type NativeViewTransition = {
	finished: Promise<void>
}

type ViewTransitionDocument = Document & {
	startViewTransition?: (update: () => void) => NativeViewTransition
}

function getInitialThemeFromDom(): TimeTheme {
	if (typeof document === 'undefined') return getTimeTheme()

	const name = document.documentElement.dataset.timeTheme as TimeThemeName | undefined
	return name && timeThemes[name] ? timeThemes[name] : getTimeTheme()
}

const TimeThemeContext = createContext<TimeThemeContextValue>({
	theme: getTimeTheme(),
	manual: false,
	transitioning: false,
	cycleTheme: () => {}
})

export function TimeThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<TimeTheme>(() => getInitialThemeFromDom())
	const [manualThemeName, setManualThemeName] = useState<TimeThemeName | null>(null)
	const [transitioning, setTransitioning] = useState(false)
	const themeTransitionId = useRef(0)

	const applyTheme = useCallback((nextTheme: TimeTheme) => {
		const root = document.documentElement
		if (root.dataset.timeTheme === nextTheme.name) return

		const updateTheme = () => {
			applyTimeTheme(nextTheme, root)
			flushSync(() => setTheme(nextTheme))
		}
		const documentWithViewTransition = document as ViewTransitionDocument

		if (!documentWithViewTransition.startViewTransition || document.hidden) {
			updateTheme()
			return
		}

		const transitionId = ++themeTransitionId.current
		root.classList.add('time-theme-transitioning')
		flushSync(() => setTransitioning(true))
		const transition = documentWithViewTransition.startViewTransition(updateTheme)
		const finish = () => {
			if (themeTransitionId.current !== transitionId) return
			root.classList.remove('time-theme-transitioning')
			setTransitioning(false)
		}

		void transition.finished.then(finish, finish)
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
			transitioning,
			cycleTheme
		}),
		[theme, manualThemeName, transitioning, cycleTheme]
	)

	return <TimeThemeContext.Provider value={value}>{children}</TimeThemeContext.Provider>
}

export function useTimeTheme() {
	return useContext(TimeThemeContext)
}
