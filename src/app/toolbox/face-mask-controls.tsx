'use client'

import { Download, Droplet, Plus, ScanFace, ShieldCheck, Smile, Trash2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { STICKERS } from '@/lib/face-mask/stickers'
import type { MaskItem, MaskMode } from '@/lib/face-mask/types'

type FaceMaskControlsProps = {
	masks: MaskItem[]
	selectedMask: MaskItem | null
	defaultMode: MaskMode
	defaultEmoji: string
	detecting: boolean
	creating: boolean
	zoom: number
	onModeChange: (mode: MaskMode) => void
	onStickerChange: (emoji: string) => void
	onCustomSticker: () => void
	onDetect: () => void
	onCreate: () => void
	onClear: () => void
	onExport: () => void
	onReplaceImage: () => void
	onZoomChange: (zoom: number) => void
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
	detecting,
	creating,
	zoom,
	onModeChange,
	onStickerChange,
	onCustomSticker,
	onDetect,
	onCreate,
	onClear,
	onExport,
	onReplaceImage,
	onZoomChange
}: FaceMaskControlsProps) {
	const shouldReduceMotion = useReducedMotion()
	const activeMode = selectedMask?.mode ?? defaultMode
	const activeEmoji = selectedMask?.emoji ?? defaultEmoji
	const selectedIndex = selectedMask ? masks.findIndex(mask => mask.id === selectedMask.id) + 1 : 0
	const buttonHover = shouldReduceMotion ? undefined : { y: -1 }
	const buttonTap = shouldReduceMotion ? undefined : { scale: 0.95 }

	return (
		<div className='space-y-4'>
			<div className='flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4'>
				<div className='flex flex-wrap gap-2 text-sm'>
					<motion.button type='button' onClick={onReplaceImage} whileHover={buttonHover} whileTap={buttonTap} className='flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-medium text-primary transition hover:border-brand/45'>
						<Upload size={15} />
						更换图片
					</motion.button>
					<motion.button
						type='button'
						onClick={onDetect}
						disabled={detecting}
						whileHover={detecting ? undefined : buttonHover}
						whileTap={detecting ? undefined : buttonTap}
						className='text-brand flex items-center gap-2 rounded-lg border border-rose-300/60 bg-rose-50/50 px-3 py-2 font-semibold transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-55'>
						<ScanFace size={15} className={detecting ? 'animate-pulse' : ''} />
						{detecting ? '检测中' : '自动检测'}
					</motion.button>
				</div>
			</div>

			<div className='grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center'>
				<div className='flex flex-wrap gap-2'>
					{modeOptions.map(({ mode, label, icon: Icon }) => (
						<motion.button type='button' key={mode} onClick={() => onModeChange(mode)} whileHover={buttonHover} whileTap={buttonTap} className={modeButtonClass(activeMode === mode)}>
							<Icon size={15} />
							{label}
						</motion.button>
					))}
				</div>

				<div className='flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-border bg-background/30 p-2'>
					<span className='text-secondary shrink-0 px-2 text-xs'>选择表情</span>
					{STICKERS.map(sticker => (
						<button
							key={sticker.id}
							onClick={() => onStickerChange(sticker.emoji)}
							title={sticker.label}
							className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xl transition active:scale-95 ${
								activeMode === 'emoji' && activeEmoji === sticker.emoji ? 'border-rose-400 bg-rose-50 shadow-sm' : 'border-border bg-card hover:border-brand/45'
							}`}>
							{sticker.emoji}
						</button>
					))}
					<button type='button' onClick={onCustomSticker} className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary transition hover:border-brand/45 active:scale-95'>
						<Plus size={17} />
					</button>
				</div>

				<div className='flex min-w-0 items-center justify-end gap-3 text-sm max-lg:justify-start'>
					<label htmlFor='face-mask-zoom' className='text-secondary shrink-0'>
						大小
					</label>
					<input
						id='face-mask-zoom'
						type='range'
						min='0.5'
						max='1.8'
						step='0.05'
						value={zoom}
						onChange={event => onZoomChange(Number(event.currentTarget.value))}
						className='h-11 w-36 cursor-pointer accent-rose-400 max-sm:w-32'
						aria-label='预览大小'
					/>
					<span className='w-14 text-right font-medium tabular-nums text-primary'>{zoom.toFixed(2)}x</span>
				</div>
			</div>

			<div className='rounded-2xl border border-rose-200/70 bg-rose-50/30 p-3'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<p className='font-semibold text-primary'>当前区域</p>
						<p className='text-secondary mt-1 text-xs'>区域 {selectedIndex || '-'} / {masks.length}</p>
					</div>
					<div className='flex flex-wrap gap-2'>
						<motion.button
							type='button'
							onClick={onCreate}
							aria-pressed={creating}
							whileHover={buttonHover}
							whileTap={buttonTap}
							className={`flex items-center gap-2 rounded-lg border px-4 py-2 font-medium transition ${
								creating ? 'border-rose-400 bg-rose-400 text-white' : 'border-border bg-background/50 text-primary hover:border-brand/45'
							}`}>
							<Plus size={15} />
							新增
						</motion.button>
						<motion.button
							type='button'
							onClick={onClear}
							disabled={!masks.length}
							whileHover={!masks.length ? undefined : buttonHover}
							whileTap={!masks.length ? undefined : buttonTap}
							className='flex items-center gap-2 rounded-lg border border-border bg-background/50 px-4 py-2 font-medium text-primary transition hover:border-rose-300 disabled:cursor-not-allowed disabled:text-secondary/45'>
							<Trash2 size={15} />
							清空
						</motion.button>
						<motion.button type='button' onClick={onExport} whileHover={buttonHover} whileTap={buttonTap} className='flex items-center gap-2 rounded-lg bg-rose-400 px-5 py-2 font-semibold text-white shadow-sm transition hover:bg-rose-500'>
							<Download size={15} />
							导出
						</motion.button>
					</div>
				</div>
			</div>
		</div>
	)
}
