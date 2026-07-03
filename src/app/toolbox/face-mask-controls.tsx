'use client'

import { Download, Droplet, Minus, Plus, ScanFace, ShieldCheck, Smile, Trash2, Undo2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { STICKERS } from '@/lib/face-mask/stickers'
import type { MaskItem, MaskMode } from '@/lib/face-mask/types'

type FaceMaskControlsProps = {
	masks: MaskItem[]
	selectedMask: MaskItem | null
	defaultMode: MaskMode
	defaultEmoji: string
	statusText: string
	detecting: boolean
	creating: boolean
	zoom: number
	canUndo: boolean
	onModeChange: (mode: MaskMode) => void
	onStickerChange: (emoji: string) => void
	onCustomSticker: () => void
	onDetect: () => void
	onCreate: () => void
	onClear: () => void
	onDeleteSelected: () => void
	onUndo: () => void
	onExport: () => void
	onReplaceImage: () => void
	onZoomIn: () => void
	onZoomOut: () => void
}

const modeOptions: Array<{ mode: MaskMode; label: string; icon: LucideIcon }> = [
	{ mode: 'mosaic', label: '马赛克', icon: ShieldCheck },
	{ mode: 'blur', label: '模糊', icon: Droplet },
	{ mode: 'emoji', label: '表情', icon: Smile }
]

function modeButtonClass(active: boolean) {
	return `flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition max-sm:flex-1 ${
		active ? 'border-rose-300 bg-rose-400 text-white shadow-[0_12px_24px_-18px_#fb7185]' : 'border-border bg-background/40 text-primary hover:border-brand/45'
	}`
}

export function FaceMaskControls({
	masks,
	selectedMask,
	defaultMode,
	defaultEmoji,
	statusText,
	detecting,
	creating,
	zoom,
	canUndo,
	onModeChange,
	onStickerChange,
	onCustomSticker,
	onDetect,
	onCreate,
	onClear,
	onDeleteSelected,
	onUndo,
	onExport,
	onReplaceImage,
	onZoomIn,
	onZoomOut
}: FaceMaskControlsProps) {
	const activeMode = selectedMask?.mode ?? defaultMode
	const activeEmoji = selectedMask?.emoji ?? defaultEmoji
	const selectedIndex = selectedMask ? masks.findIndex(mask => mask.id === selectedMask.id) + 1 : 0

	return (
		<div className='space-y-4'>
			<div className='flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4'>
				<div className='text-secondary flex items-center gap-2 text-sm'>
					<ShieldCheck size={16} className='text-rose-400' />
					<span>{statusText}</span>
				</div>
				<div className='flex flex-wrap gap-2 text-sm'>
					<button onClick={onReplaceImage} className='flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-medium text-primary transition hover:border-brand/45'>
						<Upload size={15} />
						更换图片
					</button>
					<button
						onClick={onDetect}
						disabled={detecting}
						className='text-brand flex items-center gap-2 rounded-lg border border-rose-300/60 bg-rose-50/50 px-3 py-2 font-semibold transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-55'>
						<ScanFace size={15} className={detecting ? 'animate-pulse' : ''} />
						{detecting ? '检测中' : '自动检测'}
					</button>
				</div>
			</div>

			<div className='grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center'>
				<div className='flex flex-wrap gap-2'>
					{modeOptions.map(({ mode, label, icon: Icon }) => (
						<button key={mode} onClick={() => onModeChange(mode)} className={modeButtonClass(activeMode === mode)}>
							<Icon size={15} />
							{label}
						</button>
					))}
				</div>

				<div className='flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-border bg-background/30 p-2'>
					<span className='text-secondary shrink-0 px-2 text-xs'>选择表情</span>
					{STICKERS.map(sticker => (
						<button
							key={sticker.id}
							onClick={() => onStickerChange(sticker.emoji)}
							title={sticker.label}
							className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xl transition ${
								activeMode === 'emoji' && activeEmoji === sticker.emoji ? 'border-rose-400 bg-rose-50 shadow-sm' : 'border-border bg-card hover:border-brand/45'
							}`}>
							{sticker.emoji}
						</button>
					))}
					<button onClick={onCustomSticker} className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary transition hover:border-brand/45'>
						<Plus size={17} />
					</button>
				</div>

				<div className='flex items-center justify-end gap-2 text-sm max-lg:justify-start'>
					<span className='text-secondary'>大小</span>
					<button onClick={onZoomOut} className='flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45'>
						<Minus size={15} />
					</button>
					<span className='w-12 text-center font-medium text-primary'>{Math.round(zoom * 100)}%</span>
					<button onClick={onZoomIn} className='flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45'>
						<Plus size={15} />
					</button>
				</div>
			</div>

			<div className='rounded-2xl border border-rose-200/70 bg-rose-50/30 p-3'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<p className='font-semibold text-primary'>当前区域</p>
						<p className='text-secondary mt-1 text-xs'>区域 {selectedIndex || '-'} / {masks.length}</p>
					</div>
					<div className='flex flex-wrap gap-2'>
						<button
							onClick={onCreate}
							className={`flex items-center gap-2 rounded-lg border px-4 py-2 font-medium transition ${
								creating ? 'border-rose-400 bg-rose-400 text-white' : 'border-border bg-background/50 text-primary hover:border-brand/45'
							}`}>
							<Plus size={15} />
							新增区域
						</button>
						<button
							onClick={onDeleteSelected}
							disabled={!selectedMask}
							className='flex items-center gap-2 rounded-lg border border-border bg-background/50 px-4 py-2 font-medium text-primary transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45'>
							<Trash2 size={15} />
							删除
						</button>
						<button
							onClick={onUndo}
							disabled={!canUndo}
							className='flex items-center gap-2 rounded-lg border border-border bg-background/50 px-4 py-2 font-medium text-primary transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45'>
							<Undo2 size={15} />
							撤销
						</button>
						<button
							onClick={onClear}
							disabled={!masks.length}
							className='flex items-center gap-2 rounded-lg border border-border bg-background/50 px-4 py-2 font-medium text-primary transition hover:border-rose-300 disabled:cursor-not-allowed disabled:text-secondary/45'>
							<Trash2 size={15} />
							清空区域
						</button>
						<button onClick={onExport} className='flex items-center gap-2 rounded-lg bg-rose-400 px-5 py-2 font-semibold text-white shadow-sm transition hover:bg-rose-500'>
							<Download size={15} />
							导出图片
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
