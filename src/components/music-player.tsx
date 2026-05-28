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
	playMusic: (music: MusicItem, options?: PlayMusicOptions) => Promise<void>
	seek: (value: number) => void
	togglePlayback: () => Promise<void>
	togglePlaybackFrom: (rect?: DOMRect) => Promise<void>
}

type PlayMusicOptions = {
	fadeInMs?: number
	loop?: boolean
	showPlayer?: boolean
	autoPlay?: boolean
}

type PendingPlayRequest = {
	music: MusicItem
	options: PlayMusicOptions
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
	const currentSrcRef = useRef<string | null>(null)
	const fadeTimerRef = useRef<number | null>(null)
	const [randomIndex] = useState(() => Math.floor(Math.random() * list.length))
	const [currentMusic, setCurrentMusic] = useState<MusicItem>(() => list[randomIndex])
	const [loop, setLoop] = useState(false)
	const hasMusic = Boolean(currentMusic?.src)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [loadError, setLoadError] = useState(false)
	const [hasStarted, setHasStarted] = useState(false)
	const [showFloatingPlayer, setShowFloatingPlayer] = useState(false)
	const [flightAnimation, setFlightAnimation] = useState<FlightAnimation | null>(null)
	const [pendingPlayRequest, setPendingPlayRequest] = useState<PendingPlayRequest | null>(null)
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0

	const clearFadeTimer = useCallback(() => {
		if (fadeTimerRef.current !== null) {
			window.clearInterval(fadeTimerRef.current)
			fadeTimerRef.current = null
		}
	}, [])

	const fadeVolumeIn = useCallback(
		(audio: HTMLAudioElement, fadeInMs: number) => {
			clearFadeTimer()
			if (fadeInMs <= 0) {
				audio.volume = 1
				return
			}

			const startedAt = performance.now()
			audio.volume = 0
			fadeTimerRef.current = window.setInterval(() => {
				const progress = Math.min((performance.now() - startedAt) / fadeInMs, 1)
				audio.volume = progress
				if (progress >= 1) clearFadeTimer()
			}, 100)
		},
		[clearFadeTimer]
	)

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
		if (audio) {
			audio.loop = loop
		}
	}, [loop])

	useEffect(() => {
		return () => clearFadeTimer()
	}, [clearFadeTimer])

	const playMusic = useCallback(
		async (music: MusicItem, options: PlayMusicOptions = {}) => {
			const audio = audioRef.current
			if (!audio || !music.src) return

			const showPlayer = options.showPlayer ?? true
			const nextLoop = options.loop ?? false
			const autoPlay = options.autoPlay ?? true

			clearFadeTimer()
			setCurrentMusic(music)
			setLoop(nextLoop)
			audio.loop = nextLoop

			if (currentSrcRef.current !== music.src) {
				audio.pause()
				audio.src = music.src
				currentSrcRef.current = music.src
				setCurrentTime(0)
				setDuration(0)
			}

			if (!autoPlay) {
				setIsPlaying(false)
				setHasStarted(false)
				if (showPlayer) setShowFloatingPlayer(true)
				setLoadError(false)
				syncDuration()
				setPendingPlayRequest(null)
				return
			}

			try {
				fadeVolumeIn(audio, options.fadeInMs ?? 0)
				await audio.play()
				setIsPlaying(true)
				setHasStarted(true)
				if (showPlayer) setShowFloatingPlayer(true)
				setLoadError(false)
				syncDuration()
				setPendingPlayRequest(null)
			} catch (error) {
				audio.volume = 1
				setIsPlaying(false)
				const blockedByAutoplay = error instanceof DOMException && error.name === 'NotAllowedError'
				if (blockedByAutoplay) {
					setHasStarted(true)
					if (showPlayer) setShowFloatingPlayer(true)
					setLoadError(false)
					setPendingPlayRequest({ music, options })
					return
				}
				setLoadError(true)
			}
		},
		[clearFadeTimer, fadeVolumeIn, syncDuration]
	)

	useEffect(() => {
		if (!pendingPlayRequest) return

		const retry = () => {
			const request = pendingPlayRequest
			setPendingPlayRequest(null)
			void playMusic(request.music, request.options)
		}

		window.addEventListener('pointerdown', retry, { once: true })
		window.addEventListener('keydown', retry, { once: true })
		window.addEventListener('touchstart', retry, { once: true, passive: true })

		return () => {
			window.removeEventListener('pointerdown', retry)
			window.removeEventListener('keydown', retry)
			window.removeEventListener('touchstart', retry)
		}
	}, [pendingPlayRequest, playMusic])

	const togglePlaybackCore = useCallback(
		async (showPlayerImmediately: boolean) => {
			const audio = audioRef.current
			if (!audio || !currentMusic?.src) return

			if (currentSrcRef.current !== currentMusic.src) {
				audio.src = currentMusic.src
				currentSrcRef.current = currentMusic.src
			}

			if (audio.paused) {
				try {
					clearFadeTimer()
					audio.volume = 1
					audio.loop = loop
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

			clearFadeTimer()
			audio.pause()
			setIsPlaying(false)
		},
		[clearFadeTimer, currentMusic, loop, syncDuration]
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
			playMusic,
			seek,
			togglePlayback,
			togglePlaybackFrom
		}),
		[currentMusic, currentTime, duration, hasMusic, isPlaying, loadError, playMusic, progress, seek, togglePlayback, togglePlaybackFrom]
	)

	return (
		<MusicPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioRef} preload='none' />
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
	const [expandedWidth, setExpandedWidth] = useState(320)
	const playerTransition = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const }

	useEffect(() => {
		const updateWidth = () => {
			setExpandedWidth(Math.min(320, window.innerWidth - 32))
		}

		updateWidth()
		window.addEventListener('resize', updateWidth)
		return () => window.removeEventListener('resize', updateWidth)
	}, [])

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					initial={{ opacity: 0, scale: 0.86, y: 18, filter: 'blur(6px)', width: 56, height: 56 }}
					animate={{
						opacity: 1,
						scale: 1,
						y: 0,
						filter: 'blur(0px)',
						width: isPlaying ? expandedWidth : 56,
						height: isPlaying ? 66 : 56,
						borderRadius: isPlaying ? 28 : 999,
						padding: isPlaying ? 12 : 8
					}}
					exit={{ opacity: 0, scale: 0.94, y: 10, filter: 'blur(4px)' }}
					transition={playerTransition}
					className='bg-card fixed right-6 bottom-6 z-50 origin-bottom-right overflow-hidden border shadow-lg backdrop-blur-md max-sm:right-4 max-sm:bottom-4'>
					<motion.div
						animate={{
							opacity: isPlaying ? 1 : 0,
							x: isPlaying ? 0 : 12,
							scale: isPlaying ? 1 : 0.98
						}}
						transition={{ duration: isPlaying ? 0.24 : 0.14, delay: isPlaying ? 0.12 : 0, ease: [0.22, 1, 0.36, 1] }}
						className='flex h-full w-full items-center gap-3'
						style={{ pointerEvents: isPlaying ? 'auto' : 'none' }}>
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
							aria-label='暂停音乐'>
							<Pause className='text-brand h-4 w-4' />
						</button>
					</motion.div>

					<motion.button
						type='button'
						disabled={!hasMusic}
						onClick={togglePlayback}
						animate={{
							opacity: isPlaying ? 0 : 1,
							scale: isPlaying ? 0.72 : 1,
							rotate: isPlaying ? -12 : 0
						}}
						transition={{ duration: isPlaying ? 0.12 : 0.22, delay: isPlaying ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
						className='absolute inset-2 flex items-center justify-center rounded-full bg-white/70 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50'
						style={{ pointerEvents: isPlaying ? 'none' : 'auto' }}
						aria-label='播放音乐'>
						<PlaySVG className='text-brand ml-1 h-4 w-4' />
					</motion.button>
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
