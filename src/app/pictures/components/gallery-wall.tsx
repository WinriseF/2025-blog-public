'use client'

import { useLayoutEffect, useMemo, useState } from 'react'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { OptimizedImage } from '@/components/optimized-image'
import { getAssetUrl } from '@/lib/asset-url'
import styles from '../wall.module.css'

type Picture = {
	id: string
	images: string[]
	title?: string
	category?: string
	cover?: string
	description?: string
	width?: number
	height?: number
}

const mounts = ['rail', 'pin', 'clips', 'paper', 'tape', 'frame'] as const
type Mount = (typeof mounts)[number]
const worksPerSheet = 5
const categoryOf = (picture: Picture) => picture.category || '其他'
const titleOf = (picture: Picture) => picture.title || picture.description || '未命名作品'

function Clip() {
	return (
		<svg className={styles.clip} viewBox='0 0 30 38' aria-hidden='true'>
			<path d='M5 19 L24 19 L28 36 Q15 39 2 35 Z' fill='#272823' stroke='#62615b' />
			<path d='M3 34 Q14 37 27 35' fill='none' stroke='#9c978c' />
			<path d='M11 26 L13 13 C13 10 8 7 10 4 C12 0 18 0 20 4 C22 8 17 10 17 13 L19 26' fill='none' stroke='#393832' strokeWidth='2.8' />
			<path d='M11 24 L13.6 13 C14 9 9 7 11 4 C13 1 18 1 19 4' fill='none' stroke='#d6d1c4' strokeWidth='1' />
		</svg>
	)
}

export function GalleryWall({ pictures }: { pictures: Picture[] }) {
	const [category, setCategory] = useState('全部')
	const [mountById, setMountById] = useState<Map<string, Mount>>()
	const [preview, setPreview] = useState<{ images: { src: string; title: string }[]; index: number } | null>(null)
	const [failed, setFailed] = useState(false)
	const works = useMemo(() => pictures.filter(picture => picture.images.length), [pictures])
	useLayoutEffect(() => {
		const assigned = new Map<string, Mount>()
		const remaining: Mount[] = []
		for (const picture of works) {
			if (!remaining.length) remaining.push(...mounts)
			const index = Math.floor(Math.random() * remaining.length)
			assigned.set(picture.id, remaining.splice(index, 1)[0])
		}
		setMountById(assigned)
	}, [works])
	const categories = ['全部', ...new Set(works.map(categoryOf))]
	const visible = category === '全部' ? works : works.filter(picture => categoryOf(picture) === category)
	const sheets = Array.from({ length: Math.ceil(visible.length / worksPerSheet) }, (_, i) => visible.slice(i * worksPerSheet, (i + 1) * worksPerSheet))

	function openPreview(picture: Picture) {
		const group = picture.images.length === 1 ? visible.filter(work => work.images.length === 1) : [picture]
		const images = group.flatMap(work => work.images.map(src => ({ src, title: titleOf(work) })))
		setFailed(false)
		setPreview({ images, index: group.indexOf(picture) })
	}

	return (
		<section className={styles.wall} aria-label='画廊'>
			<h1 className='sr-only'>画廊</h1>
			<nav className={styles.filters} aria-label='画廊分类'>
				{categories.map(name => (
					<button type='button' key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>
						{name}
					</button>
				))}
			</nav>
			<div className={styles.exhibit}>
				{sheets.map((sheet, row) => (
					<div className={styles.sheet} data-count={sheet.length} key={sheet[0].id}>
						{sheet.map((picture, slot) => {
							const mount = mountById?.get(picture.id) ?? mounts[slot]
							const title = titleOf(picture)
							return (
								<button
									type='button'
									key={picture.id}
									className={styles.work}
									data-mount={mount}
									aria-label={picture.images.length > 1 ? title + '，共 ' + picture.images.length + ' 张' : title}
									onClick={event => {
									event.currentTarget.focus({ preventScroll: true })
									openPreview(picture)
									}}>
									<span className={styles.print}>
										{mount === 'rail' && (
											<>
												<svg className={styles.wire} viewBox='0 0 100 18' aria-hidden='true'>
													<path d='M9 18 L50 1.4 L91 18' />
												</svg>
												<i className={styles.nail} />
											</>
										)}
										{mount === 'clips' && (
											<>
												<Clip />
												<Clip />
											</>
										)}
										<span className={styles.stock}>
											<OptimizedImage
												src={getAssetUrl(picture.cover || picture.images[0])}
												alt={title}
												width={picture.width}
												height={picture.height}
												draggable={false}
												loading={row === 0 && slot === 0 ? 'eager' : 'lazy'}
												fetchPriority={row === 0 && slot === 0 ? 'high' : undefined}
											/>
										</span>
										{(mount === 'pin' || mount === 'paper') && <i className={styles.nail} />}
									</span>
									<span className={styles.caption}>
										{title}
										{picture.images.length > 1 && <small>{picture.images.length} 张</small>}
									</span>
								</button>
							)
						})}
					</div>
				))}
				{!works.length && <p className={styles.empty}>还没有图片。</p>}
			</div>
			{preview && (
				<ImagePreviewDialog
					src={getAssetUrl(preview.images[preview.index].src)}
					alt={preview.images[preview.index].title}
					message={failed ? '图片加载失败' : undefined}
					onError={() => setFailed(true)}
					gallery={
						preview.images.length > 1
							? {
									index: preview.index,
									length: preview.images.length,
									swipe: true,
									onChange: next => {
										setFailed(false)
										setPreview({ ...preview, index: next })
									}
								}
							: undefined
					}
					onClose={() => setPreview(null)}
				/>
			)}
		</section>
	)
}
