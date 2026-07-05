'use client'

import Link from 'next/link'
import dayjs from 'dayjs'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import ShortLineSVG from '@/svgs/short-line.svg'
import { useBlogIndex, type BlogIndexItem } from '@/hooks/use-blog-index'
import { useBlogWordCloud } from '@/hooks/use-blog-word-cloud'
import { useReadArticles } from '@/hooks/use-read-articles'
import { Cloud, List } from 'lucide-react'
import { YearWordCloud } from '@/components/year-word-cloud'

export default function BlogPage() {
	const { items, loading } = useBlogIndex()
	const { years: wordCloudYears, loading: wordCloudLoading, error: wordCloudError } = useBlogWordCloud()
	const { isRead } = useReadArticles()

	const [viewMode, setViewMode] = useState<'list' | 'cloud'>('list')

	const { groupedItems, years } = useMemo(() => {
		const sorted = [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
		const grouped = sorted.reduce(
			(acc, item) => {
				const year = dayjs(item.date).format('YYYY')
				if (!acc[year]) {
					acc[year] = []
				}
				acc[year].push(item)
				return acc
			},
			{} as Record<string, BlogIndexItem[]>
		)
		const yearKeys = Object.keys(grouped).sort((a, b) => Number(b) - Number(a))
		return { groupedItems: grouped, years: yearKeys }
	}, [items])

	const wordCloudByYear = useMemo(() => new Map(wordCloudYears.map(group => [group.year, group])), [wordCloudYears])
	const isCloudView = viewMode === 'cloud'
	const viewButtonText = isCloudView ? '文章列表' : '词云图'

	const toggleViewMode = useCallback(() => {
		setViewMode(mode => (mode === 'cloud' ? 'list' : 'cloud'))
	}, [])

	return (
		<>
			<div className='flex flex-col items-center justify-center gap-6 px-6 pt-32 pb-12 max-sm:pt-28'>
				<div className='hidden w-full max-w-[840px] justify-end max-sm:flex'>
					<motion.button
						whileHover={{ scale: 1.05 }}
						whileTap={{ scale: 0.95 }}
						onClick={toggleViewMode}
						className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80'>
						{isCloudView ? <List className='size-4' /> : <Cloud className='size-4' />}
						{viewButtonText}
					</motion.button>
				</div>

				{isCloudView ? (
					<>
						{years.map((year, index) => {
							const cloud = wordCloudByYear.get(year)
							const topWords = cloud?.words.slice(0, 5) || []

							return (
								<motion.div
									key={year}
									initial={{ opacity: 0, scale: 0.9 }}
									animate={{ opacity: 1, scale: 1 }}
									transition={{ delay: INIT_DELAY + ANIMATION_DELAY * index }}
									className='card relative w-full max-w-[840px] space-y-5 p-5'>
									<div className='flex flex-wrap items-center justify-between gap-4'>
										<div className='flex items-center gap-3 text-base'>
											<div className='text-xl font-semibold'>{year}</div>

											<div className='h-2 w-2 rounded-full bg-[#D9D9D9]'></div>

											<div>
												<div className='text-sm font-medium'>年度关键词</div>
												<div className='text-secondary mt-1 text-xs'>{groupedItems[year].length} 篇文章</div>
											</div>
										</div>

										{topWords.length > 0 && (
											<div className='flex max-w-full flex-wrap justify-end gap-2'>
												{topWords.map(word => (
													<span key={word.text} className='border-brand/20 bg-brand/10 text-brand rounded-full border px-3 py-1 text-xs font-medium'>
														{word.text}
													</span>
												))}
											</div>
										)}
									</div>

									{wordCloudError ? (
										<div className='year-word-cloud text-secondary flex h-[300px] items-center justify-center rounded-2xl border text-sm'>词云数据加载失败</div>
									) : wordCloudLoading ? (
										<div className='year-word-cloud text-secondary flex h-[300px] items-center justify-center rounded-2xl border text-sm'>生成中...</div>
									) : (
										<YearWordCloud words={cloud?.words || []} height={300} maxWords={90} />
									)}
								</motion.div>
							)
						})}
						{!loading && items.length === 0 && <div className='text-secondary py-6 text-center text-sm'>暂无文章</div>}
						{loading && <div className='text-secondary py-6 text-center text-sm'>加载中...</div>}
					</>
				) : (
					<>
						{years.map((year, index) => (
							<motion.div
								key={year}
								initial={{ opacity: 0, scale: 0.9 }}
								animate={{ opacity: 1, scale: 1 }}
								transition={{ delay: INIT_DELAY + ANIMATION_DELAY * index }}
								className='card relative w-full max-w-[840px] space-y-6'>
								<div className='mb-3 flex items-center gap-3 text-base'>
									<div className='w-[44px] font-medium'>{year}</div>

									<div className='h-2 w-2 rounded-full bg-[#D9D9D9]'></div>

									<div className='text-secondary text-sm'>{groupedItems[year].length} 篇文章</div>
								</div>
								<div>
									{groupedItems[year].map(it => {
										const hasRead = isRead(it.slug)
										return (
											<Link
												href={`/blog/${it.slug}`}
												key={it.slug}
												className='group flex min-h-10 cursor-pointer items-center gap-3 py-3 transition-all'>
												<span className='text-secondary w-[44px] shrink-0 text-sm font-medium'>{dayjs(it.date).format('MM-DD')}</span>

												<div className='relative flex h-2 w-2 items-center justify-center'>
													<div className='bg-secondary group-hover:bg-brand h-[5px] w-[5px] rounded-full transition-all group-hover:h-4'></div>
													<ShortLineSVG className='absolute bottom-4' />
												</div>
												<div
													className='flex-1 truncate text-sm font-medium transition-all group-hover:text-brand group-hover:translate-x-2'>
													{it.title || it.slug}
													{hasRead && <span className='text-secondary ml-2 text-xs'>[已阅读]</span>}
												</div>
												<div className='flex flex-wrap items-center gap-2 max-sm:hidden'>
													{(it.tags || []).map(t => (
														<span key={t} className='text-secondary text-sm'>
															#{t}
														</span>
													))}
												</div>
											</Link>
										)
									})}
								</div>
							</motion.div>
						))}
						{!loading && items.length === 0 && <div className='text-secondary py-6 text-center text-sm'>暂无文章</div>}
						{loading && <div className='text-secondary py-6 text-center text-sm'>加载中...</div>}
					</>
				)}
			</div>

			<motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} className='absolute top-4 right-6 flex gap-3 max-sm:hidden'>
				<motion.button
					whileHover={{ scale: 1.05 }}
					whileTap={{ scale: 0.95 }}
					onClick={toggleViewMode}
					className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80'>
					{isCloudView ? <List className='size-4' /> : <Cloud className='size-4' />}
					{viewButtonText}
				</motion.button>
			</motion.div>
		</>
	)
}
