import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Ban, Copy, Download, Eye, LoaderCircle, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { downloadImage } from '@/lib/image-compress/image-archive'
import { copyImageToClipboard } from '@/lib/image-compress/image-clipboard'
import { outputFileName } from '@/lib/image-compress/presets'
import type { ImageClass, ImageJobStage } from '@/lib/image-compress/types'
import type { ImageCompressionItem } from './use-image-compress'
import { IMAGE_FORMAT_META } from '@/lib/image-compress/sniff'
import { formatBytes } from './image-format'

const STAGES: Record<ImageJobStage, string> = {
	validate: '验证格式',
	metadata: '检查元数据',
	decode: '解码图片',
	analyze: '分析内容',
	encode: '编码候选',
	evaluate: '质量检查'
}

const CLASSES: Record<ImageClass, string> = {
	photo: '照片',
	'ui-text': '界面/文字',
	'flat-illustration': '扁平插画',
	'transparent-icon': '透明图标',
	'transparent-complex': '复杂透明图',
	mixed: '混合内容'
}

async function copyResult(blob: Blob) {
	try {
		await copyImageToClipboard(blob)
		toast.success('已复制压缩后的图片')
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotAllowedError') toast.error('浏览器未允许访问剪贴板')
		else toast.error(error instanceof Error ? error.message : '复制图片失败')
	}
}

function EditableImageName({ name, editable, onCommit }: { name: string; editable: boolean; onCommit: (name: string) => void }) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(name)
	const inputRef = useRef<HTMLInputElement>(null)
	const start = () => {
		if (!editable) return
		setDraft(name)
		setEditing(true)
	}
	useEffect(() => {
		if (!editing || !inputRef.current) return
		const extensionAt = name.lastIndexOf('.')
		inputRef.current.focus()
		inputRef.current.setSelectionRange(0, extensionAt > 0 ? extensionAt : name.length)
	}, [editing, name])
	if (editing) return <input ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { onCommit(draft); setEditing(false) }} onKeyDown={event => {
		if (event.key === 'Enter') event.currentTarget.blur()
		if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
	}} aria-label='下载文件名' className='min-w-0 flex-1 rounded-md border border-brand/45 bg-background px-2 py-1 font-medium text-primary outline-none focus:ring-2 focus:ring-brand/20' />
	return <p className={`min-w-0 truncate font-medium text-primary ${editable ? 'cursor-text rounded-sm outline-none focus:ring-2 focus:ring-brand/20' : ''}`} title={editable ? `${name}（双击修改下载文件名）` : name} tabIndex={editable ? 0 : undefined} role={editable ? 'button' : undefined} onDoubleClick={start} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'F2') start() }}>{name}</p>
}

export function ImageResultList({ items, onStart, onCancel, onRemove, onCompare, onRename }: {
	items: ImageCompressionItem[]
	onStart: (id: string) => void
	onCancel: (id: string) => void
	onRemove: (id: string) => void
	onCompare: (id: string) => void
	onRename: (id: string, name: string) => void
}) {
	if (!items.length) return <div className='text-secondary flex min-h-36 items-center justify-center border-t border-border text-sm'>选择图片后将在这里显示任务与压缩结果</div>
	return (
		<section className='border-t border-border pt-5'>
			<h2 className='mb-2 font-semibold text-primary'>图片任务（{items.length}）</h2>
			<ul className='divide-y divide-border'>
				{items.map(item => {
					const active = item.status === 'queued' || item.status === 'processing'
					const saving = item.result && item.file.size ? Math.round((1 - item.result.outputBytes / item.file.size) * 100) : null
					const displayName = item.result ? item.outputName || outputFileName(item.file.name, item.result.format) : item.file.name
					return (
						<li key={item.id} className='grid grid-cols-[58px_minmax(0,1fr)_auto] gap-4 py-4 max-sm:grid-cols-[52px_minmax(0,1fr)]' style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' } as CSSProperties}>
							<div className='size-14 overflow-hidden rounded-lg border border-border bg-card max-sm:size-12'>{item.format === 'jxl' ? <span className='flex size-full items-center justify-center text-[10px] font-semibold text-secondary'>JXL</span> : <img src={item.previewUrl} alt='' loading='lazy' className='size-full object-cover' />}</div>
							<div className='min-w-0'>
								<div className='flex min-w-0 items-center gap-2'>
									<EditableImageName name={displayName} editable={Boolean(item.result)} onCommit={name => onRename(item.id, name)} />
									{saving !== null && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${saving >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{saving >= 0 ? `节省 ${saving}%` : `增大 ${Math.abs(saving)}%`}</span>}
								</div>
								<p className='text-secondary mt-1 text-xs'>{IMAGE_FORMAT_META[item.format].label} · {item.width && item.height ? `${item.width} × ${item.height} · ` : ''}{formatBytes(item.file.size)}</p>
								{active && <div className='mt-2 max-w-xl'><div className='flex justify-between text-xs text-secondary'><span>{item.status === 'queued' ? '等待处理' : item.stage ? STAGES[item.stage] : '处理中'}</span><span>{Math.round(item.progress * 100)}%</span></div><div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70'><span className='bg-brand block h-full transition-[width]' style={{ width: `${Math.round(item.progress * 100)}%` }} /></div></div>}
								{item.result && <div className='mt-2 flex flex-wrap items-center gap-2 text-xs'><span className='text-primary'>{item.result.format.toUpperCase()} · {formatBytes(item.result.outputBytes)}</span><span className='text-secondary'>{CLASSES[item.result.classification]} · {item.result.encoder}</span>{item.result.metrics && <span className='text-secondary'>SSIM {item.result.metrics.ssim.toFixed(4)}</span>}</div>}
								{item.result?.warnings.length ? <p className='mt-2 truncate text-xs text-amber-700 dark:text-amber-300' title={item.result.warnings.join('\n')}>{item.result.warnings[0]}{item.result.warnings.length > 1 ? `（另有 ${item.result.warnings.length - 1} 项提示）` : ''}</p> : null}
								{item.error && <p className='mt-2 text-xs text-rose-700 dark:text-rose-300'>{item.error}</p>}
							</div>
							<div className='flex flex-wrap items-center justify-end gap-2 text-xs max-sm:col-span-2 max-sm:justify-start'>
								{active ? <button type='button' onClick={() => onCancel(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary'><Ban size={13} />取消</button> : <button type='button' onClick={() => onStart(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary'><Play size={13} />{item.result ? '重压' : '压缩'}</button>}
								<button type='button' disabled={!item.result} onClick={() => onCompare(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary disabled:opacity-40'><Eye size={13} />对比</button>
								<button type='button' disabled={!item.result} onClick={() => { if (item.result) void copyResult(item.result.blob) }} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary disabled:opacity-40'><Copy size={13} />复制</button>
								<button type='button' disabled={!item.result} onClick={() => item.result && downloadImage({ sourceName: item.file.name, outputName: item.outputName, format: item.result.format, blob: item.result.blob, lastModified: item.file.lastModified })} className='text-brand flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-medium disabled:text-secondary disabled:opacity-40'><Download size={13} />下载</button>
								<button type='button' onClick={() => onRemove(item.id)} className='text-secondary flex items-center rounded-lg border border-border p-2 hover:text-primary' aria-label={`移除 ${item.file.name}`}>{active ? <LoaderCircle size={14} className='animate-spin' /> : <Trash2 size={14} />}</button>
							</div>
						</li>
					)
				})}
			</ul>
		</section>
	)
}
