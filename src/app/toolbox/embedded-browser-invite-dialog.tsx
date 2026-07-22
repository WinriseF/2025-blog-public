'use client'

import { Copy, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'
import { DialogModal } from '@/components/dialog-modal'

type EmbeddedBrowserInviteDialogProps = {
	browser: '微信' | 'QQ'
	url: string
	onClose: () => void
}

export function EmbeddedBrowserInviteDialog({ browser, url, onClose }: EmbeddedBrowserInviteDialogProps) {
	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(url)
			toast.success('邀请链接已复制')
		} catch {
			toast.error('复制失败，请长按链接手动复制')
		}
	}

	return (
		<DialogModal open onClose={onClose}>
			<section role='dialog' aria-modal='true' aria-labelledby='embedded-browser-title' className='w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-border bg-article p-5 text-primary shadow-2xl sm:p-6'>
				<ExternalLink className='text-brand' size={24} />
				<h2 id='embedded-browser-title' className='mt-4 text-lg font-semibold'>当前正在使用{browser}打开，传输文件可能受限</h2>
				<p className='text-secondary mt-2 text-sm leading-6'>建议复制下面的链接，然后打开浏览器粘贴访问。</p>
				<div className='text-secondary mt-4 max-h-28 overflow-y-auto rounded-xl border border-border bg-background/35 p-3 text-xs leading-5 break-all select-text'>{url}</div>
				<div className='mt-5 grid grid-cols-2 gap-2.5'>
					<button type='button' onClick={() => void copyLink()} className='bg-brand text-background flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold'>
						<Copy size={16} />复制链接
					</button>
					<button type='button' onClick={onClose} className='text-secondary flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background/35 px-4 text-sm font-medium'>
						<X size={16} />关闭
					</button>
				</div>
			</section>
		</DialogModal>
	)
}
