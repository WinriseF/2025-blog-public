'use client'

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import WaveformPlayer from '@arraypress/waveform-player'
import { Check, CheckCheck, Clock3, Download, FileArchive, Image as ImageIcon, Laptop, Mic, Monitor, Paperclip, Send, Smartphone, X } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanAttachment, LanChatMessage } from '@/lib/lan-transfer/types'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'

type AttachmentAction = 'file' | 'image'

function cn(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(' ')
}

function dicebearAvatarUrl(seed: string) {
	return `https://api.dicebear.com/10.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`
}

export function DeviceAvatar({ type = 'desktop', avatarSeed, active = false }: { type?: string; avatarSeed?: string; active?: boolean }) {
	const [failed, setFailed] = useState(false)
	const Icon = type === 'phone' ? Smartphone : type === 'tablet' ? Monitor : Laptop
	useEffect(() => setFailed(false), [avatarSeed])
	return (
		<div className={cn('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border', active ? 'border-brand/35 bg-brand/10 text-brand' : 'border-border bg-background/40 text-primary')}>
			{avatarSeed && !failed ? <img src={dicebearAvatarUrl(avatarSeed)} alt='' className='size-full object-cover' referrerPolicy='no-referrer' onError={() => setFailed(true)} /> : <Icon size={22} />}
		</div>
	)
}

function progressLabel(value: number) {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatTransferSpeed(value?: number) {
	return value && Number.isFinite(value) && value > 0 ? `${formatBytes(value)}/s` : ''
}

function formatEta(value?: number) {
	if (!value || !Number.isFinite(value) || value <= 0) return ''
	const seconds = Math.ceil(value)
	if (seconds < 60) return `${seconds}秒`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes}分钟`
	return `${Math.ceil(minutes / 60)}小时`
}

function transferBytes(attachment: LanAttachment) {
	const progress = Math.max(0, Math.min(1, attachment.progress))
	return Math.min(attachment.size, attachment.transferredBytes ?? Math.round(attachment.size * progress))
}

function formatTransferProgress(attachment: LanAttachment, compact = false) {
	const bytes = transferBytes(attachment)
	const action = attachment.direction === 'out' ? '已确认' : attachment.kind === 'file' ? '已接收' : '已缓存'
	const parts = compact ? [progressLabel(attachment.progress)] : [`${action} ${progressLabel(attachment.progress)}`, `${formatBytes(bytes)} / ${formatBytes(attachment.size)}`]
	if (attachment.phase === 'confirming') parts.unshift(compact ? '等待保存确认' : '等待对方保存确认')
	const speed = formatTransferSpeed(attachment.speedBps)
	if (speed) parts.push(speed)
	const eta = formatEta(attachment.etaSeconds)
	if (!compact && eta) parts.push(`剩余 ${eta}`)
	return parts.join(' · ')
}

function formatTransferMeta(attachment: LanAttachment) {
	const parts = [`${formatBytes(transferBytes(attachment))} / ${formatBytes(attachment.size)}`]
	if (attachment.dataPlane === 'native-lna-http') parts.unshift('极速 TCP')
	if (attachment.dataPlane === 'native-webtransport') parts.unshift('极速 QUIC')
	if (attachment.phase === 'confirming') parts.unshift('等待对方保存确认')
	const speed = formatTransferSpeed(attachment.speedBps)
	if (speed) parts.push(speed)
	const eta = formatEta(attachment.etaSeconds)
	if (eta) parts.push(`剩余 ${eta}`)
	return parts.join(' · ')
}

function formatVoiceTime(secondsValue = 0) {
	const totalSeconds = Math.max(0, Math.round(secondsValue))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function compactFileName(name: string, maxLength = 28) {
	const normalized = name.trim() || '未命名文件'
	const chars = Array.from(normalized)
	if (chars.length <= maxLength) return normalized
	const dotIndex = normalized.lastIndexOf('.')
	const suffix = dotIndex > 0 && normalized.length - dotIndex <= 10 ? normalized.slice(dotIndex) : Array.from(normalized).slice(-6).join('')
	const suffixLength = Array.from(suffix).length
	const headLength = Math.max(8, maxLength - suffixLength - 3)
	return `${chars.slice(0, headLength).join('')}...${suffix}`
}

function formatMessageTime(value: number) {
	const date = new Date(value)
	const now = new Date()
	const sameDay = date.toDateString() === now.toDateString()
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
	if (sameDay) return time
	if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
	return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function shouldShowTimeDivider(previous: LanChatMessage | undefined, current: LanChatMessage) {
	if (!previous) return true
	return current.createdAt - previous.createdAt > 5 * 60 * 1000
}

type AttachmentCardProps = {
	attachment: LanAttachment
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}

function ImageAttachmentCard({ attachment, onDownload }: AttachmentCardProps) {
	const [previewOpen, setPreviewOpen] = useState(false)
	const source = attachment.previewUrl || attachment.url
	const downloadableUrl = attachment.url || attachment.previewUrl
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = !complete && !failed
	const hasFooter = transferring || Boolean(attachment.error)
	if (!source) {
		return (
			<div className={cn('w-[260px] max-w-[68vw] rounded-2xl border px-4 py-3 shadow-sm', failed ? 'border-red-300 bg-red-500/10' : 'border-border bg-article')}>
				<div className='flex items-center gap-3'>
					<div className='bg-brand/10 text-brand flex size-11 shrink-0 items-center justify-center rounded-xl'><ImageIcon size={20} /></div>
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm font-semibold'>{compactFileName(attachment.name, 22)}</p>
						<p className='text-secondary mt-1 text-xs'>{failed ? attachment.error || '接收失败' : attachment.status === 'offered' ? '准备缓存' : formatTransferProgress(attachment, true)}</p>
					</div>
				</div>
				{transferring && <div className='mt-3 h-1 overflow-hidden rounded-full bg-background/40'><div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} /></div>}
			</div>
		)
	}
	return (
		<>
			<div className='relative inline-block max-w-[360px] overflow-hidden rounded-2xl border border-border bg-article shadow-sm max-sm:max-w-[68vw]'>
				<button type='button' onClick={() => setPreviewOpen(true)} className='block cursor-zoom-in' aria-label={`查看图片：${attachment.name}`}>
					<img src={source} alt={attachment.name} className='block max-h-[420px] w-auto max-w-full object-contain max-sm:max-h-[48vh]' />
				</button>
				{transferring && (
					<div className='absolute inset-x-0 bottom-0 bg-background/75 px-3 py-2 backdrop-blur'>
						<div className='mb-1 flex items-center justify-between text-[11px] font-medium text-primary'>
							<span>{attachment.status === 'offered' ? '等待缓存' : attachment.status === 'receiving' ? '接收中' : attachment.phase === 'confirming' ? '等待保存确认' : '发送中'}</span>
							<span>{formatTransferProgress(attachment, true)}</span>
						</div>
						<div className='h-1 overflow-hidden rounded-full bg-background/50'><div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} /></div>
					</div>
				)}
				{downloadableUrl && <button onClick={() => onDownload(attachment.name, downloadableUrl)} className={cn('absolute right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/80 text-primary shadow-sm backdrop-blur transition hover:border-brand/45', hasFooter ? 'bottom-12' : 'bottom-2')} aria-label='下载图片'><Download size={16} /></button>}
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
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = !complete && !failed
	const playable = Boolean(source && !failed)
	const statusText = failed ? attachment.error || '播放失败' : transferring ? formatTransferProgress(attachment, true) : formatVoiceTime(attachment.durationMs ? attachment.durationMs / 1000 : 0)

	useEffect(() => {
		if (!source || failed || !playerRef.current) return
		const player = new WaveformPlayer(playerRef.current, { url: source, height: 36, colorPreset: outgoing ? 'dark' : 'light', showInfo: false, enableMediaSession: false, playPauseLabel: '播放或暂停语音', seekLabel: '调整语音播放位置', errorText: '语音加载失败' })
		return () => player.destroy()
	}, [failed, outgoing, source])

	return (
		<div className={cn('w-[72vw] min-w-[215px] max-w-[300px] rounded-[24px] px-3 py-1.5 shadow-sm', outgoing ? 'bg-brand text-background' : 'bg-article text-primary', failed && 'border border-red-300 bg-red-500/10 text-primary')}>
			<div className='flex items-center gap-3'>
				<div className='min-w-0 flex-1'>{playable ? <div ref={playerRef} className='[&_.waveform-container]:min-h-9' /> : <div className='h-9 rounded-full bg-background/25' />}</div>
				<span className={cn('shrink-0 text-sm font-semibold tabular-nums', outgoing ? 'text-background/90' : 'text-primary')}>{statusText}</span>
			</div>
			{transferring && <div className='mt-1 px-1'><div className={cn('mt-1 h-1 overflow-hidden rounded-full', outgoing ? 'bg-background/25' : 'bg-background/50')}><div className={cn('h-full rounded-full [transition:width_160ms_linear]', outgoing ? 'bg-background' : 'bg-brand')} style={{ width: progressLabel(attachment.progress) }} /></div></div>}
		</div>
	)
}

function FileAttachmentCard({ attachment, onDownload, onStartReceive }: AttachmentCardProps) {
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const waitingReceive = attachment.direction === 'in' && attachment.status === 'offered'
	const transferring = !complete && !failed && !waitingReceive
	const canDownload = Boolean(attachment.url)
	const canAct = waitingReceive || canDownload
	const displayName = compactFileName(attachment.name, 42)
	const detailText = transferring ? formatTransferMeta(attachment) : waitingReceive ? `${formatBytes(attachment.size)} · 点击接收` : formatBytes(attachment.size)
	const handleAction = () => {
		if (waitingReceive) return onStartReceive(attachment.id)
		if (attachment.url) onDownload(attachment.name, attachment.url)
	}
	const cardClassName = cn('w-[320px] max-w-[72vw] rounded-xl px-3 py-3 text-left shadow-sm transition sm:w-[390px]', failed ? 'border border-red-300 bg-red-500/10' : 'bg-article', canAct && 'cursor-pointer hover:bg-article/90 active:scale-[0.99]')
	const content = (
		<>
			<div className='flex min-w-0 items-center gap-2.5'>
				<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand'><FileArchive size={18} /></div>
				<div className='min-w-0 flex-1'><p title={attachment.name} className='truncate text-sm font-semibold leading-5 text-primary'>{displayName}</p></div>
			</div>
			{transferring && (
				<div className='mt-2 flex items-center gap-2'>
					<span className='border-brand/25 bg-brand/10 text-brand shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums'>{progressLabel(attachment.progress)}</span>
					<div className='h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-background/45' title={formatTransferProgress(attachment)}><div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} /></div>
				</div>
			)}
			<p className='text-secondary mt-1.5 break-words text-xs leading-4 tabular-nums'>{detailText}</p>
			{attachment.error && <p className='mt-2 text-xs text-red-500'>{attachment.error}</p>}
		</>
	)
	if (canAct) return <button type='button' onClick={handleAction} className={cardClassName} aria-label={waitingReceive ? '接收文件' : '下载文件'}>{content}</button>
	return <div className={cardClassName}>{content}</div>
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
	const deliveryLabel = message.status === 'delivered' ? '已送达' : message.status === 'failed' ? '发送失败' : message.status === 'queued' ? '等待发送' : '已发送'
	const deliveryIcon = message.status === 'delivered'
		? <CheckCheck size={13} aria-hidden='true' className='text-brand' />
		: message.status === 'failed'
			? <X size={13} aria-hidden='true' className='text-red-400' />
			: message.status === 'queued'
				? <Clock3 size={13} aria-hidden='true' className='text-secondary' />
				: <Check size={13} aria-hidden='true' className='text-secondary' />
	return (
		<div className={cn('flex gap-3 max-sm:gap-2', outgoing ? 'justify-end' : 'justify-start')}>
			{!outgoing && <DeviceAvatar type={peerDeviceType} avatarSeed={peerAvatarSeed} active />}
			<div className={cn('flex max-w-[calc(100%-58px)] flex-col space-y-2 sm:max-w-[72%]', outgoing ? 'items-end' : 'items-start')}>
				{!outgoing && <p className='text-secondary max-w-full truncate px-1 text-xs'>{peerName}</p>}
				{message.text && <div className={cn('max-w-full break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm', outgoing ? 'bg-brand text-background' : 'bg-article text-primary')}>{message.text}</div>}
				{message.attachments.length > 0 && <div className={cn('max-w-full space-y-2', outgoing ? 'flex flex-col items-end' : 'flex flex-col items-start')}>{message.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} onDownload={onDownload} onStartReceive={onStartReceive} />)}</div>}
				{outgoing && <span role='img' aria-label={deliveryLabel} title={deliveryLabel}>{deliveryIcon}</span>}
			</div>
			{outgoing && <DeviceAvatar type={localDeviceType} avatarSeed={localAvatarSeed} active />}
		</div>
	)
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
	return <>{messages.map((message, index) => (
		<div key={message.id} className='space-y-3'>
			{shouldShowTimeDivider(messages[index - 1], message) && <div className='flex justify-center py-2'><span className='rounded-full bg-background/55 px-3 py-1 text-xs text-secondary'>{formatMessageTime(message.createdAt)}</span></div>}
			<MessageBubble message={message} peerName={peerName} peerAvatarSeed={peerAvatarSeed} peerDeviceType={peerDeviceType} localAvatarSeed={localAvatarSeed} localDeviceType={localDeviceType} onDownload={onDownload} onStartReceive={onStartReceive} />
		</div>
	))}</>
}

export function ChatComposer({ connected, recorderState, onSendText, onSendFiles, onSelectNativeFiles, onRecordStart, onRecordStop }: {
	connected: boolean
	recorderState: string
	onSendText: (text: string) => void
	onSendFiles: (files: File[], mode?: AttachmentAction) => void
	onSelectNativeFiles?: () => void
	onRecordStart: () => void
	onRecordStop: () => void
}) {
	const [text, setText] = useState('')
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const imageInputRef = useRef<HTMLInputElement | null>(null)
	const submitText = () => {
		if (!connected || !text.trim()) return
		onSendText(text)
		setText('')
	}
	const handleFiles = (event: ChangeEvent<HTMLInputElement>, mode?: AttachmentAction) => {
		const files = Array.from(event.target.files || [])
		if (files.length) onSendFiles(files, mode)
		event.target.value = ''
	}
	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
		if (!files.length) return
		event.preventDefault()
		onSendFiles(files, 'image')
	}
	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		const files = Array.from(event.dataTransfer.files)
		if (files.length) onSendFiles(files)
	}
	return (
		<div onDragOver={event => event.preventDefault()} onDrop={handleDrop} className='rounded-2xl border border-border bg-article p-3 shadow-sm backdrop-blur sm:rounded-3xl'>
			<input ref={fileInputRef} type='file' multiple className='hidden' onChange={event => handleFiles(event, 'file')} />
			<input ref={imageInputRef} type='file' multiple accept='image/*' className='hidden' onChange={event => handleFiles(event, 'image')} />
			<div className='flex items-center gap-2'>
				<button onClick={() => onSelectNativeFiles ? onSelectNativeFiles() : fileInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'><Paperclip size={19} /></button>
				<button onClick={() => imageInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'><ImageIcon size={19} /></button>
				<button onClick={recorderState === 'recording' ? onRecordStop : onRecordStart} className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border transition', recorderState === 'recording' ? 'border-red-500 bg-red-500 text-white' : 'border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary')}><Mic size={18} /></button>
				<input value={text} onPaste={handlePaste} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitText() } }} placeholder={connected ? '输入消息' : '连接后可发送'} className='min-w-0 flex-1 bg-transparent px-2 text-sm text-primary placeholder:text-secondary' />
				<button onClick={submitText} disabled={!connected || !text.trim()} className='bg-brand text-background flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold disabled:opacity-50 sm:px-5'><Send size={15} />发送</button>
			</div>
		</div>
	)
}
