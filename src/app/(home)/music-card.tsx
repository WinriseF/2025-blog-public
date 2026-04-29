'use client'

import { useEffect, useRef, useState } from 'react'
import Card from '@/components/card'
import { useCenterStore } from '@/hooks/use-center'
import { useConfigStore } from './stores/config-store'
import { CARD_SPACING } from '@/consts'
import MusicSVG from '@/svgs/music.svg'
import PlaySVG from '@/svgs/play.svg'
import { HomeDraggableLayer } from './home-draggable-layer'
import { list } from '@/app/music/list'
import { Pause } from 'lucide-react'

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
	const mins = Math.floor(seconds / 60)
	const secs = Math.floor(seconds % 60)
	return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function MusicCard() {
	const center = useCenterStore()
	const { cardStyles } = useConfigStore()
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [loadError, setLoadError] = useState(false)
	const styles = cardStyles.musicCard
	const hiCardStyles = cardStyles.hiCard
	const clockCardStyles = cardStyles.clockCard
	const calendarCardStyles = cardStyles.calendarCard
	const currentMusic = list[0]
	const hasMusic = Boolean(currentMusic?.src)
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0

	const x = styles.offsetX !== null ? center.x + styles.offsetX : center.x + CARD_SPACING + hiCardStyles.width / 2 - styles.offset
	const y = styles.offsetY !== null ? center.y + styles.offsetY : center.y - clockCardStyles.offset + CARD_SPACING + calendarCardStyles.height + CARD_SPACING

	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		const handleLoadedMetadata = () => {
			setDuration(audio.duration || 0)
			setLoadError(false)
		}
		const handleTimeUpdate = () => {
			setCurrentTime(audio.currentTime || 0)
		}
		const handleEnded = () => {
			setIsPlaying(false)
			setCurrentTime(0)
		}
		const handleError = () => {
			setIsPlaying(false)
			setLoadError(true)
		}

		audio.addEventListener('loadedmetadata', handleLoadedMetadata)
		audio.addEventListener('timeupdate', handleTimeUpdate)
		audio.addEventListener('ended', handleEnded)
		audio.addEventListener('error', handleError)

		return () => {
			audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
			audio.removeEventListener('timeupdate', handleTimeUpdate)
			audio.removeEventListener('ended', handleEnded)
			audio.removeEventListener('error', handleError)
		}
	}, [currentMusic?.src])

	useEffect(() => {
		setIsPlaying(false)
		setCurrentTime(0)
		setDuration(0)
		setLoadError(false)
		if (audioRef.current) {
			audioRef.current.pause()
			audioRef.current.load()
		}
	}, [currentMusic?.src])

	const togglePlayback = async () => {
		const audio = audioRef.current
		if (!audio || !hasMusic) return

		if (audio.paused) {
			try {
				await audio.play()
				setIsPlaying(true)
				setLoadError(false)
			} catch {
				setIsPlaying(false)
				setLoadError(true)
			}
			return
		}

		audio.pause()
		setIsPlaying(false)
	}

	return (
		<HomeDraggableLayer cardKey='musicCard' x={x} y={y} width={styles.width} height={styles.height}>
			<Card order={styles.order} width={styles.width} height={styles.height} x={x} y={y} className='flex items-center gap-3 overflow-hidden'>
				<audio ref={audioRef} preload='metadata'>
					{currentMusic?.src ? <source src={currentMusic.src} type='audio/mpeg' /> : null}
				</audio>
				<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border bg-white/45'>
					<MusicSVG className='h-5 w-5' />
				</div>

				<div className='min-w-0 flex-1'>
					<div className='truncate text-sm font-medium'>{currentMusic?.name || '随机音乐'}</div>

					<div className='mt-1 h-2 rounded-full bg-white/60'>
						<div className='bg-linear h-full rounded-full transition-[width]' style={{ width: `${progress}%` }} />
					</div>

					<div className='text-secondary mt-1 truncate text-[11px]'>
						{loadError ? '音频资源加载失败' : hasMusic ? `${formatTime(currentTime)} / ${formatTime(duration)}` : '还没有添加音乐'}
					</div>
				</div>

				<button
					type='button'
					disabled={!hasMusic}
					onClick={togglePlayback}
					className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/70 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50'>
					{isPlaying ? <Pause className='text-brand h-4 w-4' /> : <PlaySVG className='text-brand ml-1 h-4 w-4' />}
				</button>
			</Card>
		</HomeDraggableLayer>
	)
}
