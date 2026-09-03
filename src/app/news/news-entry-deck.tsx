'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, BookOpenText, Headphones, Newspaper } from 'lucide-react'
import type { EnglishReadingItem } from '@/lib/english-reading'

const AUTO_FLIP_INTERVAL_MS = 6500
const CARD_EASE = [0.22, 1, 0.36, 1] as const
const CARD_EXIT_EASE = [0.4, 0, 1, 1] as const

type EntryCardKind = 'daily' | 'english'

type NewsEntryDeckProps = {
	daily: {
		title: string
		updatedAt?: string
		latestHref: string
		dayCount: number
		videoCount: number
		latestDate: string
	}
	englishReading?: EnglishReadingItem
}

function EntryMetric({ label, value }: { label: string; value: string | number }) {
	return (
		<div className='news-stat px-4 first:border-l-0 max-sm:border-l-0 max-sm:px-0 max-sm:py-3 max-sm:first:border-t-0'>
			<div className='news-muted text-xs'>{label}</div>
			<div className='mt-1 text-lg font-semibold leading-none max-sm:text-base'>{value}</div>
		</div>
	)
}

function DailyCard({ daily }: Pick<NewsEntryDeckProps, 'daily'>) {
	return (
		<>
			<div className='grid grid-cols-[minmax(0,1fr)_auto] gap-8 max-sm:grid-cols-1 max-sm:gap-5'>
				<div className='flex min-w-0 items-center gap-4'>
					<div className='news-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl'>
						<Newspaper className='size-7' />
					</div>
					<div className='min-w-0'>
						<div className='news-muted text-xs tracking-[0.22em] uppercase'>Daily Intel Digest</div>
						<h1 className='mt-1 text-2xl font-semibold max-sm:text-xl'>{daily.title}</h1>
						<p className='news-muted mt-2 text-sm leading-6'>
							汇总 B 站 UP 内容与 NewsNow 午间热点摘要
							{daily.updatedAt ? <span className='block'>更新时间：{daily.updatedAt}</span> : null}
						</p>
					</div>
				</div>

				<Link href={daily.latestHref} prefetch={false} className='news-primary-action flex h-fit shrink-0 items-center gap-2 self-center rounded-xl px-4 py-2 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 max-sm:w-full max-sm:justify-center'>
					查看最新
					<ArrowRight className='size-4' />
				</Link>
			</div>

			<div className='news-stat-panel mt-6 grid grid-cols-3 rounded-2xl py-4 max-sm:grid-cols-1 max-sm:px-4 max-sm:py-0'>
				<EntryMetric label='收录天数' value={daily.dayCount} />
				<EntryMetric label='B站视频' value={daily.videoCount} />
				<EntryMetric label='最新日期' value={daily.latestDate} />
			</div>
		</>
	)
}

function EnglishReadingCard({ item }: { item: EnglishReadingItem }) {
	return (
		<>
			<div className='grid grid-cols-[minmax(0,1fr)_auto] gap-8 max-sm:grid-cols-1 max-sm:gap-5'>
				<div className='flex min-w-0 items-center gap-4'>
					<div className='news-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl'>
						<BookOpenText className='size-7' />
					</div>
					<div className='min-w-0'>
						<div className='news-muted text-xs tracking-[0.22em] uppercase'>English Reading</div>
						<h1 className='mt-1 line-clamp-2 text-2xl leading-8 font-semibold max-sm:text-xl'>{item.title}</h1>
						<p className='news-muted mt-2 text-sm leading-6'>每日一篇英文原文，结合音频进行沉浸式听读。</p>
					</div>
				</div>

				<Link href={`/news/english-reading/${encodeURIComponent(item.key)}`} prefetch={false} className='news-primary-action flex h-fit shrink-0 items-center gap-2 self-center rounded-xl px-4 py-2 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 max-sm:w-full max-sm:justify-center'>
					开始精读
					<ArrowRight className='size-4' />
				</Link>
			</div>

			<div className='news-stat-panel mt-6 grid grid-cols-2 rounded-2xl py-4 max-sm:grid-cols-1 max-sm:px-4 max-sm:py-0'>
				<EntryMetric label='最新内容' value='英文原文精读' />
				<EntryMetric label='听读音频' value={item.hasAudio ? '已准备' : '准备中'} />
			</div>
		</>
	)
}

function EntryCardContent({
	card,
	daily,
	englishReading
}: {
	card: EntryCardKind
	daily: NewsEntryDeckProps['daily']
	englishReading?: EnglishReadingItem
}) {
	if (card === 'daily') return <DailyCard daily={daily} />
	return englishReading ? <EnglishReadingCard item={englishReading} /> : null
}

export function NewsEntryDeck({ daily, englishReading }: NewsEntryDeckProps) {
	const shouldReduceMotion = useReducedMotion()
	const [activeIndex, setActiveIndex] = useState(0)
	const [direction, setDirection] = useState(1)
	const [paused, setPaused] = useState(false)
	const cards = useMemo<EntryCardKind[]>(() => (englishReading ? ['daily', 'english'] : ['daily']), [englishReading])
	const activeCard = cards[activeIndex] || cards[0]

	const move = useCallback(
		(nextDirection: 1 | -1) => {
			if (cards.length < 2) return
			setDirection(nextDirection)
			setActiveIndex(current => (current + nextDirection + cards.length) % cards.length)
		},
		[cards.length]
	)

	useEffect(() => {
		if (shouldReduceMotion || paused || cards.length < 2) return

		let timer: number | undefined
		const schedule = () => {
			if (timer) window.clearInterval(timer)
			if (!document.hidden) timer = window.setInterval(() => move(1), AUTO_FLIP_INTERVAL_MS)
		}

		const handleVisibilityChange = () => schedule()
		schedule()
		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => {
			if (timer) window.clearInterval(timer)
			document.removeEventListener('visibilitychange', handleVisibilityChange)
		}
	}, [cards.length, move, paused, shouldReduceMotion])

	return (
		<section className='news-panel-enter relative grid min-h-[268px] w-full max-sm:min-h-[300px]' aria-label='新闻与英语精读入口'>
			{cards.map(card => (
				<div
					key={`${card}-size`}
					aria-hidden='true'
					className='news-card pointer-events-none invisible col-start-1 row-start-1 min-h-[268px] w-full p-6 max-sm:min-h-[300px] max-sm:p-5'>
					<EntryCardContent card={card} daily={daily} englishReading={englishReading} />
				</div>
			))}

			<motion.div
				aria-hidden='true'
				animate={shouldReduceMotion ? undefined : { x: direction > 0 ? 18 : -18, y: 10, rotateZ: direction * 0.45, opacity: 0.44 }}
				transition={{ duration: 0.34, ease: CARD_EASE }}
				className='news-card pointer-events-none absolute inset-2 rounded-[28px] max-sm:inset-1'
			/>

			<AnimatePresence initial={false}>
				<motion.article
					key={activeCard}
					initial={shouldReduceMotion ? false : { opacity: 0, x: direction * 24, rotateY: direction * -4 }}
					animate={{
						opacity: 1,
						x: 0,
						rotateY: 0,
						transition: shouldReduceMotion ? { duration: 0 } : { duration: 0.4, ease: CARD_EASE }
					}}
					exit={
						shouldReduceMotion
							? { opacity: 0, transition: { duration: 0 } }
							: { opacity: 0, x: direction * -18, rotateY: direction * 3, transition: { duration: 0.26, ease: CARD_EXIT_EASE } }
					}
					drag={shouldReduceMotion || cards.length < 2 ? false : 'x'}
					dragConstraints={{ left: 0, right: 0 }}
					dragElastic={0.08}
					onDragEnd={(_, info) => {
						if (Math.abs(info.offset.x) < 48 && Math.abs(info.velocity.x) < 420) return
						move(info.offset.x < 0 ? 1 : -1)
					}}
					onPointerDown={() => setPaused(true)}
					onPointerUp={() => setPaused(false)}
					onPointerCancel={() => setPaused(false)}
					onFocusCapture={() => setPaused(true)}
					onBlurCapture={() => setPaused(false)}
					style={{ transformPerspective: 1400, touchAction: 'pan-y' }}
					className='news-card relative z-10 col-start-1 row-start-1 min-h-[268px] w-full overflow-hidden p-6 will-change-transform max-sm:min-h-[300px] max-sm:p-5'>
					<div className='pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--news-accent)_12%,transparent),transparent_44%)]' aria-hidden='true' />
					<div className='relative'>
						<EntryCardContent card={activeCard} daily={daily} englishReading={englishReading} />
					</div>
				</motion.article>
			</AnimatePresence>
		</section>
	)
}
