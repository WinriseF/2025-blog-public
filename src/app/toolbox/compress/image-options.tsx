import { SelectMenu, type SelectMenuOption } from '@/components/select-menu'
import type { ImageCompressionOptions, ImageCompressionPreset, ImageOutputMode } from '@/lib/image-compress/types'

const PRESETS: Array<{ id: ImageCompressionPreset; label: string; description: string }> = [
	{ id: 'smart', label: '智能推荐', description: '优先缩小体积，允许轻微画质损失。' },
	{ id: 'smaller', label: '更小体积', description: '接受轻微质量下降，使用更积极的量化和编码策略。' },
	{ id: 'higher', label: '更高画质', description: '提高质量门槛，UI、文字和透明边缘优先保真。' }
]

const OUTPUTS: readonly SelectMenuOption<ImageOutputMode>[] = [
	{ value: 'keep', label: '保持原格式' },
	{ value: 'auto', label: '自动选择' },
	{ value: 'jpeg', label: 'JPEG' },
	{ value: 'png', label: 'PNG' },
	{ value: 'webp', label: 'WebP' },
	{ value: 'avif', label: 'AVIF' }
]

const COMPATIBILITY: readonly SelectMenuOption<ImageCompressionOptions['compatibility']>[] = [
	{ value: 'compatible', label: '优先兼容与速度' },
	{ value: 'smallest', label: '优先最小体积' }
]

export function ImageOptions({ value, disabled, onChange }: {
	value: ImageCompressionOptions
	disabled: boolean
	onChange: (next: ImageCompressionOptions) => void
}) {
	const update = (patch: Partial<ImageCompressionOptions>) => onChange({ ...value, ...patch })
	return (
		<section className='space-y-6'>
			<div>
				<h2 className='text-sm font-semibold text-primary'>压缩方案</h2>
				<div className='mt-3 grid gap-3 md:grid-cols-3'>
					{PRESETS.map(option => (
						<button
							key={option.id}
							type='button'
							disabled={disabled}
							onClick={() => update({ preset: option.id })}
							className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${value.preset === option.id ? 'border-brand bg-brand/8 shadow-sm' : 'border-border bg-background/25 hover:border-brand/35'}`}>
							<p className='font-semibold text-primary'>{option.label}</p>
							<p className='text-secondary mt-2 text-xs leading-5'>{option.description}</p>
						</button>
					))}
				</div>
			</div>

			<div className={`grid gap-4 rounded-xl border border-border bg-background/20 p-4 md:grid-cols-2 ${value.output === 'auto' ? 'lg:grid-cols-3' : ''}`}>
				<div>
					<p className='text-sm font-medium text-primary'>输出格式</p>
					<SelectMenu value={value.output} options={OUTPUTS} disabled={disabled} onChange={output => update({ output })} ariaLabel='选择图片输出格式' className='mt-2 w-full' />
				</div>
				{value.output === 'auto' && (
					<div>
						<p className='text-sm font-medium text-primary'>自动策略</p>
						<SelectMenu value={value.compatibility} options={COMPATIBILITY} disabled={disabled} onChange={compatibility => update({ compatibility })} ariaLabel='选择自动格式策略' className='mt-2 w-full' />
					</div>
				)}

				{value.output === 'jpeg' ? (
					<label className='text-sm text-primary'>
						<span className='font-medium'>透明背景填充</span>
						<div className='mt-2 flex h-10 items-center gap-3 rounded-lg border border-border bg-card px-3'>
							<input type='color' value={value.jpegBackground} disabled={disabled} onChange={event => update({ jpegBackground: event.target.value })} className='size-6 cursor-pointer border-0 bg-transparent p-0' />
							<span className='font-mono text-xs text-secondary'>{value.jpegBackground}</span>
						</div>
					</label>
				) : (
					<label className='flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card/60 p-3 text-sm'>
						<input type='checkbox' checked={value.stripMetadata} disabled={disabled} onChange={event => update({ stripMetadata: event.target.checked })} className='mt-0.5 size-4 accent-[var(--color-brand)]' />
						<span><span className='font-medium text-primary'>移除拍摄信息</span><span className='mt-1 block text-xs leading-5 text-secondary'>移除拍摄时间、设备和定位等信息，处理后的文件可能略大。</span></span>
					</label>
				)}
			</div>
		</section>
	)
}
