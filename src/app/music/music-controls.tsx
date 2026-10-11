'use client'

import { type CSSProperties } from 'react'
import { LoaderCircle, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { formatMusicTime, MusicProgress, useMusicPlayer } from '@/components/music-player'
import styles from './music.module.css'

export default function MusicControls() {
	const {
		currentTime,
		duration,
		hasMusic,
		isPlaying,
		isLoading,
		loadError,
		loop,
		volume,
		playNext,
		playPrevious,
		setVolume,
		toggleMute,
		toggleLoop,
		togglePlayback
	} = useMusicPlayer()
	const LoopIcon = loop ? Repeat1 : Repeat
	const VolumeIcon = volume > 0 ? Volume2 : VolumeX
	const loopLabel = loop ? '单曲循环，点击切换列表循环' : '列表循环，点击切换单曲循环'
	const muteLabel = volume > 0 ? '静音' : '取消静音'
	const playLabel = isLoading ? '取消加载' : isPlaying ? '暂停音乐' : loadError ? '重试播放' : '播放音乐'

	return (
		<>
			<div className={styles.controlsMain}>
				<div className={styles.transport}>
					<button type='button' className={styles.mobileOnly} onClick={toggleLoop} aria-label={loopLabel} title={loopLabel} aria-pressed={loop}>
						<LoopIcon size={21} />
					</button>
					<button type='button' onClick={playPrevious} disabled={!hasMusic} aria-label='上一首' title='上一首'>
						<SkipBack size={23} fill='currentColor' />
					</button>
					<button type='button' className={styles.playButton} onClick={togglePlayback} disabled={!hasMusic} aria-label={playLabel} title={playLabel}>
						{isLoading ? (
							<LoaderCircle size={25} className={styles.spinner} />
						) : isPlaying ? (
							<Pause size={25} fill='currentColor' />
						) : (
							<Play size={25} fill='currentColor' />
						)}
					</button>
					<button type='button' onClick={playNext} disabled={!hasMusic} aria-label='下一首' title='下一首'>
						<SkipForward size={23} fill='currentColor' />
					</button>
					<button type='button' className={styles.mobileOnly} onClick={toggleMute} aria-label={muteLabel} title={muteLabel} aria-pressed={volume === 0}>
						<VolumeIcon size={21} />
					</button>
				</div>
				<div className={styles.progressRow}>
					<span>{formatMusicTime(currentTime)}</span>
					<MusicProgress />
					<span>{duration > 0 ? formatMusicTime(duration) : '—:—'}</span>
				</div>
			</div>
			<div className={styles.secondaryControls}>
				<button type='button' onClick={toggleLoop} aria-label={loopLabel} title={loopLabel} aria-pressed={loop}>
					<LoopIcon size={20} />
				</button>
				<div className={styles.volume}>
					<button type='button' onClick={toggleMute} aria-label={muteLabel} title={muteLabel} aria-pressed={volume === 0}>
						<VolumeIcon size={20} />
					</button>
					<input
						type='range'
						min={0}
						max={1}
						step={0.01}
						value={volume}
						onChange={event => setVolume(Number(event.target.value))}
						className='range-track'
						style={{ '--range-progress': volume * 100 + '%' } as CSSProperties}
						aria-label='音乐音量'
						aria-valuetext={Math.round(volume * 100) + '%'}
					/>
				</div>
			</div>
		</>
	)
}
