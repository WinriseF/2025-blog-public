'use client'

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckCheck, ChevronLeft, Copy, Download, Image as ImageIcon, Laptop, MessageCircle, Mic, Monitor, Paperclip, Plus, QrCode, RefreshCw, Send, Smartphone, Wifi, X } from 'lucide-react'
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

function DeviceAvatar({ type = 'desktop', active = false }: { type?: string; active?: boolean }) {
	const Icon = type === 'phone' ? Smartphone : type === 'tablet' ? Monitor : Laptop
	return (
		<div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl border', active ? 'border-brand/25 bg-brand/10 text-brand' : 'border-border bg-background/40 text-primary')}>
			<Icon size={22} />
		</div>
	)
}

function progressLabel(value: number) {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
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
	const source = attachment.previewUrl || attachment.url
	const downloadableUrl = attachment.url || attachment.previewUrl
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const transferring = !complete && !failed
	const hasFooter = transferring || Boolean(attachment.error)
	if (!source) return null
	return (
		<div className='relative inline-block max-w-[360px] overflow-hidden rounded-2xl border border-border bg-article shadow-sm max-sm:max-w-[68vw]'>
			<img src={source} alt={attachment.name} className='block max-h-[420px] w-auto max-w-full object-contain max-sm:max-h-[48vh]' />
			{transferring && (
				<div className='absolute inset-x-0 bottom-0 bg-background/75 px-3 py-2 backdrop-blur'>
					<div className='mb-1 flex items-center justify-between text-[11px] font-medium text-primary'>
						<span>{attachment.status === 'offered' ? '等待下载' : attachment.status === 'receiving' ? '接收中' : '发送中'}</span>
						<span>{progressLabel(attachment.progress)}</span>
					</div>
					<div className='h-1 overflow-hidden rounded-full bg-background/50'>
						<div className='h-full rounded-full bg-brand transition-all' style={{ width: progressLabel(attachment.progress) }} />
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
	const displayName = compactFileName(attachment.name)
	const handleAction = () => {
		if (waitingReceive) return onStartReceive(attachment.id)
		if (attachment.url) onDownload(attachment.name, attachment.url)
	}
	return (
		<div className={cn('w-[320px] max-w-[72vw] rounded-xl px-4 py-3 shadow-sm sm:w-[390px]', failed ? 'border border-red-300 bg-red-500/10' : 'bg-article')}>
			<div className='flex min-w-0 items-center gap-4'>
				<div className='min-w-0 flex-1'>
					<p title={attachment.name} className='line-clamp-2 min-h-[2.9rem] break-all text-base font-semibold leading-[1.45] text-primary'>
						{displayName}
					</p>
					<p className='text-secondary mt-3 text-sm'>
						{formatBytes(attachment.size)}
						{attachment.kind === 'voice' && attachment.durationMs ? ` · ${Math.round(attachment.durationMs / 1000)} 秒` : ''}
					</p>
				</div>
				<button
					onClick={handleAction}
					disabled={!canAct}
					className='flex size-14 shrink-0 items-center justify-center rounded-md bg-brand/40 text-background transition hover:bg-brand/55 disabled:cursor-default disabled:opacity-55'
					aria-label={waitingReceive ? '接收文件' : '下载文件'}
				>
					<span className='flex size-9 items-center justify-center rounded-full bg-background/65 text-primary shadow-sm'>
						<Download size={20} />
					</span>
				</button>
			</div>
			{transferring && (
				<div className='mt-3 h-1.5 overflow-hidden rounded-full bg-background/40' title={progressLabel(attachment.progress)}>
					<div className='h-full rounded-full bg-brand transition-all' style={{ width: progressLabel(attachment.progress) }} />
				</div>
			)}
			{attachment.kind === 'voice' && attachment.url && <audio controls src={attachment.url} className='mt-3 h-9 w-full' />}
			{attachment.error && <p className='mt-2 text-xs text-red-500'>{attachment.error}</p>}
		</div>
	)
}

function AttachmentCard(props: AttachmentCardProps) {
	const imageSource = props.attachment.previewUrl || props.attachment.url
	if (props.attachment.kind === 'image' && imageSource) return <ImageAttachmentCard {...props} />
	return <FileAttachmentCard {...props} />
}

function MessageBubble({
	message,
	peerName,
	onDownload,
	onStartReceive,
}: {
	message: LanChatMessage
	peerName: string
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	if (message.direction === 'system') return <div className='mx-auto w-fit rounded-full border border-border bg-article px-3 py-1 text-xs text-secondary'>{message.text}</div>
	const outgoing = message.direction === 'out'
	return (
		<div className={cn('flex gap-3 max-sm:gap-2', outgoing ? 'justify-end' : 'justify-start')}>
			{!outgoing && <DeviceAvatar active />}
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
			{outgoing && <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-background'>我</div>}
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
	onDownload,
	onStartReceive,
}: {
	messages: LanChatMessage[]
	peerName: string
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	return (
		<>
			{messages.map((message, index) => (
				<div key={message.id} className='space-y-3'>
					{shouldShowTimeDivider(messages[index - 1], message) && <TimeDivider value={message.createdAt} />}
					<MessageBubble message={message} peerName={peerName} onDownload={onDownload} onStartReceive={onStartReceive} />
				</div>
			))}
		</>
	)
}

function EmptyChat({ onCreate, busy }: { onCreate: () => void; busy: boolean }) {
	return (
		<div className='border-brand/20 bg-brand/5 flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed p-5 text-center sm:min-h-[420px] sm:p-8'>
			<div className='border-brand/25 bg-brand/10 text-brand flex size-16 items-center justify-center rounded-3xl border'>
				<QrCode size={30} />
			</div>
			<h2 className='mt-4 text-xl font-semibold'>连接另一台设备</h2>
			<p className='text-secondary mt-2 max-w-[420px] text-sm leading-6'>扫码连接后即可发送消息和文件。收到文件时，点下载才会保存。</p>
			<button onClick={onCreate} disabled={busy} className='bg-brand text-background mt-5 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-50'>
				创建二维码
			</button>
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

function DesktopSidebar({ controller, onSwitchRelay }: { controller: ReturnType<typeof useLanTransferController>; onSwitchRelay?: () => void }) {
	const peerName = controller.remotePeer?.name || '等待另一台设备'
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
					<button onClick={controller.handleCreateRoom} className='text-secondary flex size-10 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'>
						<Plus size={20} />
					</button>
				</div>
			</div>
			<div className='border-brand/20 bg-brand/5 text-brand rounded-3xl border p-4'>
				<div className='flex items-center justify-between text-sm font-medium'>
					<span className='flex items-center gap-2'><Wifi size={16} />直接发送</span>
					<span>{controller.connected ? '在线' : '等待'}</span>
				</div>
				<p className='text-secondary mt-2 text-xs leading-5'>收到文件后，点击下载才会保存。</p>
			</div>
			<div className='space-y-3'>
				<p className='text-secondary text-xs font-medium'>当前连接</p>
				<div className='rounded-3xl border border-border bg-article p-4'>
					<div className='flex items-center gap-3'>
						<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
						<div className='min-w-0 flex-1'>
							<p className='truncate text-sm font-semibold'>{peerName}</p>
							<p className='text-secondary mt-1 text-xs'>{controller.connectionRoute || controller.status}</p>
						</div>
					</div>
					{controller.session?.role === 'host' && (
						<div className='mt-4 rounded-2xl border border-border bg-background/40 p-3 text-center'>
							{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='配对二维码' className='mx-auto size-36' /> : <div className='text-secondary flex h-36 items-center justify-center text-xs'>生成二维码中</div>}
							<button onClick={() => void controller.copyInvite()} className='mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45'>
								<Copy size={14} />复制链接
							</button>
						</div>
					)}
				</div>
			</div>
		</aside>
	)
}

function ChatPane({
	controller,
	onBack,
	showEmptyCreate = true,
}: {
	controller: ReturnType<typeof useLanTransferController>
	onBack?: () => void
	showEmptyCreate?: boolean
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const lastMessage = controller.messages[controller.messages.length - 1]
	const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessage.attachments.length}:${lastMessage.attachments.some(item => item.previewUrl || item.url)}` : ''
	const peerName = controller.remotePeer?.name || '对方设备'

	useEffect(() => {
		const scrollToBottom = () => {
			const element = scrollRef.current
			if (element) element.scrollTop = element.scrollHeight
		}
		scrollToBottom()
		const timer = window.setTimeout(scrollToBottom, 80)
		return () => window.clearTimeout(timer)
	}, [lastMessageKey])

	return (
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-border bg-article px-3 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)] sm:px-5'>
				<div className='flex min-w-0 items-center gap-3'>
					{onBack ? (
						<button onClick={onBack} className='text-secondary -ml-2 flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='返回设备'>
							<ChevronLeft size={25} />
						</button>
					) : (
						<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
					)}
					<div className='min-w-0'>
						<h2 className='truncate text-base font-semibold'>{controller.remotePeer?.name || '等待连接'}</h2>
						{!onBack && <p className='text-secondary truncate text-xs'>{controller.connected ? controller.connectionRoute || '已连接' : controller.status}</p>}
					</div>
				</div>
				<button onClick={controller.leaveSession} className='text-secondary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='离开会话'>
					<X size={17} />
				</button>
			</header>
			<div ref={scrollRef} className='min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>
				{controller.session ? (
					controller.messages.length ? <MessageList messages={controller.messages} peerName={peerName} onDownload={controller.downloadAttachment} onStartReceive={controller.startReceivingAttachment} /> : <div className='text-secondary py-20 text-center text-sm'>还没有消息</div>
				) : !showEmptyCreate ? (
					<div className='text-secondary py-20 text-center text-sm'>先在设备页创建或连接设备</div>
				) : (
					<EmptyChat onCreate={controller.handleCreateRoom} busy={controller.busy} />
				)}
			</div>
			<div className='shrink-0 border-t border-border bg-article p-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4'>
				<ChatComposer
					connected={controller.connected}
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
}: {
	controller: ReturnType<typeof useLanTransferController>
	onOpenChat: () => void
	onSwitchRelay?: () => void
}) {
	const peerName = controller.remotePeer?.name || '等待扫码设备'
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
					<button onClick={controller.handleCreateRoom} disabled={controller.busy} className='text-secondary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-50' aria-label='创建配对码'>
						<RefreshCw size={17} />
					</button>
				</div>
			</header>
			<div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
				<div className='border-brand/20 bg-brand/5 text-brand rounded-2xl border px-4 py-3 text-sm font-medium'>{controller.status}</div>
				<button onClick={controller.session ? onOpenChat : undefined} className='flex w-full items-center gap-3 rounded-3xl border border-border bg-article p-4 text-left shadow-sm disabled:cursor-default' disabled={!controller.session}>
					<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
					<div className='min-w-0 flex-1'>
						<p className='truncate font-semibold'>{peerName}</p>
						<p className='text-secondary mt-1 truncate text-xs'>{controller.connected ? controller.connectionRoute || '在线' : connectionLabel[controller.connectionState]}</p>
					</div>
					{controller.session && <MessageCircle size={19} className='text-brand shrink-0' />}
				</button>
				{controller.session?.role === 'host' && (
					<div className='rounded-3xl border border-border bg-article p-4 text-center shadow-sm'>
						{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='扫码连接' className='mx-auto size-48' /> : <div className='text-secondary flex h-48 items-center justify-center'>生成二维码中</div>}
						<button onClick={() => void controller.copyInvite()} className='bg-brand text-background mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold'>复制链接</button>
					</div>
				)}
				<button onClick={controller.session ? onOpenChat : controller.handleCreateRoom} disabled={controller.busy} className='bg-brand text-background w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50'>
					{controller.session ? '进入聊天' : '创建配对码'}
				</button>
			</div>
		</div>
	)
}

function MobileShell({ controller, onSwitchRelay }: { controller: ReturnType<typeof useLanTransferController>; onSwitchRelay?: () => void }) {
	const [page, setPage] = useState<'devices' | 'chat'>('devices')
	return (
		<div className='h-full lg:hidden'>
			{page === 'chat' ? (
				<ChatPane controller={controller} onBack={() => setPage('devices')} showEmptyCreate={false} />
			) : (
				<DevicePage controller={controller} onOpenChat={() => setPage('chat')} onSwitchRelay={onSwitchRelay} />
			)}
		</div>
	)
}

export function LanTransferTool({ initialInvite = null, onLeaveSession, onSwitchRelay }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = previousOverflow
		}
	}, [])

	const app = (
		<div className='lan-session-v5 fixed inset-0 z-[999] h-[100dvh] overflow-hidden bg-bg text-primary'>
			<div className='hidden h-full lg:grid lg:grid-cols-[360px_minmax(0,1fr)]'>
				<DesktopSidebar controller={controller} onSwitchRelay={onSwitchRelay} />
				<ChatPane controller={controller} />
			</div>
			<MobileShell controller={controller} onSwitchRelay={onSwitchRelay} />
		</div>
	)

	if (typeof document === 'undefined') return null
	return createPortal(app, document.body)
}
