'use client'
import { PropsWithChildren, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { useCenterInit } from '@/hooks/use-center'
import TimeAtmosphereBackground from './backgrounds/time-atmosphere-background'
import NavCard from '@/components/nav-card'
import { Toaster } from 'sonner'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { useSize, useSizeInit } from '@/hooks/use-size'
import { useConfigStore } from '@/app/(home)/stores/config-store'
import { ScrollTopButton } from '@/components/scroll-top-button'
import { MusicPlayerProvider } from '@/components/music-player'
import { TimeThemeProvider, useTimeTheme } from '@/components/time-theme-provider'
import { usePathname } from 'next/navigation'
import { getAssetUrl } from '@/lib/asset-url'

const HOME_FIT_DESIGN_WIDTH = 2048
const HOME_FIT_DESIGN_HEIGHT = 1152
const HOME_FIT_SCALE_BOOST = 1.35
const HOME_MOBILE_BREAKPOINT = 640

function getInitialHomeFitScale() {
	const viewport = window.visualViewport
	const width = viewport?.width || window.innerWidth
	const height = viewport?.height || window.innerHeight

	if (width < HOME_MOBILE_BREAKPOINT) return 1

	const fitScale = Math.min(width / HOME_FIT_DESIGN_WIDTH, height / HOME_FIT_DESIGN_HEIGHT)
	return Math.min(1, fitScale * HOME_FIT_SCALE_BOOST)
}

export default function Layout({ children }: PropsWithChildren) {
	return (
		<TimeThemeProvider>
			<ThemedLayout>{children}</ThemedLayout>
		</TimeThemeProvider>
	)
}

function ThemedLayout({ children }: PropsWithChildren) {
	useCenterInit()
	useSizeInit()
	const { siteContent, regenerateKey } = useConfigStore()
	const { maxSM, init } = useSize()
	const { theme: timeTheme } = useTimeTheme()
	const pathname = usePathname()
	const homeFitActive = pathname === '/' && !maxSM
	const [homeFit, setHomeFit] = useState({ ready: false, scale: 1 })
	const [mounted, setMounted] = useState(false)

	const backgroundImages = (siteContent.backgroundImages ?? []) as Array<{ id: string; url: string }>
	const currentBackgroundImageId = siteContent.currentBackgroundImageId
	const currentBackgroundImage =
		currentBackgroundImageId && currentBackgroundImageId.trim() ? backgroundImages.find(item => item.id === currentBackgroundImageId) : null
	const mainStyle: CSSProperties | undefined = homeFitActive
		? {
				opacity: homeFit.ready ? 1 : 0,
				transform: `scale(${homeFit.scale})`,
				transformOrigin: 'center center'
			}
		: undefined

	useEffect(() => {
		setMounted(true)
	}, [])

	useLayoutEffect(() => {
		if (pathname !== '/') {
			setHomeFit({ ready: true, scale: 1 })
			return
		}

		setHomeFit({
			ready: true,
			scale: getInitialHomeFitScale()
		})
	}, [pathname])

	return (
		<MusicPlayerProvider>
			<Toaster
				position='bottom-right'
				richColors
				icons={{
					success: <CircleCheckIcon className='size-4' />,
					info: <InfoIcon className='size-4' />,
					warning: <TriangleAlertIcon className='size-4' />,
					error: <OctagonXIcon className='size-4' />,
					loading: <Loader2Icon className='size-4 animate-spin' />
				}}
				style={
					{
						'--border-radius': '12px'
					} as React.CSSProperties
				}
			/>
			{mounted ? (
				<TimeAtmosphereBackground
					theme={timeTheme}
					backgroundImage={getAssetUrl(currentBackgroundImage?.url)}
					regenerateKey={`${regenerateKey}-${timeTheme.name}`}
				/>
			) : (
				<div className='pointer-events-none fixed inset-0 z-0 bg-bg' />
			)}
			<main className='relative z-10 h-full' style={mainStyle}>
				{children}
				<NavCard />
			</main>

			{maxSM && init && <ScrollTopButton className='bg-brand/20 fixed right-6 bottom-8 z-50 shadow-md' />}
		</MusicPlayerProvider>
	)
}
