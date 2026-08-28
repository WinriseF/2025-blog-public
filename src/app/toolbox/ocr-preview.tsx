'use client'

import type { CSSProperties } from 'react'
import { ImagePlus, Maximize2, Trash2 } from 'lucide-react'
import type { OcrItem } from '@/lib/ocr/types'

export type OcrPreviewImage = {
	file: File
	name: string
	previewUrl: string
	width: number
	height: number
}

type OcrPreviewProps = {
	image: OcrPreviewImage
	items: OcrItem[]
	showBoxes: boolean
	selectedItemIndex: number | null
	onShowBoxesChange: (show: boolean) => void
	onSelectItem: (index: number | null) => void
	onOpenPreview: () => void
	onReplace: () => void
	onClear: () => void
}

type OcrBoxesProps = {
	items: OcrItem[]
	width: number
	height: number
	selectedItemIndex: number | null
	onSelectItem: (index: number) => void
}

function percent(value: number, total: number) {
	return `${(value / total) * 100}%`
}

export function OcrBoxes({ items, width, height, selectedItemIndex, onSelectItem }: OcrBoxesProps) {
	return (
		<div className='absolute inset-0 z-10'>
			{items.map((item, index) => {
				const style: CSSProperties = {
					left: percent(item.box.x, width),
					top: percent(item.box.y, height),
					width: percent(item.box.width, width),
					height: percent(item.box.height, height)
				}
				const selected = selectedItemIndex === index

				return (
					<button
						key={`${index}-${item.text}`}
						type='button'
						style={style}
						onClick={event => {
							event.stopPropagation()
							onSelectItem(index)
						}}
						aria-pressed={selected}
						aria-label={`选择文字区域 ${index + 1}：${item.text}`}
						title={item.text}
						className={`absolute outline-none transition-[border-color,background-color,box-shadow,opacity] duration-150 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-brand ${
							selected
								? 'z-20 border-2 border-brand bg-brand/20 ring-2 ring-brand ring-offset-1 ring-offset-background'
								: selectedItemIndex === null
									? 'border-2 border-brand/75 bg-brand/8 hover:bg-brand/16'
									: 'border border-brand/55 bg-brand/5 opacity-45 hover:bg-brand/14 hover:opacity-90'
						}`} />
				)
			})}
		</div>
	)
}

export function OcrPreview({ image, items, showBoxes, selectedItemIndex, onShowBoxesChange, onSelectItem, onOpenPreview, onReplace, onClear }: OcrPreviewProps) {
	return (
		<section className='flex min-w-0 flex-col'>
			<div className='flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 max-sm:px-3'>
				<div className='min-w-0'>
					<p className='truncate text-sm font-semibold text-primary' title={image.name}>{image.name}</p>
					<p className='mt-1 text-xs text-secondary'>{image.width} × {image.height}</p>
				</div>
				<div className='flex flex-wrap items-center justify-end gap-2'>
					<label className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors ${items.length ? 'cursor-pointer text-primary hover:bg-brand/5' : 'cursor-not-allowed text-secondary/45'}`}>
						<input
							type='checkbox'
							checked={showBoxes}
							disabled={!items.length}
							onChange={event => onShowBoxesChange(event.currentTarget.checked)}
							className='size-4 rounded border-border bg-card accent-[var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
						/>
						显示识别框
					</label>
					<button
						type='button'
						onClick={onReplace}
						className='flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background/35 px-3 text-xs font-medium text-primary outline-none transition-colors duration-150 hover:border-brand/45 focus-visible:ring-2 focus-visible:ring-brand'
						title='替换图片'>
						<ImagePlus size={15} />
						替换图片
					</button>
					<button
						type='button'
						onClick={onClear}
						className='flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background/35 px-3 text-xs font-medium text-secondary outline-none transition-colors duration-150 hover:border-brand/45 hover:text-primary focus-visible:ring-2 focus-visible:ring-brand'
						title='清除图片'>
						<Trash2 size={15} />
						清除图片
					</button>
				</div>
			</div>

			<div className='flex min-h-[410px] items-center justify-center overflow-hidden bg-card/25 p-5 max-sm:min-h-0 max-sm:p-3'>
				<div
					onClick={() => onSelectItem(null)}
					className='relative mx-auto block w-fit max-w-full overflow-hidden rounded-sm border border-border/70 bg-background shadow-sm'>
					<img src={image.previewUrl} alt={image.name} className='block h-auto max-h-[62vh] max-w-full object-contain' />
					{showBoxes && items.length > 0 && (
						<OcrBoxes items={items} width={image.width} height={image.height} selectedItemIndex={selectedItemIndex} onSelectItem={onSelectItem} />
					)}
					<button
						type='button'
						onClick={event => {
							event.stopPropagation()
							onOpenPreview()
						}}
						aria-label='放大查看图片'
						title='放大查看图片'
						className='absolute right-2 bottom-2 z-30 flex size-11 items-center justify-center rounded-lg border border-white/15 bg-black/65 text-white shadow-md outline-none transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white'>
						<Maximize2 size={16} />
					</button>
				</div>
			</div>
		</section>
	)
}
