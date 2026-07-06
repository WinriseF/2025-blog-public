'use client'

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { CheckCheck, Copy, Folder, Image as ImageIcon, Laptop, MessageCircle, Mic, Monitor, Paperclip, Plus, QrCode, RefreshCw, Send, Smartphone, Trash2, Wifi, X } from 'lucide-react'
import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanAttachment, LanChatMessage, LanFileRecord } from '@/lib/lan-transfer/types'
import { useLanTransferController } from './use-lan-transfer-controller'

type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
	onLeaveSession?: () => void
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

const fileStatusLabel: Record<LanAttachment['status'], string> = {
	queued: '排队中',
	offered: '待下载',
	receiving: '接收中',
	sending: '发送中',
	complete: '已完成',
	failed: '失败',
	cancelled: '已取消',
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
			{!outgoing && <div className='max-sm:hidden'><DeviceAvatar active /></div>}
			<div className={`flex max-w-[88%] flex-col space-y-2 sm:max-w-[76%] ${outgoing ? 'items-end' : 'items-start'}`}>
				{message.text && (
					<div className={`rounded-2xl border px-4 py-3 text-sm leading-6 shadow-sm ${outgoing ? 'border-pink-200 bg-pink-50/90' : 'border-border bg-white/85'}`}>
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
			{outgoing && <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-rose-400 text-white max-sm:hidden'>我</div>}
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
		<aside className='hidden w-[310px] shrink-0 flex-col gap-4 border-r border-pink-100/70 bg-white/45 p-5 lg:flex'>
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

function ChatPane({ controller }: { controller: ReturnType<typeof useLanTransferController> }) {
	return (
		<section className='flex min-h-[680px] min-w-0 flex-1 flex-col bg-white/30 max-lg:min-h-[calc(100svh-172px)]'>
			<header className='flex items-center justify-between border-b border-pink-100/70 bg-white/50 px-3 py-3 sm:px-5 sm:py-4'>
				<div className='flex min-w-0 items-center gap-3'>
					<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
					<div className='min-w-0'>
						<h2 className='truncate text-base font-semibold'>{controller.remotePeer?.name || '等待连接'}</h2>
						<p className='text-secondary truncate text-xs'>{controller.connected ? controller.connectionRoute || '已连接' : controller.status}</p>
					</div>
				</div>
				<button onClick={controller.leaveSession} className='text-secondary hover:text-pink-500 flex size-9 items-center justify-center rounded-full border border-border bg-white/60'>
					<X size={17} />
				</button>
			</header>
			<div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>
				{controller.session ? (
					controller.messages.length ? controller.messages.map(message => <MessageBubble key={message.id} message={message} onDownload={controller.downloadAttachment} onStartReceive={controller.startReceivingAttachment} />) : <div className='text-secondary py-20 text-center text-sm'>还没有消息</div>
				) : (
					<EmptyChat onCreate={controller.handleCreateRoom} busy={controller.busy} />
				)}
			</div>
			<div className='border-t border-pink-100/70 bg-white/45 p-3 sm:p-4'>
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

function DevicePage({ controller }: { controller: ReturnType<typeof useLanTransferController> }) {
	return (
		<div className='space-y-4 p-4'>
			<div className='flex items-center justify-between'>
				<h2 className='text-lg font-semibold'>设备</h2>
				<button onClick={controller.handleCreateRoom} className='flex size-9 items-center justify-center rounded-full border border-border bg-white/70 text-pink-500'>
					<RefreshCw size={17} />
				</button>
			</div>
			<div className='rounded-2xl bg-pink-50 px-4 py-3 text-sm font-medium text-pink-500'>{controller.status}</div>
			<div className='space-y-3'>
				<p className='text-secondary text-xs'>当前连接</p>
				<div className='flex items-center gap-3 rounded-3xl bg-white/75 p-4'>
					<DeviceAvatar type={controller.remotePeer?.deviceType} active={controller.connected} />
					<div className='min-w-0 flex-1'>
						<p className='truncate font-semibold'>{controller.remotePeer?.name || '等待扫码设备'}</p>
						<p className='text-secondary mt-1 text-xs'>{controller.connected ? '在线' : connectionLabel[controller.connectionState]}</p>
					</div>
					{controller.connected && <span className='rounded-full bg-pink-100 px-2 py-1 text-xs text-pink-500'>已连接</span>}
				</div>
			</div>
			{controller.session?.role === 'host' && (
				<div className='rounded-3xl bg-white/75 p-4 text-center'>
					{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='扫码连接' className='mx-auto size-48' /> : <div className='text-secondary flex h-48 items-center justify-center'>生成二维码中</div>}
					<button onClick={() => void controller.copyInvite()} className='mt-3 w-full rounded-2xl bg-pink-500 px-4 py-3 text-sm font-semibold text-white'>复制链接</button>
				</div>
			)}
			<button onClick={controller.handleCreateRoom} className='w-full rounded-2xl bg-pink-500 px-4 py-3 text-sm font-semibold text-white'>创建配对码</button>
		</div>
	)
}

function FilePage({ records, onDownload, onClear }: { records: LanFileRecord[]; onDownload: (name: string, url: string) => void; onClear: (id: string) => void }) {
	return (
		<div className='space-y-4 p-4'>
			<div className='flex items-center justify-between'>
				<h2 className='text-lg font-semibold'>文件</h2>
			</div>
			{records.length ? records.map(record => (
				<div key={record.id} className='flex items-center gap-3 rounded-2xl bg-white/75 p-3'>
					<FileIcon kind={record.kind} name={record.name} />
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm font-semibold'>{record.name}</p>
						<p className='text-secondary mt-1 text-xs'>{formatBytes(record.size)} · {record.direction === 'out' ? '来自我' : `来自 ${record.peerName || '设备'}`} · {fileStatusLabel[record.status]}</p>
					</div>
					{record.url && <button onClick={() => onDownload(record.name, record.url || '')} className='rounded-full border border-border px-2 py-1 text-xs'>下载</button>}
					<button onClick={() => onClear(record.id)} className='text-secondary hover:text-red-500'><Trash2 size={15} /></button>
				</div>
			)) : <div className='text-secondary rounded-3xl bg-white/65 p-8 text-center text-sm'>文件会出现在这里。</div>}
		</div>
	)
}

function MobileShell({ controller }: { controller: ReturnType<typeof useLanTransferController> }) {
	const tabs = [
		{ id: 'chats' as const, icon: MessageCircle, label: '会话' },
		{ id: 'devices' as const, icon: Monitor, label: '设备' },
		{ id: 'files' as const, icon: Folder, label: '文件' },
	]
	return (
		<div className='lg:hidden'>
			{controller.activeMobileTab === 'chats' && <ChatPane controller={controller} />}
			{controller.activeMobileTab === 'devices' && <DevicePage controller={controller} />}
			{controller.activeMobileTab === 'files' && <FilePage records={controller.fileRecords} onDownload={controller.downloadAttachment} onClear={controller.clearFileRecord} />}
			<nav className='fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-[640px] grid-cols-3 border-t border-border bg-white/90 px-6 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 text-xs shadow-[0_-18px_50px_-40px_rgba(0,0,0,.35)] backdrop-blur'>
				{tabs.map(tab => {
					const Icon = tab.icon
					return (
						<button key={tab.id} onClick={() => controller.setActiveMobileTab(tab.id)} className={`flex flex-col items-center gap-1 py-1 ${controller.activeMobileTab === tab.id ? 'text-pink-500' : 'text-secondary'}`}>
							<Icon size={20} />
							<span>{tab.label}</span>
						</button>
					)
				})}
			</nav>
		</div>
	)
}

export function LanTransferTool({ initialInvite = null, onLeaveSession }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })
	return (
		<div className='lan-session-v4 -m-3 overflow-hidden rounded-[32px] border border-pink-100 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,.18),transparent_36%),linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,245,249,.72))] shadow-[0_30px_90px_-58px_rgba(236,72,153,.55)] max-sm:m-0 max-sm:rounded-none max-sm:border-0 max-sm:pb-20'>
			<div className='hidden min-h-[720px] lg:flex'>
				<DesktopSidebar controller={controller} />
				<ChatPane controller={controller} />
				<aside className='hidden w-[320px] shrink-0 border-l border-pink-100/70 bg-white/45 p-5 xl:block'>
					<FilePage records={controller.fileRecords} onDownload={controller.downloadAttachment} onClear={controller.clearFileRecord} />
				</aside>
			</div>
			<MobileShell controller={controller} />
		</div>
	)
}
