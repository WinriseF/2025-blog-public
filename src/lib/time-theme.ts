export type TimeThemeName = 'dawn' | 'noon' | 'sunset' | 'night'

export type TimeTheme = {
	name: TimeThemeName
	colors: {
		brand: string
		brandSecondary: string
		primary: string
		secondary: string
		bg: string
		border: string
		card: string
		article: string
		bubbles: string[]
	}
}

export const timeThemes: Record<TimeThemeName, TimeTheme> = {
	dawn: {
		name: 'dawn',
		colors: {
			brand: '#7BA7FF',
			brandSecondary: '#F5A7C8',
			primary: '#2E4A55',
			secondary: '#768A96',
			bg: '#EAF1F4',
			border: '#FFFFFFB8',
			card: '#FFFFFF72',
			article: '#FFFFFFD6',
			bubbles: ['#B8D7FF', '#F6CAD8', '#DCE7C7', '#B4C6E8']
		}
	},
	noon: {
		name: 'noon',
		colors: {
			brand: '#35BFAB',
			brandSecondary: '#7CCBFF',
			primary: '#334F52',
			secondary: '#72858A',
			bg: '#F1F0E8',
			border: '#FFFFFF',
			card: '#FFFFFF72',
			article: '#FFFFFFD8',
			bubbles: ['#B7E6D4', '#F3E58F', '#BDE7FF', '#C7D889']
		}
	},
	sunset: {
		name: 'sunset',
		colors: {
			brand: '#F06C8F',
			brandSecondary: '#F4B65F',
			primary: '#4B3D43',
			secondary: '#8C7774',
			bg: '#F3E9DF',
			border: '#FFFFFFB8',
			card: '#FFFFFF66',
			article: '#FFF7EBD8',
			bubbles: ['#F4B65F', '#F06C8F', '#B98BE8', '#F5D083']
		}
	},
	night: {
		name: 'night',
		colors: {
			brand: '#8B8CFF',
			brandSecondary: '#39D4C8',
			primary: '#DDE8E6',
			secondary: '#91A5AA',
			bg: '#10181B',
			border: '#FFFFFF24',
			card: '#182326A8',
			article: '#182326D8',
			bubbles: ['#243A70', '#4E2A72', '#123E42', '#2D3D57']
		}
	}
}

export function getTimeThemeName(date = new Date()): TimeThemeName {
	const hour = date.getHours()
	if (hour >= 5 && hour < 9) return 'dawn'
	if (hour >= 9 && hour < 16) return 'noon'
	if (hour >= 16 && hour < 19) return 'sunset'
	return 'night'
}

export function getTimeTheme(date = new Date()) {
	return timeThemes[getTimeThemeName(date)]
}

export function getMsUntilNextTimeTheme(date = new Date()) {
	const hour = date.getHours()
	const next = new Date(date)
	next.setMinutes(0, 0, 0)

	if (hour < 5) next.setHours(5)
	else if (hour < 9) next.setHours(9)
	else if (hour < 16) next.setHours(16)
	else if (hour < 19) next.setHours(19)
	else {
		next.setDate(next.getDate() + 1)
		next.setHours(5)
	}

	return Math.max(next.getTime() - date.getTime() + 1000, 1000)
}

export function applyTimeTheme(theme: TimeTheme, target: HTMLElement) {
	target.dataset.timeTheme = theme.name
	target.style.setProperty('--color-brand', theme.colors.brand)
	target.style.setProperty('--color-brand-secondary', theme.colors.brandSecondary)
	target.style.setProperty('--color-primary', theme.colors.primary)
	target.style.setProperty('--color-secondary', theme.colors.secondary)
	target.style.setProperty('--color-bg', theme.colors.bg)
	target.style.setProperty('--color-border', theme.colors.border)
	target.style.setProperty('--color-card', theme.colors.card)
	target.style.setProperty('--color-article', theme.colors.article)
	target.style.setProperty('color-scheme', theme.name === 'night' ? 'dark' : 'light')
}

export function getTimeThemeInitScript() {
	const payload = JSON.stringify(timeThemes)

	return `
		(() => {
			const themes = ${payload};
			const hour = new Date().getHours();
			const name = hour >= 5 && hour < 9 ? 'dawn' : hour >= 9 && hour < 16 ? 'noon' : hour >= 16 && hour < 19 ? 'sunset' : 'night';
			const theme = themes[name];
			const root = document.documentElement;
			root.dataset.timeTheme = name;
			root.style.setProperty('--color-brand', theme.colors.brand);
			root.style.setProperty('--color-brand-secondary', theme.colors.brandSecondary);
			root.style.setProperty('--color-primary', theme.colors.primary);
			root.style.setProperty('--color-secondary', theme.colors.secondary);
			root.style.setProperty('--color-bg', theme.colors.bg);
			root.style.setProperty('--color-border', theme.colors.border);
			root.style.setProperty('--color-card', theme.colors.card);
			root.style.setProperty('--color-article', theme.colors.article);
			root.style.setProperty('color-scheme', name === 'night' ? 'dark' : 'light');
		})();
	`
}
