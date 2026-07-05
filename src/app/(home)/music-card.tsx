'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import PlaySVG from '@/svgs/play.svg'
import { formatMusicTime, MusicProgress, useMusicPlayer } from '@/components/music-player'
import { Music2, Pause } from 'lucide-react'

export default function MusicCard() {
	const router = useRouter()
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const playButtonRef = useRef<HTMLButtonElement | null>(null)
	const { currentMusic, currentTime, duration, hasMusic, isPlaying, loadError, togglePlaybackFrom } = useMusicPlayer()
	const styles = cardStyles.musicCard
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard
	const calendarCardStyles = cardStyles.calendarCard

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2 - styles.offset
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset + CARD_SPACING + calendarCardStyles.height + CARD_SPACING
	const openMusicPage = () => router.push('/music')

	return (
		<Card order={styles.order} width={styles.width} height={styles.height} x={x} y={y} className='flex items-center gap-3 overflow-hidden'>
			<div onClick={openMusicPage} className='flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl border bg-white/45'>
				<Music2 className='text-brand h-5 w-5' />
			</div>

			<div className='min-w-0 flex-1'>
				<div onClick={openMusicPage} className='cursor-pointer truncate text-sm font-medium'>
					{currentMusic?.name || '随机音乐'}
				</div>

				<MusicProgress className='mt-1' />

				<div onClick={openMusicPage} className='text-secondary mt-1 cursor-pointer truncate text-[11px]'>
					{loadError ? '音频资源加载失败' : hasMusic ? `${formatMusicTime(currentTime)} / ${formatMusicTime(duration)}` : '还没有添加音乐'}
				</div>
			</div>

			<button
				ref={playButtonRef}
				type='button'
				disabled={!hasMusic}
				onClick={() => togglePlaybackFrom(playButtonRef.current?.getBoundingClientRect())}
				className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/70 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50'>
				{isPlaying ? <Pause className='text-brand h-4 w-4' /> : <PlaySVG className='text-brand ml-1 h-4 w-4' />}
			</button>
		</Card>
	)
}
