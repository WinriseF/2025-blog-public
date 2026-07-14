'use client'

import { useEffect, useRef, useState } from 'react'
import WaveformPlayer from '@arraypress/waveform-player'
import { Check, CheckCheck, Clock3, Download, FileArchive, Image as ImageIcon, X } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanAttachment, LanChatMessage } from '@/lib/lan-transfer/types'
import { ImagePreviewDialog } from './image-preview-dialog'
import { cn, DeviceAvatar } from './lan-transfer-ui'

type AttachmentCardProps = {
	attachment: LanAttachment
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}

function progressLabel(value: number) {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatSpeed(value?: number) {
	return value && Number.isFinite(value) && value > 0 ? `${formatBytes(value)}/s` : ''
}

function transferBytes(attachment: LanAttachment) {
	return Math.min(attachment.size, attachment.transferredBytes ?? Math.round(attachment.size * Math.max(0, Math.min(1, attachment.progress))))
}

function transferMeta(attachment: LanAttachment, compact = false) {
	const bytes = transferBytes(attachment)
	const parts = compact ? [progressLabel(attachment.progress)] : [`${formatBytes(bytes)} / ${formatBytes(attachment.size)}`]
	const speed = formatSpeed(attachment.speedBps)
	if (speed) parts.push(speed)
	if (!compact && attachment.etaSeconds && attachment.etaSeconds > 0) parts.push(`剩余 ${Math.ceil(attachment.etaSeconds)}秒`)
	return parts.join(' · ')
}

function transferStage(attachment: LanAttachment) {
	if (attachment.status === 'complete') return '已完成'
	if (attachment.status === 'queued') return '排队中'
	if (attachment.status === 'offered') return attachment.direction === 'in' ? '准备缓存' : '等待对方准备'
	if (attachment.status === 'receiving') return '接收中'
	if (attachment.status === 'sending') return attachment.progress >= 1 ? '等待对方保存' : '发送中'
	return '传输中'
}

function compactFileName(name: string, maxLength = 28) {
	const normalized = name.trim() || '未命名文件'
	const chars = Array.from(normalized)
	if (chars.length <= maxLength) return normalized
	const dot = normalized.lastIndexOf('.')
	const suffix = dot > 0 && normalized.length - dot <= 10 ? normalized.slice(dot) : chars.slice(-6).join('')
	return `${chars.slice(0, Math.max(8, maxLength - Array.from(suffix).length - 3)).join('')}...${suffix}`
}

function ImageAttachmentCard({ attachment, onDownload }: AttachmentCardProps) {
	const [previewOpen, setPreviewOpen] = useState(false)
	const source = attachment.previewUrl || attachment.url
	const downloadableUrl = attachment.url || attachment.previewUrl
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = attachment.status !== 'complete' && !failed
	if (!source) return (
		<div className={cn('w-[260px] max-w-[68vw] rounded-2xl border px-4 py-3 shadow-sm', failed ? 'border-red-300 bg-red-500/10' : 'border-border bg-article')}>
			<div className='flex items-center gap-3'><div className='bg-brand/10 text-brand flex size-11 items-center justify-center rounded-xl'><ImageIcon size={20} /></div><div className='min-w-0'><p className='truncate text-sm font-semibold'>{compactFileName(attachment.name, 22)}</p><p className='text-secondary mt-1 text-xs'>{failed ? attachment.error || '接收失败' : `${transferStage(attachment)} · ${transferMeta(attachment, true)}`}</p></div></div>
			{transferring && <Progress value={attachment.progress} />}
		</div>
	)
	return (
		<>
			<div className='relative inline-block max-w-[360px] overflow-hidden rounded-2xl border border-border bg-article shadow-sm max-sm:max-w-[68vw]'>
				<button type='button' onClick={() => setPreviewOpen(true)} className='block cursor-zoom-in' aria-label={`查看图片：${attachment.name}`}><img src={source} alt={attachment.name} className='block max-h-[420px] w-auto max-w-full object-contain max-sm:max-h-[48vh]' /></button>
				{transferring && <div className='absolute inset-x-0 bottom-0 bg-background/75 px-3 py-2 backdrop-blur'><div className='mb-1 flex justify-between text-[11px] font-medium'><span>{transferStage(attachment)}</span><span>{transferMeta(attachment, true)}</span></div><Progress value={attachment.progress} /></div>}
				{downloadableUrl && <button onClick={() => onDownload(attachment.name, downloadableUrl)} className='absolute right-2 bottom-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/80' aria-label='下载图片'><Download size={16} /></button>}
				{attachment.error && <p className='absolute inset-x-2 bottom-2 rounded-xl bg-red-500/90 px-2 py-1 text-xs text-white'>{attachment.error}</p>}
			</div>
			{previewOpen && <ImagePreviewDialog src={source} alt={attachment.name} onClose={() => setPreviewOpen(false)} />}
		</>
	)
}

function VoiceAttachmentBubble({ attachment }: AttachmentCardProps) {
	const playerRef = useRef<HTMLDivElement>(null)
	const source = attachment.url || attachment.previewUrl
	const outgoing = attachment.direction === 'out'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = attachment.status !== 'complete' && !failed
	useEffect(() => {
		if (!source || failed || !playerRef.current) return
		const player = new WaveformPlayer(playerRef.current, { url: source, height: 36, colorPreset: outgoing ? 'dark' : 'light', showInfo: false, enableMediaSession: false, playPauseLabel: '播放或暂停语音', seekLabel: '调整语音播放位置', errorText: '语音加载失败' })
		return () => player.destroy()
	}, [failed, outgoing, source])
	const duration = Math.max(0, Math.round((attachment.durationMs || 0) / 1000))
	const status = failed ? attachment.error || '播放失败' : transferring ? `${transferStage(attachment)} · ${transferMeta(attachment, true)}` : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
	return <div className={cn('w-[72vw] min-w-[215px] max-w-[300px] rounded-[24px] px-3 py-1.5 shadow-sm', outgoing ? 'bg-brand text-background' : 'bg-article text-primary', failed && 'border border-red-300 bg-red-500/10 text-primary')}><div className='flex items-center gap-3'><div className='min-w-0 flex-1'>{source && !failed ? <div ref={playerRef} className='[&_.waveform-container]:min-h-9' /> : <div className='h-9 rounded-full bg-background/25' />}</div><span className='shrink-0 text-sm font-semibold tabular-nums'>{status}</span></div>{transferring && <Progress value={attachment.progress} />}</div>
}

function Progress({ value }: { value: number }) {
	return <div className='mt-2 h-1 overflow-hidden rounded-full bg-background/45'><div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(value) }} /></div>
}

function FileAttachmentCard({ attachment, onDownload, onStartReceive }: AttachmentCardProps) {
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const waiting = attachment.direction === 'in' && attachment.status === 'offered'
	const transferring = !complete && !failed && !waiting
	const canAct = waiting || Boolean(attachment.url)
	const action = () => waiting ? onStartReceive(attachment.id) : attachment.url && onDownload(attachment.name, attachment.url)
	const className = cn('w-[320px] max-w-[72vw] rounded-xl px-3 py-3 text-left shadow-sm transition sm:w-[390px]', failed ? 'border border-red-300 bg-red-500/10' : 'bg-article', canAct && 'cursor-pointer hover:bg-article/90 active:scale-[0.99]')
	const content = <><div className='flex items-center gap-2.5'><div className='bg-brand/15 text-brand flex size-9 items-center justify-center rounded-lg'><FileArchive size={18} /></div><p title={attachment.name} className='min-w-0 flex-1 truncate text-sm font-semibold'>{compactFileName(attachment.name, 42)}</p></div>{transferring && <Progress value={attachment.progress} />}<p className='text-secondary mt-1.5 text-xs tabular-nums'>{transferring ? `${transferStage(attachment)} · ${transferMeta(attachment)}` : waiting ? `${formatBytes(attachment.size)} · 点击接收` : formatBytes(attachment.size)}</p>{attachment.error && <p className='mt-2 text-xs text-red-500'>{attachment.error}</p>}</>
	return canAct ? <button type='button' onClick={action} className={className}>{content}</button> : <div className={className}>{content}</div>
}

function AttachmentCard(props: AttachmentCardProps) {
	if (props.attachment.kind === 'image') return <ImageAttachmentCard {...props} />
	if (props.attachment.kind === 'voice') return <VoiceAttachmentBubble {...props} />
	return <FileAttachmentCard {...props} />
}

function MessageBubble({ message, peerName, peerAvatarSeed, peerDeviceType, localAvatarSeed, localDeviceType, onDownload, onStartReceive }: {
	message: LanChatMessage
	peerName: string
	peerAvatarSeed?: string
	peerDeviceType?: string
	localAvatarSeed?: string
	localDeviceType?: string
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	if (message.direction === 'system') return <div className='mx-auto w-fit rounded-full border border-border bg-article px-3 py-1 text-xs text-secondary'>{message.text}</div>
	const outgoing = message.direction === 'out'
	const deliveryIcon = message.status === 'delivered' ? <CheckCheck size={13} className='text-brand' /> : message.status === 'failed' ? <X size={13} className='text-red-400' /> : message.status === 'queued' ? <Clock3 size={13} className='text-secondary' /> : <Check size={13} className='text-secondary' />
	return <div className={cn('flex gap-3 max-sm:gap-2', outgoing ? 'justify-end' : 'justify-start')}>{!outgoing && <DeviceAvatar type={peerDeviceType} avatarSeed={peerAvatarSeed} active />}<div className={cn('flex max-w-[calc(100%-58px)] flex-col space-y-2 sm:max-w-[72%]', outgoing ? 'items-end' : 'items-start')}>{!outgoing && <p className='text-secondary max-w-full truncate px-1 text-xs'>{peerName}</p>}{message.text && <div className={cn('max-w-full break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm', outgoing ? 'bg-brand text-background' : 'bg-article text-primary')}>{message.text}</div>}{message.attachments.length > 0 && <div className='flex max-w-full flex-col items-start space-y-2'>{message.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} onDownload={onDownload} onStartReceive={onStartReceive} />)}</div>}{outgoing && <span>{deliveryIcon}</span>}</div>{outgoing && <DeviceAvatar type={localDeviceType} avatarSeed={localAvatarSeed} active />}</div>
}

function formatMessageTime(value: number) {
	const date = new Date(value)
	const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
	return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

export function MessageList({ messages, peerName, peerAvatarSeed, peerDeviceType, localAvatarSeed, localDeviceType, onDownload, onStartReceive }: {
	messages: LanChatMessage[]
	peerName: string
	peerAvatarSeed?: string
	peerDeviceType?: string
	localAvatarSeed?: string
	localDeviceType?: string
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	return <>{messages.map((message, index) => <div key={message.id} className='space-y-3'>{(!messages[index - 1] || message.createdAt - messages[index - 1].createdAt > 300_000) && <div className='flex justify-center py-2'><span className='rounded-full bg-background/55 px-3 py-1 text-xs text-secondary'>{formatMessageTime(message.createdAt)}</span></div>}<MessageBubble message={message} peerName={peerName} peerAvatarSeed={peerAvatarSeed} peerDeviceType={peerDeviceType} localAvatarSeed={localAvatarSeed} localDeviceType={localDeviceType} onDownload={onDownload} onStartReceive={onStartReceive} /></div>)}</>
}
