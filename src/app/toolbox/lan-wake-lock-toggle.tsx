import { Sun } from 'lucide-react'
import type { LanScreenWakeLockState } from '@/hooks/use-lan-screen-wake-lock'

export function LanWakeLockToggle({ wakeLock }: { wakeLock: LanScreenWakeLockState }) {
	if (!wakeLock.ready || !wakeLock.supported) return null

	const status = !wakeLock.enabled ? '已关闭' : wakeLock.active ? '屏幕将保持常亮' : '屏幕常亮未启用'
	return (
		<div className='flex items-center gap-3 rounded-3xl border border-border bg-article p-4 shadow-sm'>
			<div className='bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-2xl'>
				<Sun size={19} />
			</div>
			<div className='min-w-0 flex-1'>
				<p className='text-sm font-semibold'>保持屏幕常亮</p>
				<p className='text-secondary mt-1 truncate text-xs'>{status}</p>
			</div>
			<button
				type='button'
				role='switch'
				aria-checked={wakeLock.enabled}
				aria-label='保持屏幕常亮'
				onClick={() => wakeLock.setEnabled(!wakeLock.enabled)}
				className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${wakeLock.enabled ? 'bg-brand' : 'bg-border'}`}
			>
				<span className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform ${wakeLock.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
			</button>
		</div>
	)
}
