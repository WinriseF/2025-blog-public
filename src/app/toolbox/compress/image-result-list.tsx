import type { CSSProperties } from 'react'
import { Ban, Download, Eye, LoaderCircle, Play, Trash2 } from 'lucide-react'
import { downloadImage } from '@/lib/image-compress/image-archive'
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

export function ImageResultList({ items, onStart, onCancel, onRemove, onCompare }: {
	items: ImageCompressionItem[]
	onStart: (id: string) => void
	onCancel: (id: string) => void
	onRemove: (id: string) => void
	onCompare: (id: string) => void
}) {
	if (!items.length) return <div className='text-secondary flex min-h-36 items-center justify-center border-t border-border text-sm'>选择图片后将在这里显示任务与压缩结果</div>
	return (
		<section className='border-t border-border pt-5'>
			<h2 className='mb-2 font-semibold text-primary'>图片任务（{items.length}）</h2>
			<ul className='divide-y divide-border'>
				{items.map(item => {
					const active = item.status === 'queued' || item.status === 'processing'
					const saving = item.result && item.file.size ? Math.round((1 - item.result.outputBytes / item.file.size) * 100) : null
					return (
						<li key={item.id} className='grid grid-cols-[58px_minmax(0,1fr)_auto] gap-4 py-4 max-sm:grid-cols-[52px_minmax(0,1fr)]' style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' } as CSSProperties}>
							<div className='size-14 overflow-hidden rounded-lg border border-border bg-card max-sm:size-12'><img src={item.previewUrl} alt='' loading='lazy' className='size-full object-cover' /></div>
							<div className='min-w-0'>
								<p className='truncate font-medium text-primary' title={item.file.name}>{item.file.name}</p>
								<p className='text-secondary mt-1 text-xs'>{IMAGE_FORMAT_META[item.format].label} · {item.width && item.height ? `${item.width} × ${item.height} · ` : ''}{formatBytes(item.file.size)}</p>
								{active && <div className='mt-2 max-w-xl'><div className='flex justify-between text-xs text-secondary'><span>{item.status === 'queued' ? '等待处理' : item.stage ? STAGES[item.stage] : '处理中'}</span><span>{Math.round(item.progress * 100)}%</span></div><div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70'><span className='bg-brand block h-full transition-[width]' style={{ width: `${Math.round(item.progress * 100)}%` }} /></div></div>}
								{item.result && <div className='mt-2 flex flex-wrap items-center gap-2 text-xs'><span className='text-primary'>{item.result.format.toUpperCase()} · {formatBytes(item.result.outputBytes)}</span><span className='text-secondary'>{CLASSES[item.result.classification]} · {item.result.encoder}</span>{item.result.metrics && <span className='text-secondary'>SSIM {item.result.metrics.ssim.toFixed(4)}</span>}{saving !== null && <span className={`rounded-full px-2 py-0.5 font-medium ${saving >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{saving >= 0 ? `节省 ${saving}%` : `增大 ${Math.abs(saving)}%`}</span>}</div>}
								{item.result?.warnings.length ? <p className='mt-2 truncate text-xs text-amber-700 dark:text-amber-300' title={item.result.warnings.join('\n')}>{item.result.warnings[0]}{item.result.warnings.length > 1 ? `（另有 ${item.result.warnings.length - 1} 项提示）` : ''}</p> : null}
								{item.error && <p className='mt-2 text-xs text-rose-700 dark:text-rose-300'>{item.error}</p>}
							</div>
							<div className='flex items-center justify-end gap-2 text-xs max-sm:col-span-2 max-sm:justify-start'>
								{active ? <button type='button' onClick={() => onCancel(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary'><Ban size={13} />取消</button> : <button type='button' onClick={() => onStart(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary'><Play size={13} />{item.result ? '重压' : '压缩'}</button>}
								<button type='button' disabled={!item.result} onClick={() => onCompare(item.id)} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-primary disabled:opacity-40'><Eye size={13} />对比</button>
								<button type='button' disabled={!item.result} onClick={() => item.result && downloadImage({ sourceName: item.file.name, format: item.result.format, blob: item.result.blob, lastModified: item.file.lastModified })} className='text-brand flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-medium disabled:text-secondary disabled:opacity-40'><Download size={13} />下载</button>
								<button type='button' onClick={() => onRemove(item.id)} className='text-secondary flex items-center rounded-lg border border-border p-2 hover:text-primary' aria-label={`移除 ${item.file.name}`}>{active ? <LoaderCircle size={14} className='animate-spin' /> : <Trash2 size={14} />}</button>
							</div>
						</li>
					)
				})}
			</ul>
		</section>
	)
}
