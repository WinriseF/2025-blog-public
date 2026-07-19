export type LanNativeAgentCapability = {
	device: 'desktop' | 'mobile'
	webTransport: boolean
	canHostAgent: boolean
}

type NavigatorWithUserAgentData = Navigator & {
	userAgentData?: { mobile?: boolean }
}

export function detectLanNativeAgentCapability(): LanNativeAgentCapability {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return { device: 'desktop', webTransport: false, canHostAgent: false }
	}

	const ua = navigator.userAgent.toLowerCase()
	const hintedMobile = Boolean((navigator as NavigatorWithUserAgentData).userAgentData?.mobile)
	const ipadDesktopMode = ua.includes('macintosh') && navigator.maxTouchPoints > 1
	const mobile = hintedMobile || ipadDesktopMode || /android|iphone|ipad|ipod|mobile|tablet/.test(ua)
	const webTransport = window.isSecureContext && 'WebTransport' in window
	return {
		device: mobile ? 'mobile' : 'desktop',
		webTransport,
		canHostAgent: !mobile && webTransport
	}
}
