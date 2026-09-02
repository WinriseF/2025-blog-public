'use client'

import HiCard from '@/app/(home)/hi-card'
import ArtCard from '@/app/(home)/art-card'
import ClockCard from '@/app/(home)/clock-card'
import CalendarCard from '@/app/(home)/calendar-card'
import MusicCard from '@/app/(home)/music-card'
import SocialButtons from '@/app/(home)/social-buttons'
import ShareCard from '@/app/(home)/share-card'
import AritcleCard from '@/app/(home)/aritcle-card'
import QuickControlsCard from '@/app/(home)/quick-controls-card'
import LikePosition from './like-position'
import { useSize } from '@/hooks/use-size'
import { useConfigStore } from './stores/config-store'

export default function Home() {
	const { maxSM } = useSize()
	const { cardStyles } = useConfigStore()

	return (
		<div className='max-sm:flex max-sm:flex-col max-sm:items-center max-sm:gap-6 max-sm:pt-28 max-sm:pb-20'>
			{cardStyles.artCard?.enabled !== false && <ArtCard />}
			{cardStyles.hiCard?.enabled !== false && <HiCard />}
			{!maxSM && cardStyles.clockCard?.enabled !== false && <ClockCard />}
			{!maxSM && cardStyles.calendarCard?.enabled !== false && <CalendarCard />}
			{!maxSM && cardStyles.musicCard?.enabled !== false && <MusicCard />}
			{cardStyles.socialButtons?.enabled !== false && <SocialButtons />}
			{!maxSM && cardStyles.shareCard?.enabled !== false && <ShareCard />}
			{cardStyles.articleCard?.enabled !== false && <AritcleCard />}
			{!maxSM && cardStyles.quickControls?.enabled !== false && <QuickControlsCard />}
			{cardStyles.likePosition?.enabled !== false && <LikePosition />}
		</div>
	)
}
