'use client'

import { useState } from 'react'
import { Archive, CircleAlert, LoaderCircle, X } from 'lucide-react'
import { useVersionControlStore } from '@/lib/version-control/store'
import type { ExportFormat, ExportLayout } from '@/lib/version-control/types'

const formats: Array<{ value: ExportFormat; label: string }> = [
	{ value: 'markdown', label: 'Markdown' },
	{ value: 'json', label: 'JSON' },
	{ value: 'xml', label: 'XML' },
	{ value: 'txt', label: 'TXT' }
]
const layouts: Array<{ value: ExportLayout; label: string; desc: string }> = [
	{ value: 'split', label: 'Split', desc: '原始与修改内容分栏结构' },
	{ value: 'unified', label: 'Unified', desc: '统一上下文差异' },
	{ value: 'git-patch', label: 'GitPatch', desc: 'libgit2 原生 patch 语义' }
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
	const [format, setFormat] = useState<ExportFormat>('markdown')
	const [layout, setLayout] = useState<ExportLayout>('unified')
	const [pending, setPending] = useState<{ id: string; inside: boolean } | null>(null)
	const [running, setRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const selected = useVersionControlStore(state => state.selectedFileIds.size)
	const prepare = useVersionControlStore(state => state.prepareExport)
	const confirm = useVersionControlStore(state => state.confirmExport)
	const cancel = useVersionControlStore(state => state.cancelExport)
	const event = useVersionControlStore(state => state.exportEvent)

	const start = async () => {
		setError(null)
		try {
			const target = await prepare(format, layout)
			if (target.cancelled || !target.exportTargetId) return
			if (target.insideRepository) return setPending({ id: target.exportTargetId, inside: true })
			setRunning(true)
			await confirm(target.exportTargetId, false)
			setPending({ id: target.exportTargetId, inside: false })
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		}
	}

	const approve = async () => {
		if (!pending) return
		setRunning(true)
		try {
			await confirm(pending.id, true)
		} catch (cause) {
			setRunning(false)
			setError(cause instanceof Error ? cause.message : String(cause))
		}
	}

	const close = async () => {
		if (pending && (!event || event.exportTargetId !== pending.id)) await cancel(pending.id)
		onClose()
	}

	const complete = pending && event?.exportTargetId === pending.id ? event : null

	return (
		<div
			className='fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm'
			onMouseDown={event => event.target === event.currentTarget && void close()}>
			<div className='border-border bg-article w-full max-w-lg rounded-xl border p-6 shadow-2xl'>
				<header className='flex items-center'>
					<div className='bg-brand/10 text-brand flex size-9 items-center justify-center rounded-md'>
						<Archive size={17} />
					</div>
					<div className='ml-3'>
						<h3 className='font-semibold'>完整导出</h3>
						<p className='text-secondary text-xs'>{selected} 个文件由 Agent 流式生成</p>
					</div>
					<button onClick={() => void close()} className='text-secondary hover:text-primary ml-auto'>
						<X size={18} />
					</button>
				</header>
				{complete ? (
					<div
						className={`mt-6 rounded-lg border p-5 ${complete.type === 'export-complete' ? 'border-emerald-400/30 bg-emerald-400/7 text-emerald-300' : complete.type === 'export-cancelled' ? 'border-border text-secondary' : 'border-red-400/30 bg-red-400/7 text-red-300'}`}>
						{complete.type === 'export-complete' ? '导出已完成。' : complete.type === 'export-cancelled' ? '导出已取消。' : complete.error}
					</div>
				) : pending?.inside && !running ? (
					<div className='mt-6'>
						<div className='rounded-lg border border-amber-300/30 bg-amber-300/7 p-4 text-sm text-amber-200'>
							<CircleAlert className='mb-3' size={19} />
							目标位于当前仓库内。继续后，导出文件会立即成为一项工作区变更。
						</div>
						<div className='mt-5 flex justify-end gap-2'>
							<button onClick={() => void cancel(pending.id).then(onClose)} className='border-border rounded-md border px-4 py-2 text-xs'>
								取消
							</button>
							<button onClick={() => void approve()} className='bg-amber-300 px-4 py-2 text-xs font-semibold text-black'>
								确认写入仓库
							</button>
						</div>
					</div>
				) : running ? (
					<div className='text-secondary flex h-44 flex-col items-center justify-center'>
						<LoaderCircle className='text-brand animate-spin' />
						<p className='mt-4 text-sm'>正在原子生成导出文件…</p>
						<button onClick={() => void close()} className='mt-4 text-xs underline'>
							取消导出
						</button>
					</div>
				) : (
					<>
						<div className='mt-6'>
							<p className='text-secondary mb-2 text-[10px] tracking-wider uppercase'>格式</p>
							<div className='grid grid-cols-4 gap-2'>
								{formats.map(item => (
									<button
										key={item.value}
										onClick={() => setFormat(item.value)}
										className={`rounded-md border px-2 py-2 text-xs ${format === item.value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-secondary'}`}>
										{item.label}
									</button>
								))}
							</div>
						</div>
						<div className='mt-5'>
							<p className='text-secondary mb-2 text-[10px] tracking-wider uppercase'>布局</p>
							<div className='space-y-2'>
								{layouts.map(item => (
									<button
										key={item.value}
										onClick={() => setLayout(item.value)}
										className={`flex w-full items-center rounded-md border p-3 text-left ${layout === item.value ? 'border-brand bg-brand/7' : 'border-border'}`}>
										<span className='text-xs font-medium'>{item.label}</span>
										<span className='text-secondary ml-auto text-[11px]'>{item.desc}</span>
									</button>
								))}
							</div>
						</div>
						{error && <p className='mt-4 text-xs text-red-300'>{error}</p>}
						<button onClick={() => void start()} className='bg-brand text-background mt-6 w-full rounded-md py-3 text-sm font-semibold'>
							打开系统保存框
						</button>
					</>
				)}
			</div>
		</div>
	)
}
