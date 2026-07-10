'use client'

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { AudioLines, CheckCheck, ChevronLeft, Copy, Download, FileArchive, Image as ImageIcon, Laptop, MessageCircle, Mic, Monitor, Paperclip, Pause, Plus, QrCode, RefreshCw, Send, Smartphone, X } from 'lucide-react'
import PlaySVG from '@/svgs/play.svg'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanAttachment, LanChatMessage } from '@/lib/lan-transfer/types'
import { useLanTransferController } from './use-lan-transfer-controller'

type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
	onLeaveSession?: () => void
	onSwitchRelay?: () => void
}

type AttachmentAction = 'file' | 'image'
type LanController = ReturnType<typeof useLanTransferController>
type LanConnectionItem = LanController['connections'][number]

function cn(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(' ')
}

const connectionLabel = {
	idle: '未连接',
	signaling: '连接中',
	discovered: '找到设备',
	connecting: '连接中',
	connected: '已连接',
	failed: '等待恢复',
}

function dicebearAvatarUrl(seed: string) {
	return `https://api.dicebear.com/10.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`
}

function DeviceAvatar({ type = 'desktop', avatarSeed, active = false }: { type?: string; avatarSeed?: string; active?: boolean }) {
	const [failed, setFailed] = useState(false)
	const Icon = type === 'phone' ? Smartphone : type === 'tablet' ? Monitor : Laptop
	useEffect(() => setFailed(false), [avatarSeed])
	return (
		<div className={cn('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border', active ? 'border-brand/35 bg-brand/10 text-brand' : 'border-border bg-background/40 text-primary')}>
			{avatarSeed && !failed ? <img src={dicebearAvatarUrl(avatarSeed)} alt='' className='size-full object-cover' referrerPolicy='no-referrer' onError={() => setFailed(true)} /> : <Icon size={22} />}
		</div>
	)
}

function connectionStatusText(connection: LanConnectionItem) {
	if (connection.connected) return connection.connectionRoute || '在线'
	return connection.status || connectionLabel[connection.connectionState] || '等待'
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
	const speed = formatTransferSpeed(attachment.speedBps)
	if (speed) parts.push(speed)
	const eta = formatEta(attachment.etaSeconds)
	if (!compact && eta) parts.push(`剩余 ${eta}`)
	return parts.join(' · ')
}

function formatTransferMeta(attachment: LanAttachment) {
	const parts = [`${formatBytes(transferBytes(attachment))} / ${formatBytes(attachment.size)}`]
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

function ImageAttachmentCard({
	attachment,
	onDownload,
}: AttachmentCardProps) {
	const [previewOpen, setPreviewOpen] = useState(false)
	const source = attachment.previewUrl || attachment.url
	const downloadableUrl = attachment.url || attachment.previewUrl
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = !complete && !failed
	const hasFooter = transferring || Boolean(attachment.error)
	useEffect(() => {
		if (!previewOpen) return
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setPreviewOpen(false)
		}
		window.addEventListener('keydown', closeOnEscape)
		return () => window.removeEventListener('keydown', closeOnEscape)
	}, [previewOpen])
	if (!source) {
		return (
			<div className={cn('w-[260px] max-w-[68vw] rounded-2xl border px-4 py-3 shadow-sm', failed ? 'border-red-300 bg-red-500/10' : 'border-border bg-article')}>
				<div className='flex items-center gap-3'>
					<div className='bg-brand/10 text-brand flex size-11 shrink-0 items-center justify-center rounded-xl'>
						<ImageIcon size={20} />
					</div>
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm font-semibold'>{compactFileName(attachment.name, 22)}</p>
						<p className='text-secondary mt-1 text-xs'>{failed ? attachment.error || '接收失败' : attachment.status === 'offered' ? '准备缓存' : formatTransferProgress(attachment, true)}</p>
					</div>
				</div>
				{transferring && (
					<div className='mt-3 h-1 overflow-hidden rounded-full bg-background/40'>
						<div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} />
					</div>
				)}
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
							<span>{attachment.status === 'offered' ? '等待缓存' : attachment.status === 'receiving' ? '接收中' : '发送中'}</span>
							<span>{formatTransferProgress(attachment, true)}</span>
						</div>
						<div className='h-1 overflow-hidden rounded-full bg-background/50'>
							<div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} />
						</div>
					</div>
				)}
				{downloadableUrl && (
					<button onClick={() => onDownload(attachment.name, downloadableUrl)} className={cn('absolute right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/80 text-primary shadow-sm backdrop-blur transition hover:border-brand/45', hasFooter ? 'bottom-12' : 'bottom-2')} aria-label='下载图片'>
						<Download size={16} />
					</button>
				)}
				{attachment.error && <p className='absolute inset-x-2 bottom-2 rounded-xl bg-red-500/90 px-2 py-1 text-xs text-white'>{attachment.error}</p>}
			</div>
			{previewOpen && createPortal(
				<div role='dialog' aria-modal='true' aria-label={`查看图片：${attachment.name}`} onClick={event => event.currentTarget === event.target && setPreviewOpen(false)} className='fixed inset-0 z-[1001] flex items-center justify-center bg-black/80 p-5'>
					<img src={source} alt={attachment.name} className='max-h-[calc(100dvh-2.5rem)] max-w-full object-contain' />
					<button type='button' onClick={() => setPreviewOpen(false)} className='absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-black/55 text-white' aria-label='关闭图片预览'>
						<X size={20} />
					</button>
				</div>,
				document.body
			)}
		</>
	)
}

function VoiceAttachmentBubble({ attachment }: AttachmentCardProps) {
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const [playing, setPlaying] = useState(false)
	const [duration, setDuration] = useState(attachment.durationMs ? attachment.durationMs / 1000 : 0)
	const [currentTime, setCurrentTime] = useState(0)
	const source = attachment.url || attachment.previewUrl
	const outgoing = attachment.direction === 'out'
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = !complete && !failed
	const playable = Boolean(source && !failed)
	const playedRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0
	const plannedDuration = duration || (attachment.durationMs ? attachment.durationMs / 1000 : 0)
	const statusText = failed ? attachment.error || '播放失败' : transferring ? formatTransferProgress(attachment, true) : formatVoiceTime(playing ? currentTime : plannedDuration)

	const togglePlayback = async () => {
		const audio = audioRef.current
		if (!audio || !playable) return
		if (audio.paused) {
			await audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
			return
		}
		audio.pause()
		setPlaying(false)
	}

	return (
		<div className={cn('flex min-w-[220px] max-w-[74vw] items-center gap-3 rounded-[24px] px-3 py-2.5 shadow-sm sm:min-w-[260px]', outgoing ? 'rounded-br-md bg-brand text-background' : 'rounded-bl-md bg-article text-primary', failed && 'border border-red-300 bg-red-500/10 text-primary')}>
			<button
				onClick={() => void togglePlayback()}
				disabled={!playable}
				className={cn('flex size-11 shrink-0 items-center justify-center rounded-full shadow-sm transition disabled:opacity-50', outgoing ? 'bg-background/90 text-brand' : 'bg-brand text-background')}
				aria-label={playing ? '暂停语音' : '播放语音'}
			>
				{playing ? <Pause size={18} /> : <PlaySVG className='ml-0.5 h-4 w-4' />}
			</button>
			<div className='min-w-0 flex-1'>
				<div className='relative h-8 w-28 overflow-hidden sm:w-32'>
					<AudioLines className={cn('absolute inset-0 h-8 w-28 sm:w-32', outgoing ? 'text-background/45' : 'text-secondary/45')} strokeWidth={2.4} />
					<div className='absolute inset-y-0 left-0 overflow-hidden' style={{ width: `${Math.max(playing ? 8 : 0, playedRatio * 100)}%` }}>
						<AudioLines className={cn('h-8 w-28 sm:w-32', outgoing ? 'text-background' : 'text-brand')} strokeWidth={2.4} />
					</div>
				</div>
				{transferring && (
					<div className={cn('mt-1 h-1 overflow-hidden rounded-full', outgoing ? 'bg-background/25' : 'bg-background/50')}>
						<div className={cn('h-full rounded-full [transition:width_160ms_linear]', outgoing ? 'bg-background' : 'bg-brand')} style={{ width: progressLabel(attachment.progress) }} />
					</div>
				)}
			</div>
			<span className={cn('shrink-0 text-sm font-semibold tabular-nums', outgoing ? 'text-background/90' : 'text-primary')}>{statusText}</span>
			{source && (
				<audio
					ref={audioRef}
					src={source}
					preload='metadata'
					className='hidden'
					onLoadedMetadata={event => {
						const nextDuration = event.currentTarget.duration
						if (Number.isFinite(nextDuration)) setDuration(nextDuration)
					}}
					onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime || 0)}
					onPause={() => setPlaying(false)}
					onEnded={() => {
						setPlaying(false)
						setCurrentTime(0)
					}}
				/>
			)}
		</div>
	)
}

function FileAttachmentCard({
	attachment,
	onDownload,
	onStartReceive,
}: AttachmentCardProps) {
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
	const cardClassName = cn(
		'w-[320px] max-w-[72vw] rounded-xl px-3 py-3 text-left shadow-sm transition sm:w-[390px]',
		failed ? 'border border-red-300 bg-red-500/10' : 'bg-article',
		canAct && 'cursor-pointer hover:bg-article/90 active:scale-[0.99]'
	)
	const content = (
		<>
			<div className='flex min-w-0 items-center gap-2.5'>
				<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand'>
					<FileArchive size={18} />
				</div>
				<div className='min-w-0 flex-1'>
					<p title={attachment.name} className='truncate text-sm font-semibold leading-5 text-primary'>
						{displayName}
					</p>
				</div>
			</div>
			{transferring && (
				<div className='mt-2 flex items-center gap-2'>
					<span className='border-brand/25 bg-brand/10 text-brand shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums'>{progressLabel(attachment.progress)}</span>
					<div className='h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-background/45' title={formatTransferProgress(attachment)}>
						<div className='h-full rounded-full bg-brand [transition:width_160ms_linear]' style={{ width: progressLabel(attachment.progress) }} />
					</div>
				</div>
			)}
			<p className='text-secondary mt-1.5 break-words text-xs leading-4 tabular-nums'>
				{detailText}
			</p>
			{attachment.error && <p className='mt-2 text-xs text-red-500'>{attachment.error}</p>}
		</>
	)
	if (canAct) {
		return (
			<button type='button' onClick={handleAction} className={cardClassName} aria-label={waitingReceive ? '接收文件' : '下载文件'}>
				{content}
			</button>
		)
	}
	return (
		<div className={cardClassName}>
			{content}
		</div>
	)
}

function AttachmentCard(props: AttachmentCardProps) {
	if (props.attachment.kind === 'image') return <ImageAttachmentCard {...props} />
	if (props.attachment.kind === 'voice') return <VoiceAttachmentBubble {...props} />
	return <FileAttachmentCard {...props} />
}

function MessageBubble({
	message,
	peerName,
	peerAvatarSeed,
	peerDeviceType,
	localAvatarSeed,
	localDeviceType,
	onDownload,
	onStartReceive,
}: {
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
	return (
		<div className={cn('flex gap-3 max-sm:gap-2', outgoing ? 'justify-end' : 'justify-start')}>
			{!outgoing && <DeviceAvatar type={peerDeviceType} avatarSeed={peerAvatarSeed} active />}
			<div className={cn('flex max-w-[calc(100%-58px)] flex-col space-y-2 sm:max-w-[72%]', outgoing ? 'items-end' : 'items-start')}>
				{!outgoing && <p className='text-secondary max-w-full truncate px-1 text-xs'>{peerName}</p>}
				{message.text && (
					<div className={cn('max-w-full break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm', outgoing ? 'bg-brand text-background' : 'bg-article text-primary')}>
						{message.text}
					</div>
				)}
				{message.attachments.length > 0 && (
					<div className={cn('max-w-full space-y-2', outgoing ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
						{message.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} onDownload={onDownload} onStartReceive={onStartReceive} />)}
					</div>
				)}
				{outgoing && <CheckCheck size={13} className={message.status === 'failed' ? 'text-red-400' : 'text-secondary'} />}
			</div>
			{outgoing && <DeviceAvatar type={localDeviceType} avatarSeed={localAvatarSeed} active />}
		</div>
	)
}

function TimeDivider({ value }: { value: number }) {
	return (
		<div className='flex justify-center py-2'>
			<span className='rounded-full bg-background/55 px-3 py-1 text-xs text-secondary'>{formatMessageTime(value)}</span>
		</div>
	)
}

function MessageList({
	messages,
	peerName,
	peerAvatarSeed,
	peerDeviceType,
	localAvatarSeed,
	localDeviceType,
	onDownload,
	onStartReceive,
}: {
	messages: LanChatMessage[]
	peerName: string
	peerAvatarSeed?: string
	peerDeviceType?: string
	localAvatarSeed?: string
	localDeviceType?: string
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	return (
		<>
			{messages.map((message, index) => (
				<div key={message.id} className='space-y-3'>
					{shouldShowTimeDivider(messages[index - 1], message) && <TimeDivider value={message.createdAt} />}
					<MessageBubble message={message} peerName={peerName} peerAvatarSeed={peerAvatarSeed} peerDeviceType={peerDeviceType} localAvatarSeed={localAvatarSeed} localDeviceType={localDeviceType} onDownload={onDownload} onStartReceive={onStartReceive} />
				</div>
			))}
		</>
	)
}

function InvitePanel({ controller }: { controller: LanController }) {
	if (!controller.session) return null
	if (controller.session.role !== 'host') {
		return (
			<div className='border-brand/20 bg-brand/5 rounded-3xl border p-4 text-center text-sm text-secondary'>
				等待主机二维码
			</div>
		)
	}
	return (
		<div className='border-brand/20 bg-brand/5 rounded-[24px] border border-dashed p-4 text-center shadow-sm'>
			<div className='lan-session-qr-canvas bg-article mx-auto flex size-[236px] items-center justify-center rounded-2xl border border-border shadow-sm'>
				{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='扫码连接' className='size-[210px]' /> : <span className='text-secondary text-sm'>生成中</span>}
			</div>
			<button onClick={() => void controller.copyInvite()} disabled={!controller.inviteLink} className='mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-article px-4 py-2.5 text-sm font-semibold transition hover:border-brand/45 disabled:opacity-50'>
				<Copy size={15} />
				复制链接
			</button>
		</div>
	)
}

function QrControlCard({
	controller,
	connectedCount,
	qrOpen,
	onToggleQr,
}: {
	controller: LanController
	connectedCount: number
	qrOpen: boolean
	onToggleQr: () => void
}) {
	const hasInvite = controller.session?.role === 'host'
	const status = connectedCount ? `${connectedCount}台` : hasInvite ? '等待' : '未创建'
	return (
		<div className='border-brand/20 bg-brand/5 text-brand rounded-3xl border p-3'>
			<div className='flex items-center gap-3'>
				<button onClick={onToggleQr} disabled={controller.busy} className='flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-1 text-left disabled:opacity-60' aria-label='二维码'>
					<div className='border-brand/20 bg-background/45 flex size-11 shrink-0 items-center justify-center rounded-2xl border'>
						<QrCode size={21} />
					</div>
					<div className='min-w-0 flex-1'>
						<div className='flex items-center justify-between gap-3'>
							<p className='truncate text-sm font-semibold'>二维码</p>
							<span className='shrink-0 text-sm font-medium'>{status}</span>
						</div>
						<p className='text-secondary mt-1 truncate text-xs'>{hasInvite ? '扫码连接' : '点击创建'}</p>
					</div>
				</button>
				<button
					onClick={event => {
						event.stopPropagation()
						void controller.copyInvite()
					}}
					disabled={!controller.inviteLink}
					className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-40'
					aria-label='复制链接'
				>
					<Copy size={16} />
				</button>
				<button onClick={onToggleQr} disabled={controller.busy} className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl border transition disabled:opacity-50', qrOpen ? 'border-primary/25 bg-brand text-primary shadow-sm' : 'border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary')} aria-label={qrOpen ? '隐藏二维码' : '显示二维码'}>
					<QrCode size={16} />
				</button>
			</div>
		</div>
	)
}

function ChatComposer({ connected, recorderState, onSendText, onSendFiles, onRecordStart, onRecordStop }: {
	connected: boolean
	recorderState: string
	onSendText: (text: string) => void
	onSendFiles: (files: File[], mode?: AttachmentAction) => void
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
		if (files.length) {
			event.preventDefault()
			onSendFiles(files, 'image')
		}
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
				<button onClick={() => fileInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'>
					<Paperclip size={19} />
				</button>
				<button onClick={() => imageInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'>
					<ImageIcon size={19} />
				</button>
				<button onClick={recorderState === 'recording' ? onRecordStop : onRecordStart} className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border transition', recorderState === 'recording' ? 'border-red-500 bg-red-500 text-white' : 'border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary')}>
					<Mic size={18} />
				</button>
				<input
					value={text}
					onPaste={handlePaste}
					onChange={event => setText(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault()
							submitText()
						}
					}}
					placeholder={connected ? '输入消息' : '连接后可发送'}
					className='min-w-0 flex-1 bg-transparent px-2 text-sm text-primary placeholder:text-secondary'
				/>
				<button onClick={submitText} disabled={!connected || !text.trim()} className='bg-brand text-background flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold disabled:opacity-50 sm:px-5'>
					<Send size={15} />
					发送
				</button>
			</div>
		</div>
	)
}

function ConnectionCard({
	connection,
	active,
	onSelect,
}: {
	connection: LanConnectionItem
	active: boolean
	onSelect: () => void
}) {
	return (
		<button onClick={onSelect} className={cn('flex w-full items-center gap-3 rounded-3xl border p-4 text-left shadow-sm transition', active ? 'border-brand/35 bg-brand/10' : 'border-border bg-article hover:border-brand/30')}>
			<DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active={connection.connected || active} />
			<div className='min-w-0 flex-1'>
				<p className='truncate text-sm font-semibold'>{connection.peer.name}</p>
				<p className='text-secondary mt-1 truncate text-xs'>{connectionStatusText(connection)}</p>
			</div>
			{connection.connected && <span className='bg-brand/15 text-brand rounded-full px-2 py-1 text-[11px] font-semibold'>在线</span>}
		</button>
	)
}

function WaitingConnectionCard({ controller, onToggleQr }: { controller: LanController; onToggleQr: () => void }) {
	return (
		<button onClick={onToggleQr} disabled={controller.busy} className='flex w-full items-center gap-3 rounded-3xl border border-border bg-article p-4 text-left shadow-sm transition hover:border-brand/30 disabled:opacity-60'>
			<DeviceAvatar active={false} />
			<div className='min-w-0 flex-1'>
				<p className='truncate text-sm font-semibold'>等待另一台设备</p>
				<p className='text-secondary mt-1 truncate text-xs'>{controller.session ? controller.roomStatus : '创建二维码，让另一台设备扫码'}</p>
			</div>
		</button>
	)
}

function DesktopSidebar({ controller, onSwitchRelay, qrOpen, onToggleQr }: { controller: LanController; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void }) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<aside className='hidden min-h-0 w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-background/30 p-5 lg:flex'>
			<div className='flex items-center justify-between'>
				<div>
					<p className='text-brand text-xs font-semibold tracking-[0.18em] uppercase'>局域网互传</p>
					<h2 className='mt-1 text-xl font-semibold'>连接设备</h2>
				</div>
				<div className='flex items-center gap-2'>
					{onSwitchRelay && (
						<button onClick={onSwitchRelay} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							中转站
						</button>
					)}
					{controller.session && (
						<button onClick={controller.leaveSession} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							退出
						</button>
					)}
					<button onClick={onToggleQr} disabled={controller.busy} className='text-secondary flex size-10 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-50' aria-label='创建或显示二维码'>
						<Plus size={20} />
					</button>
				</div>
			</div>
			<QrControlCard controller={controller} connectedCount={connectedCount} qrOpen={qrOpen} onToggleQr={onToggleQr} />
			{qrOpen && <InvitePanel controller={controller} />}
			<div className='min-h-0 flex-1 space-y-3'>
				<div className='flex items-center justify-between'>
					<p className='text-secondary text-xs font-medium'>当前连接</p>
					<span className='text-secondary text-xs'>{controller.connections.length} 台</span>
				</div>
				<div className='space-y-2'>
					{controller.connections.length ? (
						controller.connections.map(connection => (
							<ConnectionCard key={connection.peerId} connection={connection} active={controller.activePeerId === connection.peerId} onSelect={() => controller.selectConnection(connection.peerId)} />
						))
					) : (
						<WaitingConnectionCard controller={controller} onToggleQr={onToggleQr} />
					)}
				</div>
			</div>
		</aside>
	)
}

function ChatPane({
	controller,
	onBack,
}: {
	controller: LanController
	onBack?: () => void
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const activeConnection = controller.activeConnection
	const messages = activeConnection?.messages || []
	const lastMessage = messages[messages.length - 1]
	const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessage.attachments.length}:${lastMessage.attachments.some(item => item.previewUrl || item.url)}` : ''
	const peerName = activeConnection?.peer.name || '对方设备'
	const localPeer = controller.session?.localPeer
	const headerTitle = activeConnection?.peer.name || '等待连接'
	const headerStatus = activeConnection ? connectionStatusText(activeConnection) : controller.roomStatus

	useEffect(() => {
		const scrollToBottom = () => {
			const element = scrollRef.current
			if (element) element.scrollTop = element.scrollHeight
		}
		scrollToBottom()
		const timer = window.setTimeout(scrollToBottom, 80)
		return () => window.clearTimeout(timer)
	}, [controller.activePeerId, lastMessageKey])

	return (
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-border bg-article px-3 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)] sm:px-5'>
				<div className='flex min-w-0 items-center gap-3'>
					{onBack ? (
						<button onClick={onBack} className='text-secondary -ml-2 flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='返回设备'>
							<ChevronLeft size={25} />
						</button>
					) : (
						<DeviceAvatar type={activeConnection?.peer.deviceType} avatarSeed={activeConnection?.peer.avatarSeed} active={Boolean(activeConnection?.connected)} />
					)}
					<div className='min-w-0'>
						<h2 className='truncate text-base font-semibold'>{headerTitle}</h2>
						{!onBack && <p className='text-secondary truncate text-xs'>{headerStatus}</p>}
					</div>
				</div>
				<button onClick={() => controller.closeConnection()} disabled={!activeConnection} className='text-secondary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-40' aria-label='关闭当前会话'>
					<X size={17} />
				</button>
			</header>
			<div ref={scrollRef} className='min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>
				{activeConnection && messages.length > 0 && (
					<MessageList
						messages={messages}
						peerName={peerName}
						peerAvatarSeed={activeConnection.peer.avatarSeed}
						peerDeviceType={activeConnection.peer.deviceType}
						localAvatarSeed={localPeer?.avatarSeed}
						localDeviceType={localPeer?.deviceType}
						onDownload={controller.downloadAttachment}
						onStartReceive={controller.startReceivingAttachment}
					/>
				)}
			</div>
			<div className='shrink-0 p-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4'>
				<ChatComposer
					connected={controller.activeConnected}
					recorderState={controller.recorder.state}
					onSendText={controller.sendText}
					onSendFiles={(files, mode) => void controller.sendFiles(files, mode === 'image' ? 'image' : undefined)}
					onRecordStart={() => void controller.recorder.start().catch(error => alert(error instanceof Error ? error.message : '无法录音'))}
					onRecordStop={() => void controller.stopRecordingAndSend()}
				/>
			</div>
		</section>
	)
}

function DevicePage({
	controller,
	onOpenChat,
	onSwitchRelay,
	qrOpen,
	onToggleQr,
}: {
	controller: LanController
	onOpenChat: (peerId?: string) => void
	onSwitchRelay?: () => void
	qrOpen: boolean
	onToggleQr: () => void
}) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<div className='flex h-full min-h-0 flex-col bg-background/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-border bg-article px-4 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)]'>
				<h2 className='text-lg font-semibold'>设备</h2>
				<div className='flex items-center gap-2'>
					{onSwitchRelay && (
						<button onClick={onSwitchRelay} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							中转站
						</button>
					)}
					{controller.session && (
						<button onClick={controller.leaveSession} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							退出
						</button>
					)}
					<button onClick={onToggleQr} disabled={controller.busy} className='text-secondary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-50' aria-label='创建或显示二维码'>
						<RefreshCw size={17} />
					</button>
				</div>
			</header>
			<div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
				<QrControlCard controller={controller} connectedCount={connectedCount} qrOpen={qrOpen} onToggleQr={onToggleQr} />
				{qrOpen && <InvitePanel controller={controller} />}
				<div className='space-y-2'>
					<p className='text-secondary text-xs font-medium'>当前连接</p>
					{controller.connections.length ? (
						controller.connections.map(connection => (
							<button key={connection.peerId} onClick={() => onOpenChat(connection.peerId)} className={cn('flex w-full items-center gap-3 rounded-3xl border p-4 text-left shadow-sm', controller.activePeerId === connection.peerId ? 'border-brand/35 bg-brand/10' : 'border-border bg-article')}>
								<DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active={connection.connected} />
								<div className='min-w-0 flex-1'>
									<p className='truncate font-semibold'>{connection.peer.name}</p>
									<p className='text-secondary mt-1 truncate text-xs'>{connectionStatusText(connection)}</p>
								</div>
								<MessageCircle size={19} className='text-brand shrink-0' />
							</button>
						))
					) : (
						<WaitingConnectionCard controller={controller} onToggleQr={onToggleQr} />
					)}
				</div>
				<button onClick={onToggleQr} disabled={controller.busy} className='bg-brand text-background w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50'>
					{controller.session?.role === 'host' ? (qrOpen ? '隐藏二维码' : '显示二维码') : '创建配对码'}
				</button>
			</div>
		</div>
	)
}

function MobileShell({ controller, onSwitchRelay, qrOpen, onToggleQr }: { controller: LanController; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void }) {
	const [page, setPage] = useState<'devices' | 'chat'>('devices')
	return (
		<div className='h-full lg:hidden'>
			{page === 'chat' ? (
				<ChatPane controller={controller} onBack={() => setPage('devices')} />
			) : (
				<DevicePage
					controller={controller}
					onOpenChat={peerId => {
						if (peerId) controller.selectConnection(peerId)
						setPage('chat')
					}}
					onSwitchRelay={onSwitchRelay}
					qrOpen={qrOpen}
					onToggleQr={onToggleQr}
				/>
			)}
		</div>
	)
}

export function LanTransferTool({ initialInvite = null, onLeaveSession, onSwitchRelay }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })
	const [qrOpen, setQrOpen] = useState(false)
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		document.body.classList.add('lan-session-active')
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.classList.remove('lan-session-active')
			document.body.style.overflow = previousOverflow
		}
	}, [])

	useEffect(() => {
		if (!controller.session || controller.session.role !== 'host') setQrOpen(false)
	}, [controller.session])

	const handleToggleQr = () => {
		if (controller.session?.role === 'host') {
			setQrOpen(value => !value)
			return
		}
		void controller.handleCreateRoom().then(created => {
			if (created) setQrOpen(true)
		})
	}

	const app = (
		<div className='lan-session-v6 fixed inset-0 z-[999] h-[100dvh] overflow-hidden text-primary'>
			<div className='hidden h-full lg:grid lg:grid-cols-[360px_minmax(0,1fr)]'>
				<DesktopSidebar controller={controller} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} />
				<ChatPane controller={controller} />
			</div>
			<MobileShell controller={controller} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} />
		</div>
	)

	if (typeof document === 'undefined') return null
	return createPortal(app, document.body)
}
