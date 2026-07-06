'use client'

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { CheckCheck, ChevronLeft, Copy, Image as ImageIcon, Laptop, MessageCircle, Mic, Monitor, Paperclip, Plus, QrCode, RefreshCw, Send, Smartphone, Wifi, X } from 'lucide-react'
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
		<div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border ${active ? 'border-pink-200 bg-pink-50 text-pink-500' : 'border-border bg-white/70 text-primary'}`}>
			<Icon size={22} />
		</div>
	)
}

function fileTone(kind: LanAttachment['kind']) {
	if (kind === 'image') return 'from-sky-400 to-blue-500'
	if (kind === 'voice') return 'from-violet-400 to-fuchsia-500'
	return 'from-emerald-400 to-teal-500'
}

function FileIcon({ kind, name }: { kind: LanAttachment['kind']; name: string }) {
	return (
		<div className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${fileTone(kind)} text-xs font-bold text-white shadow-sm`}>
			{kind === 'image' ? 'IMG' : kind === 'voice' ? 'MIC' : name.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}
		</div>
	)
}

function progressLabel(value: number) {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function AttachmentCard({
	attachment,
	onDownload,
	onStartReceive,
}: {
	attachment: LanAttachment
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	const complete = attachment.status === 'complete'
	const failed = attachment.status === 'failed' || attachment.status === 'cancelled'
	const waitingReceive = attachment.direction === 'in' && attachment.status === 'offered'
	const transferring = !complete && !failed && !waitingReceive
	return (
		<div className={`w-full min-w-0 max-w-full rounded-2xl border p-3 sm:min-w-[260px] ${failed ? 'border-red-200 bg-red-50/70' : complete ? 'border-emerald-200 bg-emerald-50/70' : 'border-pink-200 bg-pink-50/80'}`}>
			<div className='flex items-center gap-3'>
				{attachment.previewUrl ? (
					<img src={attachment.previewUrl} alt={attachment.name} className='size-14 shrink-0 rounded-xl object-cover' />
				) : (
					<FileIcon kind={attachment.kind} name={attachment.name} />
				)}
				<div className='min-w-0 flex-1'>
					<p className='truncate text-sm font-semibold'>{attachment.name}</p>
					<p className='text-secondary mt-1 text-xs'>
						{formatBytes(attachment.size)}
						{attachment.kind === 'voice' && attachment.durationMs ? ` · ${Math.round(attachment.durationMs / 1000)} 秒` : ''}
						{complete ? ' · 已完成' : failed ? ' · 失败' : ''}
					</p>
				</div>
				{transferring && <span className='text-lg font-semibold'>{progressLabel(attachment.progress)}</span>}
			</div>
			{transferring && (
				<div className='mt-3 h-1.5 overflow-hidden rounded-full bg-white/70'>
					<div className='h-full rounded-full bg-pink-500 transition-all' style={{ width: progressLabel(attachment.progress) }} />
				</div>
			)}
			{waitingReceive && (
				<div className='mt-3 flex justify-end'>
					<button onClick={() => onStartReceive(attachment.id)} className='rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-pink-600'>
						下载
					</button>
				</div>
			)}
			{attachment.url && (
				<div className='mt-3 space-y-2'>
					{attachment.kind === 'voice' && <audio controls src={attachment.url} className='h-9 w-full' />}
					<button onClick={() => onDownload(attachment.name, attachment.url || '')} className='rounded-full border border-emerald-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-600'>
						下载
					</button>
				</div>
			)}
			{attachment.error && <p className='mt-2 text-xs text-red-500'>{attachment.error}</p>}
		</div>
	)
}

function MessageBubble({
	message,
	onDownload,
	onStartReceive,
}: {
	message: LanChatMessage
	onDownload: (name: string, url: string) => void
	onStartReceive: (id: string) => void
}) {
	if (message.direction === 'system') return <div className='mx-auto w-fit rounded-full bg-white/60 px-3 py-1 text-xs text-secondary'>{message.text}</div>
	const outgoing = message.direction === 'out'
	return (
		<div className={`flex gap-3 max-sm:gap-2 ${outgoing ? 'justify-end' : 'justify-start'}`}>
			{!outgoing && <DeviceAvatar active />}
			<div className={`flex max-w-[calc(100%-64px)] flex-col space-y-2 sm:max-w-[76%] ${outgoing ? 'items-end' : 'items-start'}`}>
				{message.text && (
					<div className={`break-words rounded-2xl border px-4 py-3 text-sm leading-6 shadow-sm ${outgoing ? 'border-pink-200 bg-pink-50/90' : 'border-border bg-white/85'}`}>
						{message.text}
					</div>
				)}
				{message.attachments.length > 0 && (
					<div className='w-full max-w-full space-y-2'>
						{message.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} onDownload={onDownload} onStartReceive={onStartReceive} />)}
					</div>
				)}
				<div className={`flex items-center gap-1 text-[11px] text-secondary ${outgoing ? 'justify-end' : 'justify-start'}`}>
					<span>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
					{outgoing && <CheckCheck size={13} className={message.status === 'failed' ? 'text-red-400' : 'text-pink-500'} />}
				</div>
			</div>
			{outgoing && <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-rose-400 text-white'>我</div>}
		</div>
	)
}

function EmptyChat({ onCreate, busy }: { onCreate: () => void; busy: boolean }) {
	return (
		<div className='flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-pink-200 bg-white/40 p-5 text-center sm:min-h-[420px] sm:p-8'>
			<div className='flex size-16 items-center justify-center rounded-3xl bg-pink-50 text-pink-500'>
				<QrCode size={30} />
			</div>
			<h2 className='mt-4 text-xl font-semibold'>连接另一台设备</h2>
			<p className='text-secondary mt-2 max-w-[420px] text-sm leading-6'>扫码连接后即可发送消息和文件。收到文件时，点下载才会保存。</p>
			<button onClick={onCreate} disabled={busy} className='mt-5 rounded-2xl bg-pink-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-24px_#ec4899] disabled:opacity-50'>
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
		<div onDragOver={event => event.preventDefault()} onDrop={handleDrop} className='rounded-2xl border border-border bg-white/80 p-3 shadow-sm backdrop-blur sm:rounded-3xl'>
			<input ref={fileInputRef} type='file' multiple className='hidden' onChange={event => handleFiles(event, 'file')} />
			<input ref={imageInputRef} type='file' multiple accept='image/*' className='hidden' onChange={event => handleFiles(event, 'image')} />
			<div className='flex items-center gap-2'>
				<button onClick={() => fileInputRef.current?.click()} className='text-secondary hover:text-pink-500 flex size-9 shrink-0 items-center justify-center rounded-full'>
					<Paperclip size={19} />
				</button>
				<button onClick={() => imageInputRef.current?.click()} className='text-secondary hover:text-pink-500 flex size-9 shrink-0 items-center justify-center rounded-full'>
					<ImageIcon size={19} />
				</button>
				<button onClick={recorderState === 'recording' ? onRecordStop : onRecordStart} className={`flex size-9 shrink-0 items-center justify-center rounded-full ${recorderState === 'recording' ? 'bg-red-500 text-white' : 'text-secondary hover:text-pink-500'}`}>
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
					className='min-w-0 flex-1 bg-transparent px-2 text-sm'
				/>
				<button onClick={submitText} disabled={!connected || !text.trim()} className='flex shrink-0 items-center gap-2 rounded-2xl bg-pink-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-45 sm:px-5'>
					<Send size={15} />
					发送
				</button>
			</div>
		</div>
	)
}

function DesktopSidebar({ controller }: { controller: ReturnType<typeof useLanTransferController> }) {
	const peerName = controller.remotePeer?.name || '等待另一台设备'
	return (
		<aside className='hidden min-h-0 w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-pink-100/70 bg-white/50 p-5 lg:flex'>
			<div className='flex items-center justify-between'>
				<div>
					<p className='text-xs font-semibold tracking-[0.18em] text-pink-500 uppercase'>局域网互传</p>
					<h2 className='mt-1 text-xl font-semibold'>连接设备</h2>
				</div>
				<button onClick={controller.handleCreateRoom} className='flex size-10 items-center justify-center rounded-full border border-pink-100 bg-white/70 text-pink-500'>
					<Plus size={20} />
				</button>
			</div>
			<div className='rounded-3xl border border-pink-100 bg-pink-50/70 p-4'>
				<div className='flex items-center justify-between text-sm font-medium text-pink-600'>
					<span className='flex items-center gap-2'><Wifi size={16} />直接发送</span>
					<span>{controller.connected ? '在线' : '等待'}</span>
				</div>
				<p className='text-secondary mt-2 text-xs leading-5'>收到文件后，点击下载才会保存。</p>
			</div>
			<div className='space-y-3'>
				<p className='text-secondary text-xs font-medium'>当前连接</p>
				<div className='rounded-3xl border border-pink-100 bg-white/70 p-4'>
					<div className='flex items-center gap-3'>
						<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
						<div className='min-w-0 flex-1'>
							<p className='truncate text-sm font-semibold'>{peerName}</p>
							<p className='text-secondary mt-1 text-xs'>{controller.connectionRoute || controller.status}</p>
						</div>
					</div>
					{controller.session?.role === 'host' && (
						<div className='mt-4 rounded-2xl bg-white p-3 text-center'>
							{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='配对二维码' className='mx-auto size-36' /> : <div className='text-secondary flex h-36 items-center justify-center text-xs'>生成二维码中</div>}
							<button onClick={() => void controller.copyInvite()} className='mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-pink-100 px-3 py-2 text-xs text-pink-500'>
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
	return (
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-pink-100/70 bg-white/55 px-3 sm:px-5'>
				<div className='flex min-w-0 items-center gap-3'>
					{onBack ? (
						<button onClick={onBack} className='text-primary -ml-2 flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/70' aria-label='返回设备'>
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
				<button onClick={controller.leaveSession} className='text-secondary hover:text-pink-500 flex size-9 items-center justify-center rounded-full border border-border bg-white/60' aria-label='离开会话'>
					<X size={17} />
				</button>
			</header>
			<div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>
				{controller.session ? (
					controller.messages.length ? controller.messages.map(message => <MessageBubble key={message.id} message={message} onDownload={controller.downloadAttachment} onStartReceive={controller.startReceivingAttachment} />) : <div className='text-secondary py-20 text-center text-sm'>还没有消息</div>
				) : !showEmptyCreate ? (
					<div className='text-secondary py-20 text-center text-sm'>先在设备页创建或连接设备</div>
				) : (
					<EmptyChat onCreate={controller.handleCreateRoom} busy={controller.busy} />
				)}
			</div>
			<div className='shrink-0 border-t border-pink-100/70 bg-white/45 p-3 sm:p-4'>
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
		<div className='flex h-full min-h-0 flex-col bg-white/35'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-pink-100/70 bg-white/55 px-4'>
				<h2 className='text-lg font-semibold'>设备</h2>
				<div className='flex items-center gap-2'>
					{onSwitchRelay && (
						<button onClick={onSwitchRelay} className='rounded-full border border-border bg-white/70 px-3 py-2 text-xs font-medium text-secondary'>
							中转站
						</button>
					)}
					<button onClick={controller.handleCreateRoom} disabled={controller.busy} className='flex size-9 items-center justify-center rounded-full border border-border bg-white/70 text-pink-500 disabled:opacity-50' aria-label='创建配对码'>
						<RefreshCw size={17} />
					</button>
				</div>
			</header>
			<div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
				<div className='rounded-2xl bg-pink-50 px-4 py-3 text-sm font-medium text-pink-500'>{controller.status}</div>
				<button onClick={controller.session ? onOpenChat : undefined} className='flex w-full items-center gap-3 rounded-3xl bg-white/80 p-4 text-left shadow-sm disabled:cursor-default' disabled={!controller.session}>
					<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
					<div className='min-w-0 flex-1'>
						<p className='truncate font-semibold'>{peerName}</p>
						<p className='text-secondary mt-1 truncate text-xs'>{controller.connected ? controller.connectionRoute || '在线' : connectionLabel[controller.connectionState]}</p>
					</div>
					{controller.session && <MessageCircle size={19} className='shrink-0 text-pink-500' />}
				</button>
				{controller.session?.role === 'host' && (
					<div className='rounded-3xl bg-white/75 p-4 text-center shadow-sm'>
						{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='扫码连接' className='mx-auto size-48' /> : <div className='text-secondary flex h-48 items-center justify-center'>生成二维码中</div>}
						<button onClick={() => void controller.copyInvite()} className='mt-3 w-full rounded-2xl bg-pink-500 px-4 py-3 text-sm font-semibold text-white'>复制链接</button>
					</div>
				)}
				<button onClick={controller.session ? onOpenChat : controller.handleCreateRoom} disabled={controller.busy} className='w-full rounded-2xl bg-pink-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50'>
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
	return (
		<div className='lan-session-v4 -m-3 overflow-hidden rounded-[32px] border border-pink-100 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,.18),transparent_36%),linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,245,249,.72))] shadow-[0_30px_90px_-58px_rgba(236,72,153,.55)] max-sm:m-0 max-sm:h-[calc(100svh-6rem)] max-sm:rounded-none max-sm:border-0'>
			<div className='hidden h-[calc(100svh-230px)] min-h-[560px] max-h-[780px] lg:grid lg:grid-cols-[320px_minmax(0,1fr)]'>
				<DesktopSidebar controller={controller} />
				<ChatPane controller={controller} />
			</div>
			<MobileShell controller={controller} onSwitchRelay={onSwitchRelay} />
		</div>
	)
}
