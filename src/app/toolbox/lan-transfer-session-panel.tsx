'use client'

import type { ChangeEvent } from 'react'
import { Copy, QrCode, Send, UploadCloud, Wifi, X } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import { LAN_LIMITS } from '@/lib/lan-transfer/types'
import { capabilityLabel, totalSelectedSize } from './lan-transfer-controller-utils'
import type { LanTransferController } from './use-lan-transfer-controller'

type LanTransferSessionPanelProps = Pick<
	LanTransferController,
	| 'session'
	| 'remotePeer'
	| 'connected'
	| 'qrDataUrl'
	| 'selectedFiles'
	| 'incomingRequest'
	| 'localCapability'
	| 'remoteCapability'
	| 'busy'
	| 'transferBusy'
	| 'setSelectedFiles'
	| 'handleCreateRoom'
	| 'handleSendFiles'
	| 'acceptIncoming'
	| 'rejectIncoming'
	| 'copyInvite'
	| 'leaveSession'
>

export function LanTransferSessionPanel({
	session,
	remotePeer,
	connected,
	qrDataUrl,
	selectedFiles,
	incomingRequest,
	localCapability,
	remoteCapability,
	busy,
	transferBusy,
	setSelectedFiles,
	handleCreateRoom,
	handleSendFiles,
	acceptIncoming,
	rejectIncoming,
	copyInvite,
	leaveSession
}: LanTransferSessionPanelProps) {
	return (
		<section className='space-y-4'>
			<div className='rounded-2xl border border-brand/20 bg-brand/5 p-5 max-sm:p-4'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div className='min-w-0'>
						<p className='text-secondary text-xs tracking-[0.18em] uppercase'>LAN SESSION V3</p>
						<h2 className='mt-1 text-lg font-semibold'>局域网互传</h2>
					</div>
					<div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-background/60 text-secondary'}`}>
						{connected ? '已直连' : session ? '连接中' : '未连接'}
					</div>
				</div>
				<p className='text-secondary mt-3 text-sm leading-6 max-sm:text-xs'>扫码配对后，单文件将使用流式读取 + OPFS/IndexedDB 分块接收；无服务端硬性大小限制，实际能力取决于接收设备。</p>
			</div>

			{!session ? (
				<div className='grid gap-3 sm:grid-cols-2'>
					<button onClick={() => void handleCreateRoom()} disabled={busy} className='min-h-[150px] rounded-2xl border border-border bg-article p-5 text-left transition hover:border-brand/50 disabled:opacity-50'>
						<QrCode className='mb-4 text-brand' size={28} />
						<span className='block text-base font-semibold'>创建连接二维码</span>
						<span className='text-secondary mt-2 block text-sm leading-6'>让另一台设备扫码，建立双向互传会话。</span>
					</button>
					<div className='min-h-[150px] rounded-2xl border border-dashed border-border bg-background/30 p-5 text-left'>
						<Wifi className='mb-4 text-secondary' size={28} />
						<span className='block text-base font-semibold'>10GB+ 增强模式</span>
						<span className='text-secondary mt-2 block text-sm leading-6'>Chrome / Edge 支持 OPFS 时会自动启用；iOS 和内置浏览器会自动降级。</span>
					</div>
				</div>
			) : (
				<div className='space-y-4'>
					<div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]'>
						<div className='rounded-2xl border border-border bg-article p-5 max-sm:p-4'>
							<div className='flex items-start justify-between gap-3'>
								<div className='min-w-0'>
									<p className='text-secondary text-xs'>对方设备</p>
									<p className='mt-1 truncate text-base font-semibold'>{remotePeer?.name || '等待另一台设备'}</p>
									<p className='text-secondary mt-3 text-sm'>{connected ? '点对点通道已打开。' : '等待信令和 WebRTC 建连。'}</p>
									<p className='text-secondary mt-2 text-xs'>对方能力：{capabilityLabel(remoteCapability)}</p>
									<p className='text-secondary mt-1 text-xs'>本机能力：{capabilityLabel(localCapability)}</p>
								</div>
								<button onClick={leaveSession} className='flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-secondary'>
									<X size={14} />
									离开
								</button>
							</div>
						</div>
						{session.role === 'host' && (
							<div className='rounded-2xl border border-border bg-white p-3 text-center shadow-sm'>
								{qrDataUrl ? <img src={qrDataUrl} alt='局域网互传连接二维码' className='mx-auto size-[180px]' /> : <div className='text-secondary flex h-[180px] items-center justify-center text-xs'>生成二维码中</div>}
								<button onClick={() => void copyInvite()} className='mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-primary'>
									<Copy size={14} />
									复制连接
								</button>
							</div>
						)}
					</div>

					<label className='border-brand/20 bg-background/40 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center'>
						<UploadCloud className='mb-3 text-brand' size={30} />
						<input type='file' multiple className='hidden' onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFiles(Array.from(event.target.files || []))} />
						<span className='font-semibold'>{selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : '选择要发送的文件'}</span>
						<span className='text-secondary mt-1 text-xs'>单文件大文件走流式传输；多文件会先 ZIP，建议不超过 {formatBytes(LAN_LIMITS.multiFileZipMaxBytes)}</span>
					</label>

					{selectedFiles.length > 0 && (
						<div className='rounded-2xl border border-border bg-article p-4 text-sm'>
							<div className='text-secondary mb-2 text-xs'>待发送 · 总计 {formatBytes(totalSelectedSize(selectedFiles))}</div>
							<div className='space-y-1'>
								{selectedFiles.slice(0, 5).map(file => (
									<div key={`${file.name}-${file.size}-${file.lastModified}`} className='flex justify-between gap-3'>
										<span className='truncate'>{file.name}</span>
										<span className='text-secondary shrink-0'>{formatBytes(file.size)}</span>
									</div>
								))}
							</div>
						</div>
					)}

					<button disabled={!connected || !selectedFiles.length || transferBusy || !!incomingRequest} onClick={() => void handleSendFiles()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
						<Send size={16} />
						发送给对方
					</button>
				</div>
			)}

			{incomingRequest && (
				<div className='rounded-2xl border border-brand/40 bg-brand/10 p-4'>
					<p className='font-semibold'>{remotePeer?.name || '对方设备'} 想发送文件</p>
					<p className='text-secondary mt-1 text-sm'>
						{incomingRequest.name} · {incomingRequest.fileCount} 个文件 · {formatBytes(incomingRequest.size)} · {incomingRequest.suggestedStorage.toUpperCase()} 模式
					</p>
					<div className='mt-3 flex gap-2'>
						<button onClick={() => void acceptIncoming()} className='bg-brand text-background rounded-full px-4 py-2 text-xs font-semibold'>
							接收
						</button>
						<button onClick={rejectIncoming} className='rounded-full border border-border px-4 py-2 text-xs font-semibold'>
							拒绝
						</button>
					</div>
				</div>
			)}
		</section>
	)
}
