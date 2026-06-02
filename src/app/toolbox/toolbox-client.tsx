'use client'

import { useState, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { readFileAsText } from '@/lib/file-utils'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import { ImageToolbox } from '../image-toolbox/image-toolbox'

type ToolId = 'image' | 'markdown'

const tools: Array<{ id: ToolId; label: string; desc: string }> = [
	{ id: 'image', label: '图片压缩', desc: 'PNG / JPG 转 WEBP' },
	{ id: 'markdown', label: 'Markdown 查看器', desc: '本地预览 .md 文件' }
]

const defaultMarkdown = '# Markdown 查看器\n\n把 Markdown 文件拖进来，或直接在左侧编辑。'

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

function MarkdownTool() {
	const [markdown, setMarkdown] = useState(defaultMarkdown)
	const [fileName, setFileName] = useState('preview.md')
	const { content, loading } = useMarkdownRender(markdown, { worker: false })

	const handleFiles = async (files: FileList | null) => {
		const file = files?.[0]
		if (!file) return
		setFileName(file.name || 'preview.md')
		setMarkdown(await readFileAsText(file))
	}

	const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		void handleFiles(event.dataTransfer.files)
	}

	return (
		<div className='grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'>
			<motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className='card static flex min-h-[640px] flex-col rounded-[32px] p-5'>
				<div className='flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3'>
					<div>
						<p className='text-secondary text-xs tracking-[0.18em] uppercase'>{fileName}</p>
						<h2 className='mt-1 text-lg font-semibold'>Markdown</h2>
					</div>
					<div className='flex flex-wrap gap-2 text-xs'>
						<button className='rounded-full border border-border bg-card px-3 py-1.5 font-medium' onClick={() => navigator.clipboard.writeText(markdown)}>
							复制
						</button>
						<button className='rounded-full border border-border bg-card px-3 py-1.5 font-medium' onClick={() => downloadText(fileName || 'preview.md', markdown)}>
							下载
						</button>
						<button className='rounded-full border border-rose-300/50 bg-card px-3 py-1.5 font-medium text-rose-400' onClick={() => setMarkdown('')}>
							清空
						</button>
					</div>
				</div>

				<label
					onDragOver={event => event.preventDefault()}
					onDrop={handleDrop}
					className='border-brand/20 bg-brand/5 text-secondary mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed px-4 py-3 text-xs'>
					<input type='file' accept='.md,text/markdown,text/plain' className='hidden' onChange={event => void handleFiles(event.target.files)} />
					选择或拖入 Markdown 文件
				</label>

				<textarea
					value={markdown}
					onChange={event => setMarkdown(event.target.value)}
					className='mt-4 min-h-[480px] flex-1 resize-none rounded-2xl border border-border bg-article p-4 font-mono text-sm leading-6 text-primary'
					spellCheck={false}
				/>
			</motion.section>

			<motion.section
				initial={{ opacity: 0, scale: 0.96 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ delay: ANIMATION_DELAY }}
				className='card bg-article static min-h-[640px] overflow-auto rounded-[32px] p-6'>
				<div className='text-secondary border-b border-border pb-3 text-xs tracking-[0.18em] uppercase'>Preview</div>
				<div className='prose mt-5 max-w-none cursor-text'>{loading ? <div className='text-secondary text-sm'>渲染中...</div> : content}</div>
			</motion.section>
		</div>
	)
}

export function ToolboxClient() {
	const [activeTool, setActiveTool] = useState<ToolId>('image')

	return (
		<div className='relative px-6 pt-32 pb-12 text-sm max-sm:pt-28'>
			<div className='mx-auto flex max-w-6xl flex-col gap-6'>
				<motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: INIT_DELAY }} className='space-y-2 text-center'>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Toolbox</p>
					<h1 className='text-2xl font-semibold'>客户端工具箱</h1>
					<p className='text-secondary'>图片处理和 Markdown 预览都在浏览器本地完成</p>
				</motion.div>

				<div className='card static grid gap-3 rounded-[28px] p-2 sm:grid-cols-2'>
					{tools.map(tool => (
						<button
							key={tool.id}
							onClick={() => setActiveTool(tool.id)}
							className={`rounded-[22px] px-4 py-3 text-left transition ${activeTool === tool.id ? 'bg-article shadow' : 'hover:bg-card'}`}>
							<span className='block text-sm font-semibold'>{tool.label}</span>
							<span className='text-secondary mt-1 block text-xs'>{tool.desc}</span>
						</button>
					))}
				</div>

				{activeTool === 'image' ? <ImageToolbox embedded /> : <MarkdownTool />}
			</div>
		</div>
	)
}
