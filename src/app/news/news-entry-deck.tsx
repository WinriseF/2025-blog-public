'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, BookOpenText, Newspaper, type LucideIcon } from 'lucide-react'
import type { EnglishReadingItem } from '@/lib/english-reading'

const CARD_EASE = [0.22, 1, 0.36, 1] as const
const CARD_EXIT_EASE = [0.4, 0, 1, 1] as const

type EntryCard = {
	id: 'daily' | 'english'
	label: string
	eyebrow: string
	icon: LucideIcon
	title: string
	description: ReactNode
	href: string
	action: string
	metrics: Array<{ label: string; value: ReactNode }>
}

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

function EntryMetric({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className='news-stat px-4 first:border-l-0 max-sm:border-l-0 max-sm:px-0 max-sm:py-3 max-sm:first:border-t-0'>
			<div className='news-muted text-xs'>{label}</div>
			<div className='mt-1 text-lg font-semibold leading-none max-sm:text-base'>{value}</div>
		</div>
	)
}

function FeatureCard({ card }: { card: EntryCard }) {
	const Icon = card.icon

	return (
		<>
			<div className='grid grid-cols-[minmax(0,1fr)_auto] gap-8 max-sm:grid-cols-1 max-sm:gap-5'>
				<div className='flex min-w-0 items-center gap-4'>
					<div className='news-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl'>
						<Icon className='size-7' />
					</div>
					<div className='min-w-0'>
						<div className='news-muted text-xs tracking-[0.22em] uppercase'>{card.eyebrow}</div>
						<h1 className='mt-1 min-h-16 line-clamp-2 text-2xl leading-8 font-semibold max-sm:text-xl'>{card.title}</h1>
						<div className='news-muted mt-2 min-h-12 text-sm leading-6'>{card.description}</div>
					</div>
				</div>

				<Link href={card.href} prefetch={false} className='news-primary-action flex h-fit shrink-0 items-center gap-2 self-center rounded-xl px-4 py-2 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 max-sm:w-full max-sm:justify-center'>
					{card.action}
					<ArrowRight className='size-4' />
				</Link>
			</div>

			<div className='news-stat-panel mt-6 grid grid-cols-3 rounded-2xl py-4 max-sm:grid-cols-1 max-sm:px-4 max-sm:py-0'>
				{card.metrics.map(metric => (
					<EntryMetric key={metric.label} {...metric} />
				))}
			</div>
		</>
	)
}

export function NewsEntryDeck({ daily, englishReading }: NewsEntryDeckProps) {
	const shouldReduceMotion = useReducedMotion()
	const [activeIndex, setActiveIndex] = useState(0)
	const [direction, setDirection] = useState(1)
	const cards: EntryCard[] = [
		{
			id: 'daily',
			label: '日报',
			eyebrow: 'Daily Intel Digest',
			icon: Newspaper,
			title: daily.title,
			description: (
				<>
					汇总 B 站 UP 内容与 NewsNow 午间热点摘要
					{daily.updatedAt ? <span className='block'>更新时间：{daily.updatedAt}</span> : null}
				</>
			),
			href: daily.latestHref,
			action: '查看最新',
			metrics: [
				{ label: '收录天数', value: daily.dayCount },
				{ label: 'B站视频', value: daily.videoCount },
				{ label: '最新日期', value: daily.latestDate }
			]
		},
		...(englishReading
			? [
					{
						id: 'english' as const,
						label: '英语精读',
						eyebrow: 'English Reading',
						icon: BookOpenText,
						title: englishReading.title,
						description: '每日一篇英文原文，结合音频进行沉浸式听读。',
						href: '/news/english-reading',
						action: '浏览精读',
						metrics: [
							{ label: '最新内容', value: '英文原文精读' },
							{ label: '听读音频', value: englishReading.hasAudio ? '已准备' : '准备中' },
							{ label: '最新日期', value: englishReading.key }
						]
					}
				]
			: [])
	]
	const activeCard = cards[activeIndex] || cards[0]

	function move(nextDirection: 1 | -1) {
		if (cards.length < 2) return
		setDirection(nextDirection)
		setActiveIndex(current => ((current < cards.length ? current : 0) + nextDirection + cards.length) % cards.length)
	}

	return (
		<section className='news-panel-enter w-full' aria-label='新闻与英语精读入口'>
			<div className='relative grid min-h-[268px] max-sm:min-h-[300px]'>
				<motion.div
					aria-hidden='true'
					animate={shouldReduceMotion ? undefined : { x: direction > 0 ? 18 : -18, y: 10, rotateZ: direction * 0.45, opacity: 0.44 }}
					transition={{ duration: 0.34, ease: CARD_EASE }}
					className='news-card pointer-events-none absolute inset-2 rounded-[28px] max-sm:inset-1'
				/>

				<AnimatePresence initial={false}>
					<motion.article
						key={activeCard.id}
						initial={shouldReduceMotion ? false : { opacity: 0, x: direction * 24, rotateY: direction * -4 }}
						animate={{ opacity: 1, x: 0, rotateY: 0, transition: shouldReduceMotion ? { duration: 0 } : { duration: 0.4, ease: CARD_EASE } }}
						exit={shouldReduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: direction * -18, rotateY: direction * 3, transition: { duration: 0.26, ease: CARD_EXIT_EASE } }}
						drag={shouldReduceMotion || cards.length < 2 ? false : 'x'}
						dragConstraints={{ left: 0, right: 0 }}
						dragElastic={0.08}
						onDragEnd={(_, info) => {
							if (Math.abs(info.offset.x) < 48 && Math.abs(info.velocity.x) < 420) return
							move(info.offset.x < 0 ? 1 : -1)
						}}
						style={{ transformPerspective: 1400, touchAction: 'pan-y' }}
						className='news-card relative z-10 col-start-1 row-start-1 min-h-[268px] w-full overflow-hidden p-6 will-change-transform max-sm:min-h-[300px] max-sm:p-5'>
						<div className='pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--news-accent)_12%,transparent),transparent_44%)]' aria-hidden='true' />
						<div className='relative'>
							<FeatureCard card={activeCard} />
						</div>
					</motion.article>
				</AnimatePresence>
			</div>

			{cards.length > 1 && (
				<div className='mt-3 flex justify-center gap-2' aria-label='切换入口'>
					{cards.map((card, index) => (
						<button
							key={card.id}
							type='button'
							aria-pressed={card.id === activeCard.id}
							onClick={() => {
								setDirection(index >= activeIndex ? 1 : -1)
								setActiveIndex(index)
							}}
							className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${card.id === activeCard.id ? 'news-primary-action' : 'news-card news-muted'}`}>
							{card.label}
						</button>
					))}
				</div>
			)}
		</section>
	)
}
