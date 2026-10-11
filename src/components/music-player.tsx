'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle, Music2, Pause, Play } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { list, type MusicItem } from '@/app/music/list'
import { getAssetUrl } from '@/lib/asset-url'
import { cn } from '@/lib/utils'
import { OptimizedImage } from '@/components/optimized-image'

type MusicPlayerContextValue = {
	currentMusic?: MusicItem
	currentTime: number
	duration: number
	hasMusic: boolean
	isPlaying: boolean
	isLoading: boolean
	loadError: boolean
	loop: boolean
	volume: number
	progress: number
	playMusic: (music: MusicItem) => Promise<void>
	playNext: () => Promise<void>
	playPrevious: () => Promise<void>
	seek: (value: number) => void
	setVolume: (value: number) => void
	toggleMute: () => void
	toggleLoop: () => void
	togglePlayback: () => Promise<void>
	togglePlaybackFrom: (rect?: DOMRect) => Promise<void>
}

type FlightAnimation = {
	id: number
	from: { x: number; y: number }
	to: { x: number; y: number }
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null)

export function formatMusicTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
	return (
		Math.floor(seconds / 60) +
		':' +
		Math.floor(seconds % 60)
			.toString()
			.padStart(2, '0')
	)
}

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const reducedMotion = useReducedMotion()
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const currentSrcRef = useRef<string | null>(null)
	const currentMusicRef = useRef<MusicItem | undefined>(list[0])
	const playbackRequestRef = useRef(0)
	const loadingRef = useRef(false)
	const lastVolumeRef = useRef(1)
	const flightTimerRef = useRef<number | null>(null)
	const [currentMusic, setCurrentMusic] = useState<MusicItem | undefined>(list[0])
	const [loop, setLoop] = useState(false)
	const [volume, setVolumeState] = useState(1)
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [loadError, setLoadError] = useState(false)
	const [hasStarted, setHasStarted] = useState(false)
	const [showFloatingPlayer, setShowFloatingPlayer] = useState(false)
	const [flightAnimation, setFlightAnimation] = useState<FlightAnimation | null>(null)
	const hasMusic = Boolean(currentMusic?.src)
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0

	const setLoading = useCallback((loading: boolean) => {
		loadingRef.current = loading
		setIsLoading(loading)
	}, [])
	const syncDuration = useCallback(() => {
		const audio = audioRef.current
		if (audio) setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
	}, [])

	const playMusic = useCallback(
		async (music: MusicItem) => {
			const audio = audioRef.current
			if (!audio || !music.src) return
			const request = ++playbackRequestRef.current
			currentMusicRef.current = music
			setCurrentMusic(music)
			setHasStarted(true)
			setShowFloatingPlayer(true)
			setLoadError(false)
			if (currentSrcRef.current !== music.src) {
				audio.pause()
				audio.src = music.src
				currentSrcRef.current = music.src
				setIsPlaying(false)
				setCurrentTime(0)
				setDuration(0)
			} else if (audio.error) {
				audio.load()
			}
			setLoading(true)
			try {
				await audio.play()
				if (request !== playbackRequestRef.current) return
				setIsPlaying(true)
				setLoading(false)
				syncDuration()
			} catch (error) {
				if (request !== playbackRequestRef.current) return
				setIsPlaying(false)
				setLoading(false)
				if (!(error instanceof DOMException && error.name === 'AbortError')) setLoadError(true)
			}
		},
		[setLoading, syncDuration]
	)

	const playAdjacent = useCallback(
		async (offset: number) => {
			if (!list.length) return
			const index = Math.max(
				0,
				list.findIndex(song => song.src === currentMusicRef.current?.src)
			)
			await playMusic(list[(index + offset + list.length) % list.length])
		},
		[playMusic]
	)
	const playNext = useCallback(() => playAdjacent(1), [playAdjacent])
	const playPrevious = useCallback(() => playAdjacent(-1), [playAdjacent])

	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return
		const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0)
		const handlePlaying = () => {
			if (audio.paused) return
			setIsPlaying(true)
			setLoading(false)
			setLoadError(false)
		}
		const handlePause = () => {
			if (!audio.paused) return
			setIsPlaying(false)
			setLoading(false)
		}
		const handleWaiting = () => {
			if (!audio.paused) setLoading(true)
		}
		const handleError = () => {
			if (!audio.error) return
			setIsPlaying(false)
			setLoading(false)
			setLoadError(true)
		}
		const handleEnded = () => {
			void playNext()
		}
		audio.addEventListener('loadedmetadata', syncDuration)
		audio.addEventListener('durationchange', syncDuration)
		audio.addEventListener('timeupdate', handleTimeUpdate)
		audio.addEventListener('playing', handlePlaying)
		audio.addEventListener('pause', handlePause)
		audio.addEventListener('waiting', handleWaiting)
		audio.addEventListener('error', handleError)
		audio.addEventListener('ended', handleEnded)
		return () => {
			audio.removeEventListener('loadedmetadata', syncDuration)
			audio.removeEventListener('durationchange', syncDuration)
			audio.removeEventListener('timeupdate', handleTimeUpdate)
			audio.removeEventListener('playing', handlePlaying)
			audio.removeEventListener('pause', handlePause)
			audio.removeEventListener('waiting', handleWaiting)
			audio.removeEventListener('error', handleError)
			audio.removeEventListener('ended', handleEnded)
		}
	}, [playNext, setLoading, syncDuration])

	useEffect(() => {
		if (audioRef.current) audioRef.current.loop = loop
	}, [loop])
	useEffect(
		() => () => {
			if (flightTimerRef.current !== null) window.clearTimeout(flightTimerRef.current)
		},
		[]
	)

	const togglePlayback = useCallback(async () => {
		const audio = audioRef.current
		const music = currentMusicRef.current
		if (!audio || !music) return
		if (!audio.paused || loadingRef.current) {
			++playbackRequestRef.current
			audio.pause()
			setIsPlaying(false)
			setLoading(false)
			return
		}
		await playMusic(music)
	}, [playMusic, setLoading])

	const togglePlaybackFrom = useCallback(
		async (rect?: DOMRect) => {
			await togglePlayback()
			if (!rect || hasStarted || reducedMotion || audioRef.current?.paused) return
			const smallScreen = window.matchMedia('(max-width: 640px)').matches
			setFlightAnimation({
				id: Date.now(),
				from: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
				to: { x: window.innerWidth - (smallScreen ? 176 : 184), y: window.innerHeight - 58 }
			})
			setShowFloatingPlayer(false)
			if (flightTimerRef.current !== null) window.clearTimeout(flightTimerRef.current)
			flightTimerRef.current = window.setTimeout(() => setShowFloatingPlayer(true), 520)
		},
		[hasStarted, reducedMotion, togglePlayback]
	)

	const seek = useCallback((value: number) => {
		const audio = audioRef.current
		if (!audio || !Number.isFinite(value) || !Number.isFinite(audio.duration) || audio.duration <= 0) return
		audio.currentTime = Math.min(Math.max(value, 0), audio.duration)
		setCurrentTime(audio.currentTime)
	}, [])
	const setVolume = useCallback((value: number) => {
		const audio = audioRef.current
		if (!audio || !Number.isFinite(value)) return
		const nextVolume = Math.max(0, Math.min(1, value))
		audio.volume = nextVolume
		audio.muted = nextVolume === 0
		setVolumeState(audio.muted ? 0 : audio.volume)
		if (!audio.muted && audio.volume > 0) lastVolumeRef.current = audio.volume
	}, [])
	const toggleMute = useCallback(() => setVolume(volume > 0 ? 0 : lastVolumeRef.current), [setVolume, volume])
	const toggleLoop = useCallback(() => setLoop(value => !value), [])
	const value = useMemo<MusicPlayerContextValue>(
		() => ({
			currentMusic,
			currentTime,
			duration,
			hasMusic,
			isPlaying,
			isLoading,
			loadError,
			loop,
			volume,
			progress,
			playMusic,
			playNext,
			playPrevious,
			seek,
			setVolume,
			toggleMute,
			toggleLoop,
			togglePlayback,
			togglePlaybackFrom
		}),
		[
			currentMusic,
			currentTime,
			duration,
			hasMusic,
			isPlaying,
			isLoading,
			loadError,
			loop,
			volume,
			progress,
			playMusic,
			playNext,
			playPrevious,
			seek,
			setVolume,
			toggleMute,
			toggleLoop,
			togglePlayback,
			togglePlaybackFrom
		]
	)

	return (
		<MusicPlayerContext.Provider value={value}>
			{children}
			<audio ref={audioRef} preload='none' />
			<FlyingMusicNote animation={flightAnimation} onDone={() => setFlightAnimation(null)} />
			<FloatingMusicPlayer visible={pathname !== '/music' && hasStarted && showFloatingPlayer} />
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
	const rangeProgress = duration > 0 ? (currentTime / duration) * 100 + '%' : '0%'
	return (
		<input
			type='range'
			min={0}
			max={duration || 1}
			step='0.1'
			value={duration ? Math.min(currentTime, duration) : 0}
			disabled={!hasMusic || duration <= 0}
			onChange={event => seek(Number(event.target.value))}
			className={cn('range-track w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60', className)}
			style={{ '--range-progress': rangeProgress } as React.CSSProperties}
			aria-label='音乐播放进度'
			aria-valuetext={formatMusicTime(currentTime) + ' / ' + (duration > 0 ? formatMusicTime(duration) : '时长待加载')}
		/>
	)
}

function FloatingMusicPlayer({ visible }: { visible: boolean }) {
	const { currentMusic, currentTime, duration, isPlaying, isLoading, loadError, togglePlayback } = useMusicPlayer()
	const reducedMotion = useReducedMotion()
	return (
		<AnimatePresence>
			{visible && currentMusic && (
				<motion.div
					initial={reducedMotion ? false : { opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
					transition={{ duration: reducedMotion ? 0 : 0.2 }}
					className='bg-article text-primary fixed right-6 bottom-6 z-50 flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border p-3 shadow-lg backdrop-blur-xl max-sm:right-4 max-sm:bottom-4'>
					<Link href='/music' aria-label='打开音乐仓' className='focus-visible:outline-brand shrink-0 overflow-hidden rounded-xl focus-visible:outline-2'>
						<OptimizedImage src={getAssetUrl(currentMusic.cover)} alt='' width={44} height={44} className='h-11 w-11 object-cover' />
					</Link>
					<div className='min-w-0 flex-1'>
						<Link href='/music' className='block truncate text-sm font-medium'>
							{currentMusic.name}
						</Link>
						<MusicProgress className='mt-1' />
						<p className='text-secondary mt-1 text-[11px]'>
							{loadError
								? '播放失败，点击重试'
								: isLoading
									? '正在加载…'
									: formatMusicTime(currentTime) + ' / ' + (duration > 0 ? formatMusicTime(duration) : '—:—')}
						</p>
					</div>
					<button
						type='button'
						onClick={togglePlayback}
						className='bg-card text-primary hover:bg-bg focus-visible:outline-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2'
						aria-label={isLoading ? '取消加载' : isPlaying ? '暂停音乐' : loadError ? '重试播放' : '播放音乐'}>
						{isLoading ? (
							<LoaderCircle className='h-4 w-4 animate-spin motion-reduce:animate-none' />
						) : isPlaying ? (
							<Pause className='h-4 w-4' />
						) : (
							<Play className='h-4 w-4' />
						)}
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
					initial={{ x: animation.from.x - 18, y: animation.from.y - 18, opacity: 0, scale: 0.8 }}
					animate={{
						x: [animation.from.x - 18, (animation.from.x + animation.to.x) / 2 - 58, animation.to.x - 18],
						y: [animation.from.y - 18, Math.min(animation.from.y, animation.to.y) - 118, animation.to.y - 18],
						opacity: [0, 1, 1, 0],
						scale: [0.8, 1.18, 0.92, 0.7]
					}}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
					onAnimationComplete={onDone}
					className='bg-article pointer-events-none fixed top-0 left-0 z-[60] flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur-md'>
					<Music2 className='text-brand h-5 w-5' />
				</motion.div>
			)}
		</AnimatePresence>
	)
}
