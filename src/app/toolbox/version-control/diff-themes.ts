import type { DiffsThemeNames } from '@pierre/diffs'
import type { TimeThemeName } from '@/lib/time-theme'

export type OfficialDiffThemeId = 'pierre-light' | 'pierre-dark'
export type DiffThemeId = TimeThemeName | OfficialDiffThemeId

export type DiffThemeDefinition = Readonly<{
	label: string
	shiki: DiffsThemeNames
	type: 'light' | 'dark'
	background: string
	foreground: string
}>

const nextTimeTheme: Record<TimeThemeName, TimeThemeName> = {
	dawn: 'noon',
	noon: 'sunset',
	sunset: 'night',
	night: 'dawn'
}

export const diffThemes: Record<DiffThemeId, DiffThemeDefinition> = {
	dawn: {
		label: '清晨',
		shiki: 'catppuccin-latte',
		type: 'light',
		background: '#eff1f5',
		foreground: '#4c4f69'
	},
	noon: {
		label: '白天',
		shiki: 'vitesse-light',
		type: 'light',
		background: '#ffffff',
		foreground: '#393a34'
	},
	sunset: {
		label: '黄昏',
		shiki: 'rose-pine-dawn',
		type: 'light',
		background: '#faf4ed',
		foreground: '#575279'
	},
	night: {
		label: '夜晚',
		shiki: 'poimandres',
		type: 'dark',
		background: '#1b1e28',
		foreground: '#a6accd'
	},
	'pierre-light': {
		label: '官方亮',
		shiki: 'pierre-light',
		type: 'light',
		background: '#ffffff',
		foreground: '#0a0a0a'
	},
	'pierre-dark': {
		label: '官方暗',
		shiki: 'pierre-dark',
		type: 'dark',
		background: '#0a0a0a',
		foreground: '#fafafa'
	}
}

export function isOfficialDiffTheme(theme: DiffThemeId): theme is OfficialDiffThemeId {
	return theme === 'pierre-light' || theme === 'pierre-dark'
}

export function getNextOfficialDiffTheme(theme: DiffThemeId): OfficialDiffThemeId {
	if (theme === 'pierre-light') return 'pierre-dark'
	if (theme === 'pierre-dark') return 'pierre-light'
	return diffThemes[theme].type === 'dark' ? 'pierre-dark' : 'pierre-light'
}

export function getNextTimeDiffTheme(theme: TimeThemeName) {
	return nextTimeTheme[theme]
}
