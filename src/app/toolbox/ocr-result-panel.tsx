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
	showConfidence?: boolean
	subtitle?: string
	downloadText?: string
	downloadTitle?: string
	downloadEnabled?: boolean
	emptyMessage?: string
	selectedItemIndex: number | null
	selectionRequest: number
	onTextChange: (text: string) => void
}

function getPlaceholder(phase: OcrPhase) {
	if (phase === 'initializing') return '准备完成后，提取结果会显示在这里'
	if (phase === 'recognizing') return '正在读取文件中的文字'
	if (phase === 'error') return '提取失败，重试后结果会显示在这里'
	return '提取结果会显示在这里'
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

export function OcrResultPanel({
	phase,
	result,
	text,
	fileName,
	showConfidence = true,
	subtitle,
	downloadText,
	downloadTitle = '下载 TXT',
	downloadEnabled = true,
	emptyMessage = '未提取到文字，可以更换文件或重新提取。',
	selectedItemIndex,
	selectionRequest,
	onTextChange
}: OcrResultPanelProps) {
	const hasText = text.length > 0
	const exportedText = downloadText ?? text
	const hasDownload = downloadEnabled && exportedText.length > 0
	const canInspect = phase === 'success' || result !== null
	const emptyResult = phase === 'success' && !result?.text.trim() && !result?.items.length
	const confidence = Math.round((result?.confidence ?? 0) * 100)
	const selectedItem = selectedItemIndex === null ? null : (result?.items[selectedItemIndex] ?? null)
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
			toast.success('提取文字已复制')
		} catch {
			toast.error('复制失败，请手动选择文字')
		}
	}

	const handleDownload = () => {
		const url = URL.createObjectURL(new Blob([exportedText], { type: 'text/plain;charset=utf-8' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `${fileName.replace(/\.[^.]+$/, '') || 'extracted-text'}.txt`
		document.body.appendChild(link)
		link.click()
		link.remove()
		URL.revokeObjectURL(url)
	}

	return (
		<section className='border-border flex min-w-0 flex-col border-t xl:border-t-0 xl:border-l'>
			<div className='border-border flex min-h-16 items-center justify-between gap-3 border-b px-4 py-2.5 max-sm:px-3'>
				<div>
					<label htmlFor='ocr-result-text' className='text-primary text-sm font-semibold'>
						提取结果
					</label>
					{subtitle ? (
						<p className='text-secondary mt-1 text-xs'>{subtitle}</p>
					) : (
						phase === 'success' && showConfidence && <p className='text-secondary mt-1 text-xs'>平均置信度 {confidence}%</p>
					)}
				</div>
				<div className='flex items-center gap-2'>
					<button
						type='button'
						onClick={() => void handleCopy()}
						disabled={!hasText}
						aria-label='复制提取文字'
						title='复制提取文字'
						className='border-border bg-background/35 text-primary hover:border-brand/45 hover:text-brand focus-visible:ring-brand disabled:text-secondary/35 flex size-11 items-center justify-center rounded-lg border transition-colors duration-150 outline-none focus-visible:ring-2 disabled:cursor-not-allowed'>
						<Copy size={17} />
					</button>
					<button
						type='button'
						onClick={handleDownload}
						disabled={!hasDownload}
						aria-label={downloadTitle}
						title={downloadTitle}
						className='border-border bg-background/35 text-primary hover:border-brand/45 hover:text-brand focus-visible:ring-brand disabled:text-secondary/35 flex size-11 items-center justify-center rounded-lg border transition-colors duration-150 outline-none focus-visible:ring-2 disabled:cursor-not-allowed'>
						<Download size={17} />
					</button>
				</div>
			</div>

			<div className='flex flex-1 flex-col p-4 max-sm:p-3'>
				{result?.items.length ? (
					<div className='border-border/70 mb-3 flex min-h-11 min-w-0 items-center gap-2 border-b pb-3' aria-live='polite' aria-atomic='true'>
						<ScanLine size={16} className={selectedItem ? 'text-brand shrink-0' : 'text-secondary/60 shrink-0'} />
						{selectedItem ? (
							<>
								<span className='text-brand shrink-0 text-xs font-semibold'>区域 {selectedItemIndex! + 1}</span>
								<mark className='bg-brand/15 text-primary min-w-0 flex-1 truncate rounded-sm px-2 py-1 text-sm font-medium' title={selectedItem.text}>
									{selectedItem.text}
								</mark>
								<span className='text-secondary shrink-0 text-xs tabular-nums'>{Math.round(selectedItem.confidence * 100)}%</span>
							</>
						) : (
							<span className='text-secondary text-sm'>未选择文字区域</span>
						)}
					</div>
				) : null}
				<textarea
					ref={textareaRef}
					id='ocr-result-text'
					value={text}
					onChange={event => onTextChange(event.currentTarget.value)}
					disabled={!canInspect}
					readOnly={phase !== 'success'}
					placeholder={getPlaceholder(phase)}
					aria-describedby={emptyResult ? 'ocr-empty-result' : undefined}
					className='border-border bg-card/35 text-primary selection:bg-brand/30 selection:text-primary placeholder:text-secondary/55 focus:border-brand/60 focus:ring-brand/20 min-h-[410px] w-full flex-1 resize-y rounded-lg border p-4 text-base leading-7 tracking-normal transition-colors duration-150 outline-none focus:ring-2 disabled:cursor-default disabled:opacity-80 max-sm:min-h-[280px]'
				/>
				{emptyResult && (
					<p id='ocr-empty-result' className='text-secondary mt-3 text-sm'>
						{emptyMessage}
					</p>
				)}
			</div>
		</section>
	)
}
