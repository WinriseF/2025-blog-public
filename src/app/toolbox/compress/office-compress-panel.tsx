'use client'

import { useEffect, useRef, useState } from 'react'
import { Ban, Download, FileArchive, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { SelectMenu } from '@/components/select-menu'
import type { ImageCompressionPreset } from '@/lib/image-compress/types'
import { compressOffice, type OfficeProgress } from '@/lib/office-compress/pipeline'
import { officeFormat } from '@/lib/office-compress/package'
import { formatBytes } from './image-format'

type Result = { url: string; size: number }
const PRESETS = [{ value: 'smart', label: '智能推荐' }, { value: 'higher', label: '更高画质' }, { value: 'smaller', label: '更小体积' }] as const
const EMPTY_PROGRESS: OfficeProgress = { stage: '', progress: 0 }

export function OfficeCompressPanel() {
	const [file, setFile] = useState<File | null>(null)
	const [preset, setPreset] = useState<ImageCompressionPreset>('smart')
	const [progress, setProgress] = useState(EMPTY_PROGRESS)
	const [result, setResult] = useState<Result | null>(null)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [dragging, setDragging] = useState(false)
	const controller = useRef<AbortController | null>(null)
	const resultUrl = useRef<string | undefined>(undefined)
	const mounted = useRef(true)
	const outputName = file?.name.replace(/\.(pptx|docx|xlsx)$/i, '-compressed.$1') ?? ''
	const clearResult = () => {
		if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
		resultUrl.current = undefined
		setResult(null)
		setError('')
		setProgress(EMPTY_PROGRESS)
	}
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			controller.current?.abort()
			if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
		}
	}, [])
	const selectFiles = (files: FileList | File[]) => {
		if (controller.current || !files.length) return
		if (files.length > 1) { toast.error('请一次选择一个 Office 文档'); return }
		try { officeFormat(files[0].name) } catch (cause) { toast.error((cause as Error).message); return }
		clearResult()
		setFile(files[0])
	}
	const start = async () => {
		if (!file || controller.current) return
		const task = new AbortController()
		controller.current = task
		clearResult()
		setBusy(true)
		try {
			const blob = await compressOffice(file, { preset, signal: task.signal, onProgress: next => { if (mounted.current) setProgress(next) } })
			if (!mounted.current) return
			const url = URL.createObjectURL(blob)
			resultUrl.current = url
			setResult({ url, size: blob.size })
		} catch (cause) {
			if (mounted.current) {
				const canceled = task.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')
				setError(canceled ? '已取消，未保存压缩结果' : cause instanceof Error ? cause.message : '文档压缩失败')
			}
		} finally {
			controller.current = null
			if (mounted.current) setBusy(false)
		}
	}
	const savedPercent = file && result ? Math.round((1 - result.size / file.size) * 100) : 0
	const progressPercent = Math.round(progress.progress * 100)
	return (
		<div className='mx-auto flex max-w-5xl flex-col gap-6'>
			<label onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); selectFiles(event.dataTransfer.files) }} className={`flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-7 text-center transition ${busy ? 'cursor-wait opacity-60' : 'cursor-pointer'} ${dragging ? 'border-brand bg-brand/10' : 'border-brand/25 bg-background/25 hover:border-brand/45'}`}>
				<input type='file' accept='.pptx,.docx,.xlsx' disabled={busy} className='hidden' onChange={event => { if (event.target.files) selectFiles(event.target.files); event.currentTarget.value = '' }} />
				<div className='flex size-16 items-center justify-center rounded-full bg-brand/10 text-brand'><FileArchive size={30} /></div>
				<p className='font-semibold text-primary'>点击或拖拽 Office 文档</p>
				<p className='text-xs text-secondary'>PPTX · DOCX · XLSX</p>
			</label>
			<div className='flex flex-wrap items-end gap-4'>
				<div className='w-52'><p className='mb-2 font-medium text-primary'>图片压缩方案</p><SelectMenu value={preset} options={PRESETS} onChange={setPreset} disabled={busy} ariaLabel='Office 图片压缩方案' className='w-full' /></div>
				<button type='button' onClick={() => void start()} disabled={!file || busy} className='flex items-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-background disabled:opacity-45'><Play size={16} />开始压缩</button>
				{busy && <button type='button' onClick={() => controller.current?.abort()} className='flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-primary'><Ban size={16} />取消</button>}
				{file && !busy && <button type='button' onClick={() => { clearResult(); setFile(null) }} className='ml-auto flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-secondary'><Trash2 size={16} />清空</button>}
			</div>
			<p className='text-xs leading-6 text-secondary'>仅优化文档内嵌图片，使用与图片压缩相同的流程和压缩方案，保持原格式与分辨率，不修改文字、排版、公式和动画。其他文档内容原样保留。文件在本机处理，不上传服务器。</p>
			{file && <section className='rounded-2xl border border-border bg-background/25 p-5'>
				<div className={result ? 'grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start' : 'space-y-4'}>
					<div className='min-w-0 space-y-4'>
						<div className='flex min-w-0 items-center gap-3'><p title={file.name} className='min-w-0 truncate font-medium text-primary'>{file.name}</p>{result && <span className='shrink-0 rounded-full bg-brand/10 px-3 py-1 text-xs text-brand'>节省 {savedPercent}%</span>}</div>
						<p className='text-xs text-secondary'>{formatBytes(file.size)}{result && ` → ${formatBytes(result.size)}`}</p>
						{busy && <div aria-live='polite'>
							<div className='mb-3 flex justify-between gap-3 text-xs text-secondary'><span>{progress.stage || '准备压缩'}</span><span className='font-semibold tabular-nums text-primary'>{progressPercent}%</span></div>
							<div role='progressbar' aria-label='Office 压缩进度' aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} className='h-2 overflow-hidden rounded-full bg-border/60'>
								<div className='h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none' style={{ width: `${progressPercent}%` }} />
							</div>
						</div>}
						{error && <p role='alert' className='text-sm text-red-500'>{error}</p>}
					</div>
					{result && <a href={result.url} download={outputName} className='inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-medium text-background md:mt-1 md:self-start'><Download size={16} />下载压缩文档</a>}
				</div>
			</section>}
		</div>
	)
}
