'use client'

import { Download, Loader2 } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanProgressState, ReceivedLanFile } from '@/lib/lan-transfer/types'

type LanTransferStatusProps = {
	busy: boolean
	status: string
	outgoing: LanProgressState | null
	incoming: LanProgressState | null
	receivedFiles: ReceivedLanFile[]
}

function progressPercent(progress: LanProgressState | null) {
	if (!progress?.size) return 0
	return Math.min(100, Math.round((progress.done / progress.size) * 100))
}

export function LanTransferStatus({ busy, status, outgoing, incoming, receivedFiles }: LanTransferStatusProps) {
	const progressItems = [outgoing, incoming].filter((item): item is LanProgressState => Boolean(item))

	return (
		<aside className='space-y-4 rounded-2xl border border-border bg-background/30 p-5 max-sm:border-0 max-sm:bg-transparent max-sm:p-0 xl:sticky xl:top-24'>
			<div>
				<div className='flex items-center justify-between gap-3'>
					<div>
						<p className='text-secondary text-xs tracking-[0.18em] uppercase'>P2P</p>
						<h3 className='mt-1 text-base font-semibold'>传输状态</h3>
					</div>
					{busy && <Loader2 className='text-secondary shrink-0 animate-spin' size={16} />}
				</div>
				<p className='text-secondary mt-3 text-sm leading-6'>{status || '等待连接或文件操作。'}</p>
			</div>

			{progressItems.map(item => (
				<div key={item.id} className='rounded-2xl border border-border bg-article p-4 max-sm:p-4'>
					<div className='flex justify-between gap-3 text-sm'>
						<span className='truncate font-medium'>{item.name}</span>
						<span className='text-secondary shrink-0'>{progressPercent(item)}%</span>
					</div>
					<div className='mt-3 h-2 overflow-hidden rounded-full bg-background'>
						<div className='h-full rounded-full bg-brand transition-all' style={{ width: `${progressPercent(item)}%` }} />
					</div>
					<p className='text-secondary mt-2 text-xs'>
						{item.label} · {formatBytes(item.done)} / {formatBytes(item.size)}
					</p>
				</div>
			))}

			{receivedFiles.length > 0 && (
				<div className='space-y-2'>
					<p className='text-secondary text-xs'>已收到</p>
					{receivedFiles.map(file => (
						<a key={file.id} href={file.url} download={file.name} className='flex items-center justify-between gap-3 rounded-2xl border border-border bg-article px-4 py-3 text-sm'>
							<span className='truncate'>{file.name}</span>
							<span className='text-secondary flex shrink-0 items-center gap-1 text-xs'>
								<Download size={14} />
								{formatBytes(file.size)}
							</span>
						</a>
					))}
				</div>
			)}
		</aside>
	)
}
