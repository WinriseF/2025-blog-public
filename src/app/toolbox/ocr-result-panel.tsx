'use client'

import { useEffect, useRef } from 'react'
import { Copy, Download, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import type { OcrItem, OcrResult } from '@/lib/ocr/types'
import type { OcrPhase } from './use-ocr-worker'

type OcrResultPanelProps = {
	phase: OcrPhase
	result: OcrResult | null
	text: string
	fileName: string
	selectedItemIndex: number | null
	selectionRequest: number
	onTextChange: (text: string) => void
}

function getPlaceholder(phase: OcrPhase) {
	if (phase === 'initializing') return '模型准备完成后，识别结果会显示在这里'
	if (phase === 'recognizing') return '正在读取图片中的文字'
	if (phase === 'error') return '识别失败，重试后结果会显示在这里'
	return '识别结果会显示在这里'
}

function findItemRange(text: string, items: OcrItem[], selectedIndex: number) {
	let cursor = 0
	for (let index = 0; index <= selectedIndex; index++) {
		const itemText = items[index]?.text
		if (!itemText) continue
		const start = text.indexOf(itemText, cursor)
		if (start < 0) continue
		if (index === selectedIndex) return { start, end: start + itemText.length }
		cursor = start + itemText.length
	}

	const itemText = items[selectedIndex]?.text
	const start = itemText ? text.indexOf(itemText) : -1
	return start < 0 ? null : { start, end: start + itemText.length }
}

export function OcrResultPanel({ phase, result, text, fileName, selectedItemIndex, selectionRequest, onTextChange }: OcrResultPanelProps) {
	const hasText = text.length > 0
	const emptyResult = phase === 'success' && !result?.text.trim() && !result?.items.length
	const confidence = Math.round((result?.confidence ?? 0) * 100)
	const selectedItem = selectedItemIndex === null ? null : result?.items[selectedItemIndex] ?? null
	const textareaRef = useRef<HTMLTextAreaElement | null>(null)
	const textRef = useRef(text)
	const itemsRef = useRef(result?.items ?? [])
	textRef.current = text
	itemsRef.current = result?.items ?? []

	useEffect(() => {
		const textarea = textareaRef.current
		if (!textarea) return
		if (selectedItemIndex === null) {
			textarea.setSelectionRange(textarea.selectionEnd, textarea.selectionEnd)
			return
		}

		const range = findItemRange(textRef.current, itemsRef.current, selectedItemIndex)
		if (!range) return

		if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
			textarea.focus({ preventScroll: true })
		}
		textarea.setSelectionRange(range.start, range.end)
	}, [selectedItemIndex, selectionRequest])

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text)
			toast.success('识别文字已复制')
		} catch {
			toast.error('复制失败，请手动选择文字')
		}
	}

	const handleDownload = () => {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `${fileName}.ocr.txt`
		document.body.appendChild(link)
		link.click()
		link.remove()
		URL.revokeObjectURL(url)
	}

	return (
		<section className='flex min-w-0 flex-col border-t border-border xl:border-t-0 xl:border-l'>
			<div className='flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-2.5 max-sm:px-3'>
				<div>
					<label htmlFor='ocr-result-text' className='text-sm font-semibold text-primary'>识别结果</label>
					{phase === 'success' && <p className='mt-1 text-xs text-secondary'>平均置信度 {confidence}%</p>}
				</div>
				<div className='flex items-center gap-2'>
					<button
						type='button'
						onClick={() => void handleCopy()}
						disabled={!hasText}
						aria-label='复制识别文字'
						title='复制识别文字'
						className='flex size-11 items-center justify-center rounded-lg border border-border bg-background/35 text-primary outline-none transition-colors duration-150 hover:border-brand/45 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-secondary/35'>
						<Copy size={17} />
					</button>
					<button
						type='button'
						onClick={handleDownload}
						disabled={!hasText}
						aria-label='下载识别文字'
						title='下载 TXT'
						className='flex size-11 items-center justify-center rounded-lg border border-border bg-background/35 text-primary outline-none transition-colors duration-150 hover:border-brand/45 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-secondary/35'>
						<Download size={17} />
					</button>
				</div>
			</div>

			<div className='flex flex-1 flex-col p-4 max-sm:p-3'>
				{result?.items.length ? (
					<div className='mb-3 flex min-h-11 min-w-0 items-center gap-2 border-b border-border/70 pb-3' aria-live='polite' aria-atomic='true'>
						<ScanLine size={16} className={selectedItem ? 'shrink-0 text-brand' : 'shrink-0 text-secondary/60'} />
						{selectedItem ? (
							<>
								<span className='shrink-0 text-xs font-semibold text-brand'>区域 {selectedItemIndex! + 1}</span>
								<mark className='min-w-0 flex-1 truncate rounded-sm bg-brand/15 px-2 py-1 text-sm font-medium text-primary' title={selectedItem.text}>{selectedItem.text}</mark>
								<span className='shrink-0 text-xs tabular-nums text-secondary'>{Math.round(selectedItem.confidence * 100)}%</span>
							</>
						) : (
							<span className='text-sm text-secondary'>未选择文字区域</span>
						)}
					</div>
				) : null}
				<textarea
					ref={textareaRef}
					id='ocr-result-text'
					value={text}
					onChange={event => onTextChange(event.currentTarget.value)}
					disabled={phase !== 'success'}
					placeholder={getPlaceholder(phase)}
					aria-describedby={emptyResult ? 'ocr-empty-result' : undefined}
					className='min-h-[410px] w-full flex-1 resize-y rounded-lg border border-border bg-card/35 p-4 text-base leading-7 tracking-normal text-primary outline-none transition-colors duration-150 selection:bg-brand/30 selection:text-primary placeholder:text-secondary/55 focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:cursor-default disabled:opacity-80 max-sm:min-h-[280px]'
				/>
				{emptyResult && <p id='ocr-empty-result' className='mt-3 text-sm text-secondary'>未识别到文字，可以更换图片或重新识别。</p>}
			</div>
		</section>
	)
}
