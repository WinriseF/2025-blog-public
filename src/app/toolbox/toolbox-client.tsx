'use client'

import dynamic from 'next/dynamic'
import { useDeferredValue, useState, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { INIT_DELAY } from '@/consts'
import { readFileAsText } from '@/lib/file-utils'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import { ImageToolbox } from '../image-toolbox/image-toolbox'

type ToolId = 'image' | 'markdown' | 'transfer'

const tools: Array<{ id: ToolId; label: string; desc: string }> = [
	{ id: 'image', label: '图片压缩', desc: 'PNG / JPG 转 WEBP' },
	{ id: 'markdown', label: 'Markdown 查看器', desc: '本地预览 .md 文件' },
	{ id: 'transfer', label: '消息中转站', desc: '密码加密 + 阅后即焚' }
]

const defaultMarkdown = '# Markdown 查看器\n\n把 Markdown 文件拖进来，或直接在左侧编辑。'
const markdownRenderOptions = { worker: false } as const
const TransferTool = dynamic(() => import('./transfer-tool').then(mod => mod.TransferTool), {
	ssr: false,
	loading: () => <div className='text-secondary rounded-2xl border border-border bg-article px-4 py-3 text-sm'>中转站加载中...</div>
})

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
	const deferredMarkdown = useDeferredValue(markdown)
	const { content, loading } = useMarkdownRender(deferredMarkdown, markdownRenderOptions)

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
			<section className='flex min-h-[640px] flex-col max-sm:min-h-0'>
				<div className='flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3'>
					<div>
						<p className='text-secondary text-xs tracking-[0.18em] uppercase'>{fileName}</p>
						<h2 className='mt-1 text-lg font-semibold'>Markdown</h2>
					</div>
					<div className='flex flex-wrap gap-2 text-xs'>
						<button className='rounded-full border border-border px-3 py-1.5 font-medium' onClick={() => navigator.clipboard.writeText(markdown)}>
							复制
						</button>
						<button className='rounded-full border border-border px-3 py-1.5 font-medium' onClick={() => downloadText(fileName || 'preview.md', markdown)}>
							下载
						</button>
						<button className='rounded-full border border-rose-300/50 px-3 py-1.5 font-medium text-rose-400' onClick={() => setMarkdown('')}>
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
					className='mt-4 min-h-[480px] flex-1 resize-none rounded-2xl border border-border bg-article p-4 font-mono text-sm leading-6 text-primary max-sm:min-h-[320px]'
					spellCheck={false}
				/>
			</section>

			<section className='min-h-[640px] overflow-auto max-sm:min-h-[360px]'>
				<div className='text-secondary border-b border-border pb-3 text-xs tracking-[0.18em] uppercase'>Preview</div>
				<div className='prose mt-5 max-w-none cursor-text'>{loading ? <div className='text-secondary text-sm'>渲染中...</div> : content}</div>
			</section>
		</div>
	)
}

type ToolboxClientProps = {
	initialTool?: ToolId
	initialCode?: string
}

export function ToolboxClient({ initialTool = 'image', initialCode }: ToolboxClientProps) {
	const [activeTool, setActiveTool] = useState<ToolId>(initialTool)

	return (
		<div className='mx-auto flex max-w-[1140px] justify-center gap-6 px-6 pt-28 pb-12 text-sm max-sm:px-0'>
			<motion.article
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: INIT_DELAY }}
				className='card bg-article static flex-1 overflow-auto rounded-xl p-8'>
				<motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: INIT_DELAY }} className='space-y-2 text-center'>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Toolbox</p>
					<h1 className='text-2xl font-semibold'>客户端工具箱</h1>
					<p className='text-secondary'>本地处理常用内容，也支持加密的站内消息中转</p>
				</motion.div>

				<div className='mt-6 grid grid-cols-3 gap-3 border-b border-border pb-5 max-sm:grid-cols-1'>
					{tools.map(tool => (
						<button
							key={tool.id}
							onClick={() => setActiveTool(tool.id)}
							className={`rounded-xl px-3 py-2 text-left transition ${activeTool === tool.id ? 'bg-brand/10 text-primary' : 'text-secondary hover:bg-brand/5'}`}>
							<span className='block text-sm font-semibold'>{tool.label}</span>
							<span className='text-secondary mt-1 block text-xs'>{tool.desc}</span>
						</button>
					))}
				</div>

				{activeTool === 'image' && <ImageToolbox embedded />}
				{activeTool === 'markdown' && <MarkdownTool />}
				{activeTool === 'transfer' && <TransferTool initialCode={initialCode} />}
			</motion.article>
		</div>
	)
}
