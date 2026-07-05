import { create } from 'zustand'
import siteContent from '@/config/site-content.json'
import cardStyles from '@/config/card-styles.json'

export type SiteContent = typeof siteContent
export type CardStyles = typeof cardStyles

interface ConfigStore {
	siteContent: SiteContent
	cardStyles: CardStyles
	regenerateKey: number
	setSiteContent: (content: SiteContent) => void
	setCardStyles: (styles: CardStyles) => void
	regenerateBubbles: () => void
}

export const useConfigStore = create<ConfigStore>(set => ({
	siteContent: { ...siteContent },
	cardStyles: { ...cardStyles },
	regenerateKey: 0,
	setSiteContent: (content: SiteContent) => {
		set({ siteContent: content })
	},
	setCardStyles: (styles: CardStyles) => {
		set({ cardStyles: styles })
	},
	regenerateBubbles: () => {
		set(state => ({ regenerateKey: state.regenerateKey + 1 }))
	}
}))

