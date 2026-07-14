'use client'

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Copy, Image as ImageIcon, MessageCircle, Mic, PanelLeftClose, Paperclip, QrCode, Send, X } from 'lucide-react'
import { MessageList } from './lan-chat-message-list'
import { LanTransferDiagnosticsMenu } from './lan-transfer-diagnostics'
import { cn, connectionStatusText, DeviceAvatar, type LanConnectionItem, type LanController } from './lan-transfer-ui'
import { useLanTransferController } from './use-lan-transfer-controller'

type LanTransferToolProps = {
	initialInvite?: { roomId: string; token: string } | null
	entryOrigin?: { x: number; y: number } | null
	onLeaveSession?: () => void
	onSwitchRelay?: () => void
}

type AttachmentAction = 'file' | 'image'

function InvitePanel({ controller }: { controller: LanController }) {
	if (!controller.session) return null
	if (controller.session.role !== 'host') return <div className='border-brand/20 bg-brand/5 rounded-3xl border p-4 text-center text-sm text-secondary'>等待主机二维码</div>
	return (
		<div className='border-brand/20 bg-brand/5 rounded-[24px] border border-dashed p-4 text-center shadow-sm'>
			<div className='lan-session-qr-canvas bg-article mx-auto flex size-[236px] items-center justify-center rounded-2xl border border-border shadow-sm'>
				{controller.qrDataUrl ? <img src={controller.qrDataUrl} alt='扫码连接' className='size-[210px]' /> : <span className='text-secondary text-sm'>生成中</span>}
			</div>
			<button onClick={() => void controller.copyInvite()} disabled={!controller.inviteLink} className='mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-article px-4 py-2.5 text-sm font-semibold transition hover:border-brand/45 disabled:opacity-50'><Copy size={15} />复制链接</button>
		</div>
	)
}

function QrControlCard({ controller, connectedCount, qrOpen, onToggleQr }: { controller: LanController; connectedCount: number; qrOpen: boolean; onToggleQr: () => void }) {
	const hasInvite = controller.session?.role === 'host'
	const status = connectedCount ? `${connectedCount}台` : hasInvite ? '等待' : '未创建'
	return (
		<div className='border-brand/20 bg-brand/5 text-brand rounded-3xl border p-3'>
			<div className='flex items-center gap-3'>
				<button onClick={onToggleQr} disabled={controller.busy} className='flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-1 text-left disabled:opacity-60' aria-label='二维码'>
					<div className='border-brand/20 bg-background/45 flex size-11 shrink-0 items-center justify-center rounded-2xl border'><QrCode size={21} /></div>
					<div className='min-w-0 flex-1'><div className='flex items-center justify-between gap-3'><p className='truncate text-sm font-semibold'>二维码</p><span className='shrink-0 text-sm font-medium'>{status}</span></div><p className='text-secondary mt-1 truncate text-xs'>{hasInvite ? '扫码连接' : '点击创建'}</p></div>
				</button>
				<button onClick={event => { event.stopPropagation(); void controller.copyInvite() }} disabled={!controller.inviteLink} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-40' aria-label='复制链接'><Copy size={16} /></button>
				<button onClick={onToggleQr} disabled={controller.busy} className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl border transition disabled:opacity-50', qrOpen ? 'border-primary/25 bg-brand text-primary shadow-sm' : 'border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary')} aria-label={qrOpen ? '隐藏二维码' : '显示二维码'}><QrCode size={16} /></button>
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
		if (files.length) { event.preventDefault(); onSendFiles(files, 'image') }
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
				<button onClick={() => fileInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'><Paperclip size={19} /></button>
				<button onClick={() => imageInputRef.current?.click()} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary'><ImageIcon size={19} /></button>
				<button onClick={recorderState === 'recording' ? onRecordStop : onRecordStart} className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border transition', recorderState === 'recording' ? 'border-red-500 bg-red-500 text-white' : 'border-border bg-background/40 text-secondary hover:border-brand/45 hover:text-primary')}><Mic size={18} /></button>
				<input value={text} onPaste={handlePaste} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitText() } }} placeholder={connected ? '输入消息' : '连接后可发送'} className='min-w-0 flex-1 bg-transparent px-2 text-sm text-primary placeholder:text-secondary' />
				<button onClick={submitText} disabled={!connected || !text.trim()} className='bg-brand text-background flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold disabled:opacity-50 sm:px-5'><Send size={15} />发送</button>
			</div>
		</div>
	)
}

function ConnectionCard({ connection, active, onSelect, collapsed = false }: { connection: LanConnectionItem; active: boolean; onSelect: () => void; collapsed?: boolean }) {
	return (
		<button onClick={onSelect} title={collapsed ? `${connection.peer.name} · ${connectionStatusText(connection)}` : undefined} className={cn('flex items-center border shadow-sm transition', collapsed ? 'size-14 justify-center rounded-full p-1' : 'w-full gap-3 rounded-3xl p-4 text-left', active ? 'border-brand/35 bg-brand/10' : 'border-border bg-article hover:border-brand/30')}>
			<DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active={connection.connected || active} />
			{!collapsed && <><div className='min-w-0 flex-1'><p className='truncate text-sm font-semibold'>{connection.peer.name}</p><p className='text-secondary mt-1 truncate text-xs'>{connectionStatusText(connection)}</p></div>{connection.connected && <span className='bg-brand/15 text-brand rounded-full px-2 py-1 text-[11px] font-semibold'>在线</span>}</>}
		</button>
	)
}

function WaitingConnectionCard({ controller, onToggleQr }: { controller: LanController; onToggleQr: () => void }) {
	return <button onClick={onToggleQr} disabled={controller.busy} className='flex w-full items-center gap-3 rounded-3xl border border-border bg-article p-4 text-left shadow-sm transition hover:border-brand/30 disabled:opacity-60'><DeviceAvatar /><div className='min-w-0 flex-1'><p className='truncate text-sm font-semibold'>等待另一台设备</p><p className='text-secondary mt-1 truncate text-xs'>{controller.session ? controller.roomStatus : '创建二维码，让另一台设备扫码'}</p></div></button>
}

function DesktopSidebar({ controller, onSwitchRelay, qrOpen, onToggleQr, collapsed, onToggleCollapse }: { controller: LanController; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void; collapsed: boolean; onToggleCollapse: () => void }) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<aside className='relative hidden min-h-0 w-full overflow-hidden border-r border-border bg-background/30 lg:block'>
			<button onClick={onToggleCollapse} className={cn('text-secondary absolute top-7 z-10 flex size-9 items-center justify-center rounded-full border border-border bg-background/70 transition-[right,color,border-color] duration-300 ease-in-out hover:border-brand/45 hover:text-primary', collapsed ? 'right-4' : 'right-5')} aria-label={collapsed ? '展开设备栏' : '收起设备栏'}><PanelLeftClose size={18} className={cn('transition-transform duration-300 ease-in-out', collapsed && 'rotate-180')} /></button>
			<div aria-hidden={collapsed} className={cn('flex h-full w-[360px] flex-col gap-4 overflow-y-auto p-5 pr-5 transition-[opacity,transform] duration-200 ease-out', collapsed ? 'pointer-events-none -translate-x-2 opacity-0' : 'translate-x-0 opacity-100 delay-100')}>
				<div className='flex h-14 shrink-0 items-center gap-2 pr-12'>
					{onSwitchRelay && <button onClick={onSwitchRelay} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='返回传输工具'><ChevronLeft size={21} /></button>}
					<div className='min-w-0'><p className='text-brand text-xs font-semibold tracking-[0.18em] uppercase'>局域网互传</p><h2 className='mt-1 text-xl font-semibold'>连接设备</h2></div>
					{controller.session && <button onClick={controller.leaveSession} className='text-secondary ml-auto shrink-0 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>断开连接</button>}
				</div>
				<QrControlCard controller={controller} connectedCount={connectedCount} qrOpen={qrOpen} onToggleQr={onToggleQr} />
				{qrOpen && <InvitePanel controller={controller} />}
				<div className='min-h-0 flex-1 space-y-3'><div className='flex items-center justify-between'><p className='text-secondary text-xs font-medium'>当前连接</p><span className='text-secondary text-xs'>{controller.connections.length} 台</span></div><div className='space-y-2'>{controller.connections.length ? controller.connections.map(connection => <ConnectionCard key={connection.peerId} connection={connection} active={controller.activePeerId === connection.peerId} onSelect={() => controller.selectConnection(connection.peerId)} />) : <WaitingConnectionCard controller={controller} onToggleQr={onToggleQr} />}</div></div>
			</div>
			<div aria-hidden={!collapsed} className={cn('absolute inset-x-0 top-24 flex flex-col items-center gap-3 px-1.5 transition-opacity duration-200', collapsed ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0')}>{controller.connections.map(connection => <ConnectionCard key={connection.peerId} connection={connection} active={controller.activePeerId === connection.peerId} onSelect={() => controller.selectConnection(connection.peerId)} collapsed />)}</div>
		</aside>
	)
}

function ChatPane({ controller, onBack }: { controller: LanController; onBack?: () => void }) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const activeConnection = controller.activeConnection
	const messages = activeConnection?.messages || []
	const lastMessage = messages[messages.length - 1]
	const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessage.attachments.length}:${lastMessage.attachments.some(item => item.previewUrl || item.url)}` : ''
	const localPeer = controller.session?.localPeer
	useEffect(() => {
		const scrollToBottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }
		scrollToBottom()
		const timer = window.setTimeout(scrollToBottom, 80)
		return () => window.clearTimeout(timer)
	}, [controller.activePeerId, lastMessageKey])
	return (
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-border bg-article px-3 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)] sm:px-5'>
				<div className='flex min-w-0 items-center gap-3'>{onBack ? <button onClick={onBack} className='text-secondary -ml-2 flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background/40' aria-label='返回设备'><ChevronLeft size={25} /></button> : <DeviceAvatar type={activeConnection?.peer.deviceType} avatarSeed={activeConnection?.peer.avatarSeed} active={Boolean(activeConnection?.connected)} />}<div className='min-w-0'><h2 className='truncate text-base font-semibold'>{activeConnection?.peer.name || '等待连接'}</h2>{!onBack && <p className='text-secondary truncate text-xs'>{activeConnection ? connectionStatusText(activeConnection) : controller.roomStatus}</p>}</div></div>
				<div className='flex shrink-0 items-center gap-2'><LanTransferDiagnosticsMenu diagnostics={activeConnection?.diagnostics} /><button onClick={() => controller.closeConnection()} disabled={!activeConnection} className='text-secondary flex size-9 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary disabled:opacity-40' aria-label='关闭当前会话'><X size={17} /></button></div>
			</header>
			<div ref={scrollRef} className='min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6'>{activeConnection && messages.length > 0 && <MessageList messages={messages} peerName={activeConnection.peer.name} peerAvatarSeed={activeConnection.peer.avatarSeed} peerDeviceType={activeConnection.peer.deviceType} localAvatarSeed={localPeer?.avatarSeed} localDeviceType={localPeer?.deviceType} onDownload={controller.downloadAttachment} onStartReceive={controller.startReceivingAttachment} />}</div>
			<div className='shrink-0 p-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4'><ChatComposer connected={controller.activeConnected} recorderState={controller.recorder.state} onSendText={controller.sendText} onSendFiles={(files, mode) => void controller.sendFiles(files, mode === 'image' ? 'image' : undefined)} onRecordStart={() => void controller.recorder.start().catch(error => alert(error instanceof Error ? error.message : '无法录音'))} onRecordStop={() => void controller.stopRecordingAndSend()} /></div>
		</section>
	)
}

function DevicePage({ controller, onOpenChat, onSwitchRelay, qrOpen, onToggleQr }: { controller: LanController; onOpenChat: (peerId?: string) => void; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void }) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<div className='flex h-full min-h-0 flex-col bg-background/30'>
			<header className='flex h-16 shrink-0 items-center justify-between border-b border-border bg-article px-4 max-lg:h-[calc(3.75rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)]'><div className='flex items-center gap-2'>{onSwitchRelay && <button onClick={onSwitchRelay} className='text-secondary -ml-2 flex size-10 items-center justify-center rounded-full border border-border bg-background/40' aria-label='返回传输工具'><ChevronLeft size={24} /></button>}<h2 className='text-lg font-semibold'>设备</h2></div>{controller.session && <button onClick={controller.leaveSession} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium'>断开连接</button>}</header>
			<div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'><QrControlCard controller={controller} connectedCount={connectedCount} qrOpen={qrOpen} onToggleQr={onToggleQr} />{qrOpen && <InvitePanel controller={controller} />}<div className='space-y-2'><p className='text-secondary text-xs font-medium'>当前连接</p>{controller.connections.length ? controller.connections.map(connection => <button key={connection.peerId} onClick={() => onOpenChat(connection.peerId)} className={cn('flex w-full items-center gap-3 rounded-3xl border p-4 text-left shadow-sm', controller.activePeerId === connection.peerId ? 'border-brand/35 bg-brand/10' : 'border-border bg-article')}><DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active={connection.connected} /><div className='min-w-0 flex-1'><p className='truncate font-semibold'>{connection.peer.name}</p><p className='text-secondary mt-1 truncate text-xs'>{connectionStatusText(connection)}</p></div><MessageCircle size={19} className='text-brand shrink-0' /></button>) : <WaitingConnectionCard controller={controller} onToggleQr={onToggleQr} />}</div><button onClick={onToggleQr} disabled={controller.busy} className='bg-brand text-background w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50'>{controller.session?.role === 'host' ? (qrOpen ? '隐藏二维码' : '显示二维码') : '创建配对码'}</button></div>
		</div>
	)
}

function MobileShell({ controller, onSwitchRelay, qrOpen, onToggleQr }: { controller: LanController; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void }) {
	const [page, setPage] = useState<'devices' | 'chat'>('devices')
	return <div className='h-full lg:hidden'>{page === 'chat' ? <ChatPane controller={controller} onBack={() => setPage('devices')} /> : <DevicePage controller={controller} onOpenChat={peerId => { if (peerId) controller.selectConnection(peerId); setPage('chat') }} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={onToggleQr} />}</div>
}

export function LanTransferTool({ initialInvite = null, entryOrigin = null, onLeaveSession, onSwitchRelay }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })
	const [qrOpen, setQrOpen] = useState(false)
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		document.body.classList.add('lan-session-active')
		document.body.style.overflow = 'hidden'
		return () => { document.body.classList.remove('lan-session-active'); document.body.style.overflow = previousOverflow }
	}, [])
	useEffect(() => { if (!controller.session || controller.session.role !== 'host') setQrOpen(false) }, [controller.session])
	const handleToggleQr = () => {
		if (controller.session?.role === 'host') return void setQrOpen(value => !value)
		void controller.handleCreateRoom().then(created => { if (created) setQrOpen(true) })
	}
	const app = <div className='lan-session-v8 fixed inset-0 z-[999] h-[100dvh] overflow-hidden text-primary' style={{ '--lan-enter-x': entryOrigin ? `${entryOrigin.x}px` : '50vw', '--lan-enter-y': entryOrigin ? `${entryOrigin.y}px` : '50vh' } as CSSProperties}><div className={cn('hidden h-full transition-[grid-template-columns] duration-300 ease-in-out lg:grid', sidebarCollapsed ? 'lg:grid-cols-[68px_minmax(0,1fr)]' : 'lg:grid-cols-[360px_minmax(0,1fr)]')}><DesktopSidebar controller={controller} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(value => !value)} /><ChatPane controller={controller} /></div><MobileShell controller={controller} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} /></div>
	if (typeof document === 'undefined') return null
	return createPortal(app, document.body)
}
