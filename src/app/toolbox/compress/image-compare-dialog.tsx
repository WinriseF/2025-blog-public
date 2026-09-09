'use client'

import { useRef, useState } from 'react'
import { Maximize2, RotateCcw } from 'lucide-react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { DialogModal } from '@/components/dialog-modal'
import type { ImageCompressionItem } from './use-image-compress'
import { formatBytes } from './image-format'

export function ImageCompareDialog({ item, onClose }: { item: ImageCompressionItem; onClose: () => void }) {
	const [split, setSplit] = useState(50)
	const frameRef = useRef<HTMLDivElement>(null)
	const result = item.result
	if (!result) return null
	const aspectRatio = `${result.width} / ${result.height}`
	const frameWidth = `min(calc(100vw - 2rem), ${result.width}px, calc(${100 * result.width / result.height}dvh - ${10 * result.width / result.height}rem))`
	return (
		<DialogModal open={true} onClose={onClose} className='h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none overflow-hidden p-0'>
			<TransformWrapper minScale={0.5} maxScale={Math.max(8, result.width)} centerOnInit wheel={{ step: 0.02 }} doubleClick={{ mode: 'toggle' }}>
				{({ resetTransform, centerView }) => (
					<div className='flex h-full min-h-0 flex-col'>
						<div className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4'>
							<div>
								<p className='font-semibold text-primary'>同步像素对比</p>
								<p className='text-secondary mt-1 text-xs'>原图 {formatBytes(item.file.size)} · {result.format.toUpperCase()} {formatBytes(result.outputBytes)}</p>
							</div>
							<div className='flex gap-2'>
								<button type='button' onClick={() => { if (frameRef.current) centerView(result.width / frameRef.current.clientWidth) }} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-primary'><Maximize2 size={14} />1:1</button>
								<button type='button' onClick={() => resetTransform()} className='flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-primary'><RotateCcw size={14} />复位</button>
								<button type='button' onClick={onClose} className='rounded-lg border border-border px-3 py-2 text-xs text-primary'>关闭</button>
							</div>
						</div>
						<div className='relative min-h-0 flex-1 overflow-hidden bg-black/90'>
							<TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
								<div ref={frameRef} className='relative max-w-full shrink-0 overflow-hidden' style={{ aspectRatio, width: frameWidth }}>
									<img src={item.previewUrl} alt='原图' draggable={false} className='absolute inset-0 size-full select-none object-contain' />
									<div className='absolute inset-0 overflow-hidden' style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
										<img src={result.url} alt='压缩结果' draggable={false} className='absolute inset-0 size-full select-none object-contain' />
									</div>
									<div className='pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,.8)]' style={{ left: `${split}%` }} />
									<span className='absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs text-white'>原图</span>
									<span className='absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs text-white'>结果</span>
								</div>
							</TransformComponent>
						</div>
						<label className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-t border-border px-5 py-4 text-xs text-secondary'>
							<span>原图</span>
							<input type='range' min={0} max={100} value={split} onChange={event => setSplit(Number(event.target.value))} className='accent-[var(--color-brand)]' />
							<span>压缩结果</span>
						</label>
					</div>
				)}
			</TransformWrapper>
		</DialogModal>
	)
}
