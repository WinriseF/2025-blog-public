'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Music2, Pause } from 'lucide-react'
import PlaySVG from '@/svgs/play.svg'
import { list, type MusicItem } from '@/app/music/list'
import { cn } from '@/lib/utils'

type MusicPlayerContextValue = {
	currentMusic?: MusicItem
	currentTime: number
	duration: number
	hasMusic: boolean
	isPlaying: boolean
	loadError: boolean
	progress: number
	seek: (value: number) => void
	togglePlayback: () => Promise<void>
	togglePlaybackFrom: (rect?: DOMRect) => Promise<void>
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null)
const floatingPlayerTarget = { x: 0, y: 0 }

type FlightAnimation = {
	id: number
	from: {
		x: number
		y: number
	}
	to: {
		x: number
		y: number
	}
}

export function formatMusicTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
	const mins = Math.floor(seconds / 60)
	const secs = Math.floor(seconds % 60)
	return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const currentMusic = list[0]
	const hasMusic = Boolean(currentMusic?.src)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [loadError, setLoadError] = useState(false)
	const [hasStarted, setHasStarted] = useState(false)
	const [showFloatingPlayer, setShowFloatingPlayer] = useState(false)
	const [flightAnimation, setFlightAnimation] = useState<FlightAnimation | null>(null)
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0

	const syncDuration = useCallback(() => {
		const audio = audioRef.current
		if (!audio) return
		setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
	}, [])

	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		const handleLoadedMetadata = () => {
			syncDuration()
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
		audio.addEventListener('durationchange', syncDuration)
		audio.addEventListener('canplay', syncDuration)
		audio.addEventListener('timeupdate', handleTimeUpdate)
		audio.addEventListener('ended', handleEnded)
		audio.addEventListener('error', handleError)

		return () => {
			audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
			audio.removeEventListener('durationchange', syncDuration)
			audio.removeEventListener('canplay', syncDuration)
			audio.removeEventListener('timeupdate', handleTimeUpdate)
			audio.removeEventListener('ended', handleEnded)
			audio.removeEventListener('error', handleError)
		}
	}, [syncDuration])

	useEffect(() => {
		const audio = audioRef.current
		setIsPlaying(false)
		setCurrentTime(0)
		setDuration(0)
		setLoadError(false)
		setHasStarted(false)
		setShowFloatingPlayer(false)
		setFlightAnimation(null)
		if (audio) {
			audio.pause()
			audio.load()
		}
	}, [currentMusic?.src])

	const togglePlaybackCore = useCallback(
		async (showPlayerImmediately: boolean) => {
			const audio = audioRef.current
			if (!audio || !hasMusic) return

			if (audio.paused) {
				try {
					await audio.play()
					setIsPlaying(true)
					setHasStarted(true)
					if (showPlayerImmediately) setShowFloatingPlayer(true)
					setLoadError(false)
					syncDuration()
				} catch {
					setIsPlaying(false)
					setLoadError(true)
				}
				return
			}

			audio.pause()
			setIsPlaying(false)
		},
		[hasMusic, syncDuration]
	)

	const togglePlayback = useCallback(async () => {
		await togglePlaybackCore(true)
	}, [togglePlaybackCore])

	const togglePlaybackFrom = useCallback(
		async (rect?: DOMRect) => {
			const wasStarted = hasStarted
			await togglePlaybackCore(wasStarted || !rect)

			if (!rect || wasStarted) return

			const isSmallScreen = window.matchMedia('(max-width: 640px)').matches
			const targetX = window.innerWidth - (isSmallScreen ? 176 : 166)
			const targetY = window.innerHeight - (isSmallScreen ? 64 : 54)
			const animation = {
				id: Date.now(),
				from: {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2
				},
				to: {
					x: targetX,
					y: targetY
				}
			}

			floatingPlayerTarget.x = targetX
			floatingPlayerTarget.y = targetY
			setShowFloatingPlayer(false)
			setFlightAnimation(animation)
			window.setTimeout(() => setShowFloatingPlayer(true), 520)
		},
		[hasStarted, togglePlaybackCore]
	)

	const seek = useCallback(
		(value: number) => {
			const audio = audioRef.current
			if (!audio || !Number.isFinite(value)) return
			audio.currentTime = Math.min(Math.max(value, 0), duration || value)
			setCurrentTime(audio.currentTime)
		},
		[duration]
	)

	const value = useMemo<MusicPlayerContextValue>(
		() => ({
			currentMusic,
			currentTime,
			duration,
			hasMusic,
			isPlaying,
			loadError,
			progress,
			seek,
			togglePlayback,
			togglePlaybackFrom
		}),
		[currentMusic, currentTime, duration, hasMusic, isPlaying, loadError, progress, seek, togglePlayback, togglePlaybackFrom]
	)

	return (
		<MusicPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioRef} preload='metadata' src={currentMusic?.src} />
			<FlyingMusicNote animation={flightAnimation} onDone={() => setFlightAnimation(null)} />
			<FloatingMusicPlayer visible={(hasStarted || isPlaying) && showFloatingPlayer} />
		</MusicPlayerContext.Provider>
	)
}

export function useMusicPlayer() {
	const value = useContext(MusicPlayerContext)
	if (!value) throw new Error('useMusicPlayer must be used within MusicPlayerProvider')
	return value
}

export function MusicProgress({ className }: { className?: string }) {
	const { currentTime, duration, hasMusic, seek } = useMusicPlayer()
	const rangeProgress = duration > 0 ? `${(currentTime / duration) * 100}%` : '0%'

	return (
		<input
			type='range'
			min={0}
			max={duration || 0}
			step='0.1'
			value={duration ? currentTime : 0}
			disabled={!hasMusic || duration <= 0}
			onChange={event => seek(Number(event.target.value))}
			className={cn('range-track w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60', className)}
			style={{ '--range-progress': rangeProgress } as React.CSSProperties}
			aria-label='音乐播放进度'
		/>
	)
}

function FloatingMusicPlayer({ visible }: { visible: boolean }) {
	const { currentMusic, currentTime, duration, hasMusic, isPlaying, loadError, togglePlayback } = useMusicPlayer()

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					initial={{ opacity: 0, scale: 0.86, y: 18, filter: 'blur(6px)' }}
					animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
					exit={{ opacity: 0, scale: 0.94, y: 10, filter: 'blur(4px)' }}
					transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
					className='bg-card fixed right-6 bottom-6 z-50 flex w-[320px] origin-bottom-right items-center gap-3 rounded-[28px] border p-3 shadow-lg backdrop-blur-md max-sm:right-4 max-sm:bottom-4 max-sm:w-[calc(100vw-32px)]'>
					<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border bg-white/45'>
						<Music2 className='text-brand h-5 w-5' />
					</div>
					<div className='min-w-0 flex-1'>
						<div className='truncate text-sm font-medium'>{currentMusic?.name || '随机音乐'}</div>
						<MusicProgress className='mt-1' />
						<div className='text-secondary mt-1 truncate text-[11px]'>
							{loadError ? '音频资源加载失败' : hasMusic ? `${formatMusicTime(currentTime)} / ${formatMusicTime(duration)}` : '还没有添加音乐'}
						</div>
					</div>
					<button
						type='button'
						disabled={!hasMusic}
						onClick={togglePlayback}
						className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/70 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50'
						aria-label={isPlaying ? '暂停音乐' : '播放音乐'}>
						{isPlaying ? <Pause className='text-brand h-4 w-4' /> : <PlaySVG className='text-brand ml-1 h-4 w-4' />}
					</button>
				</motion.div>
			)}
		</AnimatePresence>
	)
}

function FlyingMusicNote({ animation, onDone }: { animation: FlightAnimation | null; onDone: () => void }) {
	return (
		<AnimatePresence>
			{animation && (
				<motion.div
					key={animation.id}
					initial={{
						x: animation.from.x - 18,
						y: animation.from.y - 18,
						opacity: 0,
						scale: 0.8,
						rotate: -12
					}}
					animate={{
						x: [animation.from.x - 18, (animation.from.x + animation.to.x) / 2 - 58, animation.to.x - 18],
						y: [animation.from.y - 18, Math.min(animation.from.y, animation.to.y) - 118, animation.to.y - 18],
						opacity: [0, 1, 1, 0],
						scale: [0.8, 1.18, 0.92, 0.7],
						rotate: [-12, 14, -8, 0]
					}}
					exit={{ opacity: 0, scale: 0.7 }}
					transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1], times: [0, 0.28, 0.76, 1] }}
					onAnimationComplete={onDone}
					className='pointer-events-none fixed top-0 left-0 z-[60] flex h-9 w-9 items-center justify-center rounded-full border bg-white/70 shadow-lg backdrop-blur-md'>
					<Music2 className='text-brand h-5 w-5' />
				</motion.div>
			)}
		</AnimatePresence>
	)
}
