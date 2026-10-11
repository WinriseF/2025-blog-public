'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import PlaySVG from '@/svgs/play.svg'
import { formatMusicTime, MusicProgress, useMusicPlayer } from '@/components/music-player'
import { LoaderCircle, Pause } from 'lucide-react'
import { getAssetUrl } from '@/lib/asset-url'
import { OptimizedImage } from '@/components/optimized-image'

export default function MusicCard() {
	const router = useRouter()
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const playButtonRef = useRef<HTMLButtonElement | null>(null)
	const { currentMusic, currentTime, duration, hasMusic, isPlaying, isLoading, loadError, togglePlaybackFrom } = useMusicPlayer()
	const styles = cardStyles.musicCard
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard
	const calendarCardStyles = cardStyles.calendarCard

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2 - styles.offset
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset + CARD_SPACING + calendarCardStyles.height + CARD_SPACING
	const openMusicPage = () => router.push('/music')

	return (
		<Card order={styles.order} width={styles.width} height={styles.height} x={x} y={y} className='flex items-center gap-3 overflow-hidden'>
			<button type='button' onClick={openMusicPage} aria-label='打开音乐仓' className='bg-card h-10 w-10 shrink-0 overflow-hidden rounded-xl border'>
				{currentMusic && <OptimizedImage src={getAssetUrl(currentMusic.cover)} alt='' width={40} height={40} className='h-full w-full object-cover' />}
			</button>

			<div className='min-w-0 flex-1'>
				<div onClick={openMusicPage} className='cursor-pointer truncate text-sm font-medium'>
					{currentMusic?.name || '随机音乐'}
				</div>

				<MusicProgress className='mt-1' />

				<div onClick={openMusicPage} className='text-secondary mt-1 cursor-pointer truncate text-[11px]'>
					{loadError
						? '播放失败，请点播放按钮重试'
						: isLoading
							? '正在加载…'
							: hasMusic
								? `${formatMusicTime(currentTime)} / ${duration > 0 ? formatMusicTime(duration) : '—:—'}`
								: '还没有添加音乐'}
				</div>
			</div>

			<button
				ref={playButtonRef}
				type='button'
				aria-label={isLoading ? '取消加载' : isPlaying ? '暂停音乐' : loadError ? '重试播放' : '播放音乐'}
				disabled={!hasMusic}
				onClick={() => togglePlaybackFrom(playButtonRef.current?.getBoundingClientRect())}
				className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/70 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50'>
				{isLoading ? (
					<LoaderCircle className='text-brand h-4 w-4 animate-spin motion-reduce:animate-none' />
				) : isPlaying ? (
					<Pause className='text-brand h-4 w-4' />
				) : (
					<PlaySVG className='text-brand ml-1 h-4 w-4' />
				)}
			</button>
		</Card>
	)
}
