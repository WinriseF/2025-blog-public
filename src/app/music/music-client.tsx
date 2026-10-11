'use client'

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Pause, Play } from 'lucide-react'
import { useMusicPlayer } from '@/components/music-player'
import { OptimizedImage } from '@/components/optimized-image'
import { getAssetUrl } from '@/lib/asset-url'
import { useConfigStore } from '@/app/(home)/stores/config-store'
import MusicControls from './music-controls'
import { list } from './list'
import styles from './music.module.css'

export default function MusicClient() {
	const { currentMusic, duration, hasMusic, isPlaying, isLoading, loadError, playMusic, togglePlayback } = useMusicPlayer()
	const siteTitle = useConfigStore(state => state.siteContent.meta.title)
	const activeSong = currentMusic ?? list[0]
	const controlsRef = useRef<HTMLDivElement>(null)
	const [showMobileDock, setShowMobileDock] = useState(false)
	const status = loadError ? '播放失败' : isLoading ? '正在加载…' : isPlaying ? '正在播放' : duration > 0 ? '已暂停' : '待播放'
	const playLabel = isLoading ? '取消加载' : isPlaying ? '暂停音乐' : loadError ? '重试播放' : '播放音乐'

	useEffect(() => {
		const controls = controlsRef.current
		if (!controls) return
		const observer = new IntersectionObserver(([entry]) => {
			setShowMobileDock(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0)
		})
		observer.observe(controls)
		return () => observer.disconnect()
	}, [])

	return (
		<main className={styles.page}>
			<div className={styles.shell}>
				<header className={styles.header}>
					<p className={styles.eyebrow}>{siteTitle} / MUSIC ROOM</p>
					<h1>音乐仓</h1>
					<p className={styles.subtitle}>让日常，慢半拍。</p>
				</header>
				{activeSong ? (
					<div className={styles.content}>
						<section className={styles.nowPlaying} aria-labelledby='current-song-title'>
							<div className={styles.artwork}>
								<OptimizedImage
									key={activeSong.cover}
									src={getAssetUrl(activeSong.cover)}
									alt={activeSong.name + ' 封面'}
									width={1254}
									height={1254}
									loading='eager'
									fetchPriority='high'
									className={styles.cover}
								/>
							</div>
							<div className={styles.songInfo}>
								<p className={styles.eyebrow}>NOW PLAYING</p>
								<div className={styles.songHeading}>
									<h2 id='current-song-title'>{activeSong.name}</h2>
									<p className={styles.status} data-error={loadError || undefined} role='status'>
										<span aria-hidden='true' />
										{status}
									</p>
								</div>
							</div>
							{loadError && (
								<p className={styles.error} role='alert'>
									播放失败，请重试或换一首。
									<button type='button' onClick={togglePlayback}>
										重试
									</button>
								</p>
							)}
							<div ref={controlsRef} className={styles.player} aria-label='音乐播放控制'>
								<div className={styles.playerTrack}>
									<OptimizedImage src={getAssetUrl(activeSong.cover)} alt='' width={52} height={52} />
									<div>
										<p>{activeSong.name}</p>
										<span>{status}</span>
									</div>
								</div>
								<MusicControls />
							</div>
						</section>
						<section className={styles.library} aria-labelledby='music-library-title'>
							<div className={styles.libraryHeading}>
								<h2 id='music-library-title'>全部曲目</h2>
								<span>{String(list.length).padStart(2, '0')} 首</span>
							</div>
							<ol className={styles.tracks}>
								{list.map((song, index) => {
									const active = song.src === activeSong.src
									const action = active && isLoading ? '取消加载' : active && isPlaying ? '暂停' : '播放'
									return (
										<li key={song.src}>
											<button
												type='button'
												className={styles.track}
												data-active={active || undefined}
												aria-current={active ? 'true' : undefined}
												aria-label={action + ' ' + song.name}
												onClick={() => (active ? void togglePlayback() : void playMusic(song))}>
												<span className={styles.trackIndex}>{String(index + 1).padStart(2, '0')}</span>
												<OptimizedImage src={getAssetUrl(song.cover)} alt='' width={48} height={48} className={styles.thumbnail} />
												<span className={styles.trackDetails}>
													<span className={styles.trackName}>{song.name}</span>
													{active && <span className={styles.trackStatus}>{status}</span>}
												</span>
												<span className={styles.trackAction} aria-hidden='true'>
													{active && isLoading ? (
														<LoaderCircle size={18} className={styles.spinner} />
													) : active && isPlaying ? (
														<Pause size={18} fill='currentColor' />
													) : (
														<Play size={18} fill='currentColor' />
													)}
												</span>
											</button>
										</li>
									)
								})}
							</ol>
							<p className={styles.libraryNote}>{list.length} 首音乐，随心切换。</p>
						</section>
					</div>
				) : (
					<p className={styles.subtitle}>还没有添加音乐。</p>
				)}
			</div>
			{showMobileDock && activeSong && (
				<div className={styles.mobileDock} aria-label='迷你播放器'>
					<button
						type='button'
						className={styles.mobileTrack}
						onClick={() => controlsRef.current?.scrollIntoView({ block: 'center' })}
						aria-label='返回完整播放器'>
						<OptimizedImage src={getAssetUrl(activeSong.cover)} alt='' width={44} height={44} />
						<span>
							<strong>{activeSong.name}</strong>
							<small>{status}</small>
						</span>
					</button>
					<button type='button' className={styles.playButton} disabled={!hasMusic} onClick={togglePlayback} aria-label={playLabel}>
						{isLoading ? (
							<LoaderCircle size={20} className={styles.spinner} />
						) : isPlaying ? (
							<Pause size={20} fill='currentColor' />
						) : (
							<Play size={20} fill='currentColor' />
						)}
					</button>
				</div>
			)}
		</main>
	)
}
