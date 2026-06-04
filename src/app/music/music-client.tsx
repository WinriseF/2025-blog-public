'use client'

import { CheckCircle2, Clock3, ListMusic, Pause, Play } from 'lucide-react'
import { type CSSProperties } from 'react'
import { formatMusicTime, MusicProgress, useMusicPlayer } from '@/components/music-player'
import { list, type MusicItem } from './list'

const equalizerBars = [
	{ height: '42%', delay: '0ms', duration: '940ms' },
	{ height: '68%', delay: '120ms', duration: '1120ms' },
	{ height: '36%', delay: '40ms', duration: '860ms' },
	{ height: '84%', delay: '180ms', duration: '1280ms' },
	{ height: '52%', delay: '80ms', duration: '980ms' },
	{ height: '72%', delay: '220ms', duration: '1180ms' },
	{ height: '46%', delay: '140ms', duration: '900ms' },
	{ height: '78%', delay: '260ms', duration: '1240ms' },
	{ height: '58%', delay: '100ms', duration: '1040ms' },
	{ height: '66%', delay: '200ms', duration: '1160ms' },
	{ height: '38%', delay: '60ms', duration: '880ms' },
	{ height: '74%', delay: '240ms', duration: '1200ms' }
]

export default function MusicClient() {
	const { currentMusic, currentTime, duration, hasMusic, isPlaying, loadError, playMusic, togglePlayback } = useMusicPlayer()
	const activeSong = currentMusic ?? list[0]

	const handlePlaySong = (song: MusicItem) => {
		void playMusic(song, { showPlayer: true })
	}

	return (
		<main className='relative min-h-dvh overflow-hidden px-4 pt-28 pb-32 text-primary sm:px-6 lg:px-8'>
			<div className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'>
				<div className='absolute top-8 left-[8%] h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--color-brand)_22%,transparent)] blur-3xl' />
				<div className='absolute right-[6%] bottom-16 h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--color-brand-secondary)_20%,transparent)] blur-3xl' />
				<div className='absolute inset-x-0 top-0 h-56 bg-linear-to-b from-[color-mix(in_srgb,var(--color-card)_70%,transparent)] to-transparent' />
			</div>

			<div className='mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]'>
				<section
					aria-labelledby='music-room-title'
					className='relative overflow-hidden rounded-[32px] border border-[color-mix(in_srgb,var(--color-border)_78%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_78%,transparent)] p-5 shadow-[0_32px_90px_-58px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-7 lg:min-h-[640px]'>
					<div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,color-mix(in_srgb,var(--color-brand)_28%,transparent),transparent_38%),radial-gradient(circle_at_74%_8%,color-mix(in_srgb,var(--color-brand-secondary)_24%,transparent),transparent_32%)]' />
					<div className='relative z-10 flex h-full flex-col gap-7'>
						<h1 id='music-room-title' className='text-3xl leading-tight font-semibold tracking-normal text-primary sm:text-4xl'>
							声音舱
						</h1>

						<div className='grid flex-1 gap-6 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1fr)] xl:items-center'>
							<div className='mx-auto flex w-full max-w-[320px] flex-col items-center gap-5'>
								<div
									className={`music-record relative aspect-square w-full rounded-full border border-[color-mix(in_srgb,var(--color-border)_76%,transparent)] bg-[conic-gradient(from_160deg,color-mix(in_srgb,var(--color-primary)_82%,black)_0deg,color-mix(in_srgb,var(--color-brand)_54%,black)_68deg,color-mix(in_srgb,var(--color-card)_60%,black)_132deg,color-mix(in_srgb,var(--color-brand-secondary)_48%,black)_218deg,color-mix(in_srgb,var(--color-primary)_82%,black)_360deg)] shadow-[0_38px_70px_-44px_rgba(0,0,0,0.74)] ${isPlaying ? 'music-record-spinning' : ''}`}
									aria-hidden='true'>
									<div className='absolute inset-[11%] rounded-full border border-white/10 bg-[repeating-radial-gradient(circle,rgba(255,255,255,0.16)_0_1px,transparent_1px_8px)] opacity-55' />
									<div className='absolute inset-[35%] rounded-full border border-[color-mix(in_srgb,var(--color-border)_90%,transparent)] bg-[color-mix(in_srgb,var(--color-article)_88%,transparent)] shadow-inner backdrop-blur-md' />
									<div className='absolute inset-[44%] rounded-full bg-brand shadow-[0_0_32px_color-mix(in_srgb,var(--color-brand)_60%,transparent)]' />
								</div>
								<div className='flex h-16 items-end justify-center gap-1.5' aria-hidden='true'>
									{equalizerBars.map((bar, index) => (
										<span
											key={`${bar.height}-${index}`}
											className={`music-eq-bar w-2 rounded-full bg-[linear-gradient(180deg,var(--color-brand),var(--color-brand-secondary))] opacity-80 ${isPlaying ? 'music-eq-active' : ''}`}
											style={
												{
													height: bar.height,
													animationDelay: bar.delay,
													animationDuration: bar.duration
												} as CSSProperties
											}
										/>
									))}
								</div>
							</div>

							<div className='min-w-0 space-y-6'>
								<div>
									<h2 className='text-3xl leading-tight font-semibold tracking-normal text-primary sm:text-5xl'>{activeSong?.name || '随机音乐'}</h2>
									<div className='mt-3 flex flex-wrap items-center gap-3 text-sm text-secondary'>
										<span className='inline-flex items-center gap-1.5'>
											<Clock3 className='h-4 w-4' aria-hidden='true' />
											<span className='tabular-nums'>
												{formatMusicTime(currentTime)} / {formatMusicTime(duration)}
											</span>
										</span>
										{loadError && <span className='rounded-full bg-[color-mix(in_srgb,#e5484d_14%,transparent)] px-2.5 py-1 text-[#b4232a]'>加载失败，请换一首或稍后重试</span>}
									</div>
								</div>

								<div className='space-y-3'>
									<MusicProgress className='h-2.5' />
									<div className='flex items-center justify-between gap-4'>
										<button
											type='button'
											disabled={!hasMusic}
											onClick={togglePlayback}
											aria-label={isPlaying ? '暂停当前音乐' : '播放当前音乐'}
											className='flex min-h-12 items-center gap-3 rounded-full border border-[color-mix(in_srgb,var(--color-brand)_36%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-brand),var(--color-brand-secondary))] px-5 text-sm font-semibold text-white shadow-[0_18px_42px_-26px_color-mix(in_srgb,var(--color-brand)_65%,transparent)] transition-[opacity,transform,box-shadow] duration-200 hover:scale-[1.02] hover:shadow-[0_22px_48px_-24px_color-mix(in_srgb,var(--color-brand)_78%,transparent)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'>
											{isPlaying ? <Pause className='h-4 w-4' aria-hidden='true' /> : <Play className='h-4 w-4 fill-current' aria-hidden='true' />}
											{isPlaying ? '暂停' : '播放'}
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section
					aria-labelledby='music-library-title'
					className='rounded-[32px] border border-[color-mix(in_srgb,var(--color-border)_80%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_76%,transparent)] p-4 shadow-[0_28px_80px_-58px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-5'>
					<div className='flex flex-wrap items-center justify-between gap-3 px-1'>
						<div className='flex items-center gap-2'>
							<ListMusic className='h-5 w-5 text-brand' aria-hidden='true' />
							<h2 id='music-library-title' className='text-2xl leading-tight font-semibold tracking-normal text-primary'>
								全部歌曲
							</h2>
						</div>
						<div className='rounded-full border border-[color-mix(in_srgb,var(--color-border)_78%,transparent)] px-3 py-1.5 text-xs font-medium text-secondary'>{list.length} 首</div>
					</div>

					<div className='mt-5 space-y-2'>
						{list.map((song, index) => {
							const active = song.src === currentMusic?.src
							return (
								<button
									key={song.src}
									type='button'
									onClick={() => handlePlaySong(song)}
									aria-current={active ? 'true' : undefined}
									className={`group flex min-h-[72px] w-full items-center gap-3 rounded-3xl border p-3 text-left transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
										active
											? 'border-[color-mix(in_srgb,var(--color-brand)_44%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-brand)_14%,var(--color-article))]'
											: 'border-transparent bg-[color-mix(in_srgb,var(--color-article)_42%,transparent)] hover:border-[color-mix(in_srgb,var(--color-border)_82%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-article)_68%,transparent)]'
									}`}>
									<span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--color-border)_80%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_82%,transparent)] text-sm font-semibold tabular-nums text-secondary'>
										{active ? (
											isPlaying ? (
												<Pause className='h-4 w-4 text-brand' aria-hidden='true' />
											) : (
												<CheckCircle2 className='h-4 w-4 text-brand' aria-hidden='true' />
											)
										) : (
											String(index + 1).padStart(2, '0')
										)}
									</span>
									<span className='min-w-0 flex-1'>
										<span className='block truncate text-base font-medium text-primary'>{song.name}</span>
										{active && <span className='mt-1 block text-xs text-secondary'>{isPlaying ? '正在播放' : '当前选中'}</span>}
									</span>
									<span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)] text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-white'>
										<Play className='h-4 w-4 fill-current' aria-hidden='true' />
									</span>
								</button>
							)
						})}
					</div>
				</section>
			</div>

			<style>{`
				.music-record-spinning {
					animation: music-record-spin 18s linear infinite;
				}

				.music-eq-active {
					transform-origin: bottom center;
					animation-name: music-eq-pulse;
					animation-timing-function: ease-in-out;
					animation-iteration-count: infinite;
					animation-direction: alternate;
				}

				@keyframes music-record-spin {
					to {
						transform: rotate(360deg);
					}
				}

				@keyframes music-eq-pulse {
					from {
						transform: scaleY(0.45);
						opacity: 0.48;
					}
					to {
						transform: scaleY(1);
						opacity: 0.9;
					}
				}

				@media (prefers-reduced-motion: reduce) {
					.music-record-spinning,
					.music-eq-active {
						animation: none;
					}
				}
			`}</style>
		</main>
	)
}
