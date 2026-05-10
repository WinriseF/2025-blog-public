'use client'

import Link from 'next/link'
import dayjs from 'dayjs'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import ShortLineSVG from '@/svgs/short-line.svg'
import { useBlogIndex, type BlogIndexItem } from '@/hooks/use-blog-index'
import { useBlogWordCloud } from '@/hooks/use-blog-word-cloud'
import { useReadArticles } from '@/hooks/use-read-articles'
import { useAuthStore } from '@/hooks/use-auth'
import { readFileAsText } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import { batchDeleteBlogs } from './services/batch-delete-blogs'
import { Check, Cloud, List } from 'lucide-react'
import { YearWordCloud } from '@/components/year-word-cloud'

export default function BlogPage() {
	const { items, loading } = useBlogIndex()
	const { years: wordCloudYears, loading: wordCloudLoading, error: wordCloudError } = useBlogWordCloud()
	const { isRead } = useReadArticles()
	const { isAuth, setPrivateKey } = useAuthStore()

	const keyInputRef = useRef<HTMLInputElement>(null)
	const [editMode, setEditMode] = useState(false)
	const [viewMode, setViewMode] = useState<'list' | 'cloud'>('list')
	const [editableItems, setEditableItems] = useState<BlogIndexItem[]>([])
	const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		if (!editMode) {
			setEditableItems(items)
		}
	}, [items, editMode])

	const displayItems = editMode ? editableItems : items

	const { groupedItems, years } = useMemo(() => {
		const sorted = [...displayItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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
	}, [displayItems])

	const wordCloudByYear = useMemo(() => new Map(wordCloudYears.map(group => [group.year, group])), [wordCloudYears])
	const isCloudView = viewMode === 'cloud' && !editMode
	const selectedCount = selectedSlugs.size
	const buttonText = isAuth ? '保存' : '导入密钥'
	const viewButtonText = isCloudView ? '文章列表' : '词云图'

	const toggleViewMode = useCallback(() => {
		setViewMode(mode => (mode === 'cloud' ? 'list' : 'cloud'))
	}, [])

	const toggleEditMode = useCallback(() => {
		if (editMode) {
			setEditMode(false)
			setEditableItems(items)
			setSelectedSlugs(new Set())
		} else {
			setEditableItems(items)
			setEditMode(true)
			setViewMode('list')
		}
	}, [editMode, items])

	const toggleSelect = useCallback((slug: string) => {
		setSelectedSlugs(prev => {
			const next = new Set(prev)
			if (next.has(slug)) {
				next.delete(slug)
			} else {
				next.add(slug)
			}
			return next
		})
	}, [])

	const handleItemClick = useCallback(
		(event: React.MouseEvent, slug: string) => {
			if (!editMode) return
			event.preventDefault()
			event.stopPropagation()
			toggleSelect(slug)
		},
		[editMode, toggleSelect]
	)

	const handleDeleteSelected = useCallback(() => {
		if (selectedCount === 0) {
			toast.info('请选择要删除的文章')
			return
		}
		setEditableItems(prev => prev.filter(item => !selectedSlugs.has(item.slug)))
		setSelectedSlugs(new Set())
	}, [selectedCount, selectedSlugs])

	const handleCancel = useCallback(() => {
		setEditableItems(items)
		setSelectedSlugs(new Set())
		setEditMode(false)
	}, [items])

	const handleSave = useCallback(async () => {
		const removedSlugs = items.filter(item => !editableItems.some(editItem => editItem.slug === item.slug)).map(item => item.slug)

		if (removedSlugs.length === 0) {
			toast.info('没有需要保存的改动')
			return
		}

		try {
			setSaving(true)
			await batchDeleteBlogs(removedSlugs)
			setEditMode(false)
			setSelectedSlugs(new Set())
		} catch (error: any) {
			console.error(error)
			toast.error(error?.message || '保存失败')
		} finally {
			setSaving(false)
		}
	}, [editableItems, items])

	const handleSaveClick = useCallback(() => {
		if (!isAuth) {
			keyInputRef.current?.click()
			return
		}
		void handleSave()
	}, [handleSave, isAuth])

	const handlePrivateKeySelection = useCallback(
		async (file: File) => {
			try {
				const pem = await readFileAsText(file)
				setPrivateKey(pem)
				toast.success('密钥导入成功，请再次点击保存')
			} catch (error) {
				console.error(error)
				toast.error('读取密钥失败')
			}
		},
		[setPrivateKey]
	)

	return (
		<>
			<input
				ref={keyInputRef}
				type='file'
				accept='.pem'
				className='hidden'
				onChange={async e => {
					const f = e.target.files?.[0]
					if (f) await handlePrivateKeySelection(f)
					if (e.currentTarget) e.currentTarget.value = ''
				}}
			/>

			<div className='flex flex-col items-center justify-center gap-6 px-6 pt-32 pb-12 max-sm:pt-28'>
				{!editMode && (
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
				)}

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
										<div className='text-secondary flex h-[300px] items-center justify-center rounded-2xl border bg-white/35 text-sm'>词云数据加载失败</div>
									) : wordCloudLoading ? (
										<div className='text-secondary flex h-[300px] items-center justify-center rounded-2xl border bg-white/35 text-sm'>生成中...</div>
									) : (
										<YearWordCloud words={cloud?.words || []} height={300} maxWords={72} />
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
										const isSelected = selectedSlugs.has(it.slug)
										return (
											<Link
												href={`/blog/${it.slug}`}
												key={it.slug}
												onClick={event => handleItemClick(event, it.slug)}
												className={cn(
													'group flex min-h-10 items-center gap-3 py-3 transition-all',
													editMode
														? cn(
																'rounded-lg border px-3',
																isSelected ? 'border-brand/60 bg-brand/5' : 'hover:border-brand/40 border-transparent hover:bg-white/60'
															)
														: 'cursor-pointer'
												)}>
												{editMode && (
													<span
														className={cn(
															'flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold',
															isSelected ? 'border-brand bg-brand text-white' : 'border-[#D9D9D9] text-transparent'
														)}>
														<Check />
													</span>
												)}
												<span className='text-secondary w-[44px] shrink-0 text-sm font-medium'>{dayjs(it.date).format('MM-DD')}</span>

												<div className='relative flex h-2 w-2 items-center justify-center'>
													<div className='bg-secondary group-hover:bg-brand h-[5px] w-[5px] rounded-full transition-all group-hover:h-4'></div>
													<ShortLineSVG className='absolute bottom-4' />
												</div>
												<div
													className={cn(
														'flex-1 truncate text-sm font-medium transition-all',
														editMode ? null : 'group-hover:text-brand group-hover:translate-x-2'
													)}>
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
				{editMode ? (
					<>
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={handleCancel}
							disabled={saving}
							className='rounded-xl border bg-white/60 px-6 py-2 text-sm'>
							取消
						</motion.button>
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={handleDeleteSelected}
							disabled={selectedCount === 0}
							className='rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 transition-colors disabled:opacity-60'>
							删除(已选:{selectedCount}篇)
						</motion.button>
						<motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleSaveClick} disabled={saving} className='brand-btn px-6'>
							{saving ? '保存中...' : buttonText}
						</motion.button>
					</>
				) : (
					<>
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={toggleViewMode}
							className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80'>
							{isCloudView ? <List className='size-4' /> : <Cloud className='size-4' />}
							{viewButtonText}
						</motion.button>
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={toggleEditMode}
							className='rounded-xl border bg-white/60 px-6 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80'>
							编辑
						</motion.button>
					</>
				)}
			</motion.div>
		</>
	)
}
