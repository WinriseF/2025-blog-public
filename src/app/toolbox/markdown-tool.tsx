'use client'

import { useDeferredValue, useRef, useState, type DragEvent } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { INIT_DELAY } from '@/consts'
import { ReadingProgressBar } from '@/components/reading-progress-bar'
import { readFileAsText } from '@/lib/file-utils'
import { useMarkdownRender } from '@/hooks/use-markdown-render'

const defaultMarkdown = '# Markdown 查看器\n\n把 Markdown 文件拖进来，或直接在左侧编辑。'
const markdownRenderOptions = { worker: false } as const

function downloadText(filename: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}

export function MarkdownTool() {
	const shouldReduceMotion = useReducedMotion()
	const [markdown, setMarkdown] = useState(defaultMarkdown)
	const [fileName, setFileName] = useState('preview.md')
	const [isPreviewExpanded, setPreviewExpanded] = useState(false)
	const previewScrollRef = useRef<HTMLDivElement | null>(null)
	const deferredMarkdown = useDeferredValue(markdown)
	const { content, loading } = useMarkdownRender(deferredMarkdown, markdownRenderOptions)

	const handleFiles = async (files: FileList | null) => {
		const file = files?.[0]
		if (!file) return
		try {
			const text = await readFileAsText(file)
			setFileName(file.name || 'preview.md')
			setMarkdown(text)
		} catch {
			toast.error('文件读取失败')
		}
	}

	const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		void handleFiles(event.dataTransfer.files)
	}

	const copyMarkdown = async () => {
		try {
			await navigator.clipboard.writeText(markdown)
			toast.success('Markdown 已复制')
		} catch {
			toast.error('复制失败，请手动复制')
		}
	}

	const buttonHover = shouldReduceMotion ? undefined : { y: -1 }
	const buttonTap = shouldReduceMotion ? undefined : { scale: 0.95 }
	const panelClassName = 'flex min-h-[640px] flex-col max-sm:min-h-[360px] lg:h-[max(640px,calc(100dvh-12rem))]'
	const previewContent = (
		<motion.div animate={{ opacity: loading && !shouldReduceMotion ? 0.55 : 1 }} className='prose max-w-none cursor-text'>
			{loading ? <div className='text-secondary text-sm'>渲染中...</div> : content}
		</motion.div>
	)

	return (
		<motion.div
			initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ delay: INIT_DELAY }}
			className={`relative grid gap-6 max-sm:px-4 ${isPreviewExpanded ? '' : 'lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'}`}>
			{!isPreviewExpanded && (
				<section className={panelClassName}>
					<div className='flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3'>
						<div>
							<h2 className='text-lg font-semibold'>Markdown</h2>
							<p className='text-secondary mt-1 text-xs tracking-[0.18em] uppercase'>{fileName}</p>
						</div>
						<div className='flex flex-wrap gap-2 text-xs'>
							<motion.button type='button' whileHover={buttonHover} whileTap={buttonTap} className='rounded-full border border-border px-3 py-1.5 font-medium' onClick={() => void copyMarkdown()}>
								复制
							</motion.button>
							<motion.button type='button' whileHover={buttonHover} whileTap={buttonTap} className='rounded-full border border-border px-3 py-1.5 font-medium' onClick={() => downloadText(fileName || 'preview.md', markdown)}>
								下载
							</motion.button>
							<motion.button type='button' whileHover={buttonHover} whileTap={buttonTap} className='rounded-full border border-rose-300/50 px-3 py-1.5 font-medium text-rose-400' onClick={() => setMarkdown('')}>
								清空
							</motion.button>
						</div>
					</div>

					<motion.label
						onDragOver={event => event.preventDefault()}
						onDrop={handleDrop}
						whileHover={shouldReduceMotion ? undefined : { y: -1 }}
						whileTap={shouldReduceMotion ? undefined : { scale: 0.995 }}
						className='border-brand/20 bg-brand/5 text-secondary mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed px-4 py-3 text-xs'>
						<input type='file' accept='.md,text/markdown,text/plain' className='hidden' onChange={event => void handleFiles(event.target.files)} />
						选择或拖入 Markdown 文件
					</motion.label>

					<textarea
						value={markdown}
						onChange={event => setMarkdown(event.target.value)}
						className='mt-4 min-h-[480px] flex-1 resize-none rounded-2xl border border-border bg-article p-4 font-mono text-sm leading-6 text-primary max-sm:min-h-[320px]'
						spellCheck={false}
					/>
				</section>
			)}

			<section className={panelClassName}>
				<div className='text-secondary flex items-center justify-between gap-3 border-b border-border pb-3 text-xs tracking-[0.18em] uppercase'>
					<span>Preview</span>
					<motion.button
						type='button'
						onClick={() => setPreviewExpanded(expanded => !expanded)}
						whileHover={buttonHover}
						whileTap={buttonTap}
						className={`${isPreviewExpanded ? 'flex' : 'hidden lg:flex'} items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium tracking-normal normal-case`}>
						{isPreviewExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
						{isPreviewExpanded ? '返回编辑' : '展开预览'}
					</motion.button>
				</div>
				<div ref={previewScrollRef} className='relative mt-5 min-h-0 flex-1 overflow-y-auto max-sm:overflow-visible'>
					<ReadingProgressBar scrollContainerRef={previewScrollRef} embedded className='max-lg:hidden' />
					<div className='pt-3'>{previewContent}</div>
				</div>
			</section>
		</motion.div>
	)
}
