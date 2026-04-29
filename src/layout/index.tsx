'use client'
import { PropsWithChildren } from 'react'
import { useCenterInit } from '@/hooks/use-center'
import BlurredBubblesBackground from './backgrounds/blurred-bubbles'
import NavCard from '@/components/nav-card'
import { Toaster } from 'sonner'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { useSize, useSizeInit } from '@/hooks/use-size'
import { useConfigStore } from '@/app/(home)/stores/config-store'
import { ScrollTopButton } from '@/components/scroll-top-button'
import { MusicPlayerProvider } from '@/components/music-player'
import { TimeThemeProvider, useTimeTheme } from '@/components/time-theme-provider'

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

	const backgroundImages = (siteContent.backgroundImages ?? []) as Array<{ id: string; url: string }>
	const currentBackgroundImageId = siteContent.currentBackgroundImageId
	const currentBackgroundImage =
		currentBackgroundImageId && currentBackgroundImageId.trim() ? backgroundImages.find(item => item.id === currentBackgroundImageId) : null

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
			{currentBackgroundImage && (
				<div
					className='fixed inset-0 z-0 overflow-hidden'
					style={{
						backgroundImage: `url(${currentBackgroundImage.url})`,
						backgroundSize: 'cover',
						backgroundPosition: 'center',
						backgroundRepeat: 'no-repeat'
					}}
				/>
			)}
			<BlurredBubblesBackground colors={timeTheme.colors.bubbles} regenerateKey={`${regenerateKey}-${timeTheme.name}`} />
			<main className='relative z-10 h-full'>
				{children}
				<NavCard />
			</main>

			{maxSM && init && <ScrollTopButton className='bg-brand/20 fixed right-6 bottom-8 z-50 shadow-md' />}
		</MusicPlayerProvider>
	)
}
