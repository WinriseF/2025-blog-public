'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Copy, MessageCircle, PanelLeftClose, QrCode, Sun, X, Zap } from 'lucide-react'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import { installLanDiagnosticCapture } from '@/lib/lan-transfer/connection-diagnostics'
import { useLanScreenWakeLock, type LanScreenWakeLockState } from '@/hooks/use-lan-screen-wake-lock'
import { useLanNativeSpeedMode, type LanNativeSpeedModeState } from '@/hooks/use-lan-native-speed-mode'
import type { LanNativeBenchmarkDirection } from '@/lib/lan-transfer/native-agent/types'
import { ChatComposer, DeviceAvatar, MessageList } from './lan-chat-ui'
import { LanSpeedModeToggle } from './lan-speed-mode-toggle'
import { LanWakeLockToggle } from './lan-wake-lock-toggle'
import { useLanTransferController } from './use-lan-transfer-controller'

type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
	entryOrigin?: { x: number; y: number } | null
	onLeaveSession?: () => void
	onSwitchRelay?: () => void
}
type LanController = ReturnType<typeof useLanTransferController>
type LanConnectionItem = LanController['connections'][number]
type LanControlPanel = 'qr' | 'wake' | 'speed'

function cn(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(' ')
}

const connectionLabel = {
	idle: '未连接',
	discovered: '找到设备',
	connecting: '连接中',
	connected: '已连接',
	suspect: '检测连接',
	'ice-restarting': '恢复网络',
	rebuilding: '重新连接',
	backoff: '等待重试',
	closed: '已关闭',
}

function connectionStatusText(connection: LanConnectionItem) {
	if (connection.connected) return formatLanConnectionRoute(connection.connectionRoute)
	return connection.status || connectionLabel[connection.connectionState] || '等待'
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

function LanQuickControls({
	controller,
	connectedCount,
	wakeLock,
	speedMode,
	onRunBenchmark,
	qrOpen,
	onToggleQr,
	expandedPanel,
	onTogglePanel,
}: {
	controller: LanController
	connectedCount: number
	wakeLock: LanScreenWakeLockState
	speedMode: LanNativeSpeedModeState
	onRunBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number) => void
	qrOpen: boolean
	onToggleQr: () => void
	expandedPanel: LanControlPanel | null
	onTogglePanel: (panel: LanControlPanel) => void
}) {
	const hostInvite = controller.session?.role === 'host'
	const qrStatus = hostInvite ? (connectedCount ? `${connectedCount}台` : '已创建') : controller.session ? '已加入' : '未创建'
	const wakeAvailable = wakeLock.ready && wakeLock.supported
	const wakeStatus = !wakeAvailable ? '不支持' : wakeLock.enabled ? '已开启' : '已关闭'
	const speedStatus = speedMode.remoteAdvertisement ? '远端' : speedMode.localAdvertisement || speedMode.agentState === 'connected' ? '已就绪' : speedMode.enabled ? '启动中' : '未开启'
	const needsQrPrompt = !controller.session
	const buttonClass = (panel: LanControlPanel) =>
		cn(
			'flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45',
			expandedPanel === panel ? 'border-brand/45 bg-brand/15 text-brand' : 'border-border bg-article text-secondary hover:border-brand/35 hover:text-primary',
		)

	return (
		<div className='space-y-3'>
			<div className='grid grid-cols-3 gap-2'>
				<button type='button' aria-expanded={expandedPanel === 'qr'} aria-controls='lan-qr-control-panel' onClick={() => onTogglePanel('qr')} className={buttonClass('qr')}>
					<QrCode size={20} className={cn('shrink-0', needsQrPrompt && 'motion-safe:animate-pulse')} />
					<span className='truncate text-xs font-semibold'>二维码</span>
					<span className='truncate text-[10px] opacity-75'>{qrStatus}</span>
				</button>
				<button type='button' aria-expanded={expandedPanel === 'wake'} aria-controls='lan-wake-control-panel' onClick={() => onTogglePanel('wake')} disabled={!wakeAvailable} className={buttonClass('wake')}>
					<Sun size={20} className='shrink-0' />
					<span className='truncate text-xs font-semibold'>保持常亮</span>
					<span className='truncate text-[10px] opacity-75'>{wakeStatus}</span>
				</button>
				<button type='button' aria-expanded={expandedPanel === 'speed'} aria-controls='lan-speed-control-panel' onClick={() => onTogglePanel('speed')} disabled={!speedMode.ready} className={buttonClass('speed')}>
					<Zap size={20} className='shrink-0' />
					<span className='truncate text-xs font-semibold'>极速模式</span>
					<span className='truncate text-[10px] opacity-75'>{speedStatus}</span>
				</button>
			</div>

			{expandedPanel === 'qr' && (
				<div id='lan-qr-control-panel' className='space-y-3'>
					<QrControlCard controller={controller} connectedCount={connectedCount} qrOpen={qrOpen} onToggleQr={onToggleQr} />
					{qrOpen && <InvitePanel controller={controller} />}
				</div>
			)}
			{expandedPanel === 'wake' && (
				<div id='lan-wake-control-panel'>
					<LanWakeLockToggle wakeLock={wakeLock} />
				</div>
			)}
			{expandedPanel === 'speed' && (
				<div id='lan-speed-control-panel'>
					<LanSpeedModeToggle speedMode={speedMode} onRunBenchmark={onRunBenchmark} />
				</div>
			)}
		</div>
	)
}

function ConnectionCard({
	connection,
	active,
	onSelect,
	collapsed = false,
}: {
	connection: LanConnectionItem
	active: boolean
	onSelect: () => void
	collapsed?: boolean
}) {
	return (
		<button onClick={onSelect} title={collapsed ? `${connection.peer.name} · ${connectionStatusText(connection)}` : undefined} className={cn('flex items-center border shadow-sm transition', collapsed ? 'size-14 justify-center rounded-full p-1' : 'w-full gap-3 rounded-3xl p-4 text-left', active ? 'border-brand/35 bg-brand/10' : 'border-border bg-article hover:border-brand/30')}>
			<DeviceAvatar type={connection.peer.deviceType} avatarSeed={connection.peer.avatarSeed} active={connection.connected || active} />
			{!collapsed && (
				<>
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm font-semibold'>{connection.peer.name}</p>
						<p className='text-secondary mt-1 truncate text-xs'>{connectionStatusText(connection)}</p>
					</div>
					{connection.connected && <span className='bg-brand/15 text-brand rounded-full px-2 py-1 text-[11px] font-semibold'>在线</span>}
				</>
			)}
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

function DesktopSidebar({ controller, wakeLock, speedMode, onRunBenchmark, onSwitchRelay, qrOpen, onToggleQr, expandedPanel, onTogglePanel, collapsed, onToggleCollapse }: { controller: LanController; wakeLock: LanScreenWakeLockState; speedMode: LanNativeSpeedModeState; onRunBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number) => void; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void; expandedPanel: LanControlPanel | null; onTogglePanel: (panel: LanControlPanel) => void; collapsed: boolean; onToggleCollapse: () => void }) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<aside className='relative hidden min-h-0 w-full overflow-hidden border-r border-border bg-transparent lg:block'>
			<button
				onClick={onToggleCollapse}
				className={cn('text-secondary absolute top-7 z-10 flex size-9 items-center justify-center rounded-full border border-border bg-background/70 transition-[right,color,border-color] duration-300 ease-in-out hover:border-brand/45 hover:text-primary', collapsed ? 'right-4' : 'right-5')}
				aria-label={collapsed ? '展开设备栏' : '收起设备栏'}
				title={collapsed ? '展开设备栏' : '收起设备栏'}
			>
				<PanelLeftClose size={18} className={cn('transition-transform duration-300 ease-in-out', collapsed && 'rotate-180')} />
			</button>

			<div aria-hidden={collapsed} className={cn('flex h-full min-h-0 w-[360px] flex-col transition-[opacity,transform] duration-200 ease-out', collapsed ? 'pointer-events-none -translate-x-2 opacity-0' : 'translate-x-0 opacity-100 delay-100')}>
				<div className='flex h-24 shrink-0 items-center gap-2 px-5 pr-16'>
					{onSwitchRelay && (
						<button onClick={onSwitchRelay} className='text-secondary flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='返回传输工具' title='返回'>
							<ChevronLeft size={21} />
						</button>
					)}
					<div className='min-w-0'>
						<p className='text-brand text-xs font-semibold tracking-[0.18em] uppercase'>局域网互传</p>
						<h2 className='mt-1 text-xl font-semibold'>连接设备</h2>
					</div>
					{controller.session && (
						<button onClick={controller.leaveSession} className='text-secondary ml-auto shrink-0 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							断开连接
						</button>
					)}
				</div>
				<div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5'>
					<LanQuickControls controller={controller} connectedCount={connectedCount} wakeLock={wakeLock} speedMode={speedMode} onRunBenchmark={onRunBenchmark} qrOpen={qrOpen} onToggleQr={onToggleQr} expandedPanel={expandedPanel} onTogglePanel={onTogglePanel} />
					<div className='space-y-3'>
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
				</div>
			</div>

			<div aria-hidden={!collapsed} className={cn('absolute inset-x-0 top-24 flex flex-col items-center gap-3 px-1.5 transition-opacity duration-200', collapsed ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0')}>
				{controller.connections.map(connection => (
					<ConnectionCard key={connection.peerId} connection={connection} active={controller.activePeerId === connection.peerId} onSelect={() => controller.selectConnection(connection.peerId)} collapsed />
				))}
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
		<section className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-transparent'>
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
					onSelectNativeFiles={controller.localCapability?.nativeAgent ? () => void controller.selectNativeFiles() : undefined}
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
	wakeLock,
	speedMode,
	onRunBenchmark,
	qrOpen,
	onToggleQr,
	expandedPanel,
	onTogglePanel,
}: {
	controller: LanController
	onOpenChat: (peerId?: string) => void
	onSwitchRelay?: () => void
	wakeLock: LanScreenWakeLockState
	speedMode: LanNativeSpeedModeState
	onRunBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number) => void
	qrOpen: boolean
	onToggleQr: () => void
	expandedPanel: LanControlPanel | null
	onTogglePanel: (panel: LanControlPanel) => void
}) {
	const connectedCount = controller.connections.filter(item => item.connected).length
	return (
		<div className='flex h-full min-h-0 flex-col overflow-hidden bg-transparent'>
			<header className='flex h-20 shrink-0 items-center justify-between border-b border-border bg-article px-4 max-lg:h-[calc(5rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)]'>
				<div className='flex items-center gap-2'>
					{onSwitchRelay && <button onClick={onSwitchRelay} className='text-secondary -ml-2 flex size-10 items-center justify-center rounded-full border border-border bg-background/40 transition hover:border-brand/45 hover:text-primary' aria-label='返回传输工具'><ChevronLeft size={24} /></button>}
					<div className='min-w-0'>
						<p className='text-brand text-[10px] font-semibold tracking-[0.16em] uppercase'>局域网互传</p>
						<h2 className='mt-0.5 text-lg font-semibold'>连接设备</h2>
					</div>
				</div>
				<div className='flex items-center gap-2'>
					{controller.session && (
						<button onClick={controller.leaveSession} className='text-secondary rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium transition hover:border-brand/45 hover:text-primary'>
							断开连接
						</button>
					)}
				</div>
			</header>
			<div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
				<LanQuickControls controller={controller} connectedCount={connectedCount} wakeLock={wakeLock} speedMode={speedMode} onRunBenchmark={onRunBenchmark} qrOpen={qrOpen} onToggleQr={onToggleQr} expandedPanel={expandedPanel} onTogglePanel={onTogglePanel} />
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
			</div>
		</div>
	)
}

function MobileShell({ controller, wakeLock, speedMode, onRunBenchmark, onSwitchRelay, qrOpen, onToggleQr, expandedPanel, onTogglePanel }: { controller: LanController; wakeLock: LanScreenWakeLockState; speedMode: LanNativeSpeedModeState; onRunBenchmark: (direction: LanNativeBenchmarkDirection, totalBytes: number) => void; onSwitchRelay?: () => void; qrOpen: boolean; onToggleQr: () => void; expandedPanel: LanControlPanel | null; onTogglePanel: (panel: LanControlPanel) => void }) {
	const [page, setPage] = useState<'devices' | 'chat'>('devices')
	return (
		<div className='h-full min-h-0 overflow-hidden lg:hidden'>
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
					wakeLock={wakeLock}
					speedMode={speedMode}
					onRunBenchmark={onRunBenchmark}
					qrOpen={qrOpen}
					onToggleQr={onToggleQr}
					expandedPanel={expandedPanel}
					onTogglePanel={onTogglePanel}
				/>
			)}
		</div>
	)
}

export function LanTransferTool({ initialInvite = null, entryOrigin = null, onLeaveSession, onSwitchRelay }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })
	const wakeLock = useLanScreenWakeLock()
	const speedMode = useLanNativeSpeedMode(controller.session?.localPeer.deviceId || '', controller.activeConnection?.remoteCapability?.nativeAgent || null)
	const [qrOpen, setQrOpen] = useState(false)
	const [expandedPanel, setExpandedPanel] = useState<LanControlPanel | null>(null)
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
	useEffect(() => installLanDiagnosticCapture(), [])
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

	useEffect(() => {
		controller.setNativeTicketIssuer(speedMode.issuePeerTicket)
		return () => controller.setNativeTicketIssuer(null)
	}, [controller.setNativeTicketIssuer, speedMode.issuePeerTicket])

	useEffect(() => {
		controller.setNativeLocalAgentPort(speedMode.localAgentPort)
		return () => controller.setNativeLocalAgentPort(null)
	}, [controller.setNativeLocalAgentPort, speedMode.localAgentPort])

	useEffect(() => {
		controller.setNativeAgentAdvertisement(speedMode.localAdvertisement)
	}, [controller.localCapability, controller.setNativeAgentAdvertisement, speedMode.localAdvertisement])

	const handleRunBenchmark = (direction: LanNativeBenchmarkDirection, totalBytes: number) => {
		const peerId = controller.activePeerId
		if (!peerId) return
		void speedMode.runBenchmark(direction, totalBytes, () => controller.requestNativeAgentTicket(peerId))
	}

	const handleToggleQr = () => {
		setExpandedPanel('qr')
		if (controller.session?.role === 'host') {
			setQrOpen(value => !value)
			return
		}
		void controller.handleCreateRoom().then(created => {
			if (created) setQrOpen(true)
		})
	}

	const handleTogglePanel = (panel: LanControlPanel) => {
		setExpandedPanel(current => (current === panel ? null : panel))
	}

	const app = (
		<div
			className='lan-session-v11 fixed inset-0 z-[999] h-[100dvh] overflow-hidden text-primary'
			style={{ '--lan-enter-x': entryOrigin ? `${entryOrigin.x}px` : '50vw', '--lan-enter-y': entryOrigin ? `${entryOrigin.y}px` : '50vh' } as CSSProperties}
		>
			<div className={cn('hidden h-full transition-[grid-template-columns] duration-300 ease-in-out lg:grid', sidebarCollapsed ? 'lg:grid-cols-[68px_minmax(0,1fr)]' : 'lg:grid-cols-[360px_minmax(0,1fr)]')}>
				<DesktopSidebar controller={controller} wakeLock={wakeLock} speedMode={speedMode} onRunBenchmark={handleRunBenchmark} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} expandedPanel={expandedPanel} onTogglePanel={handleTogglePanel} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(value => !value)} />
				<ChatPane controller={controller} />
			</div>
			<MobileShell controller={controller} wakeLock={wakeLock} speedMode={speedMode} onRunBenchmark={handleRunBenchmark} onSwitchRelay={onSwitchRelay} qrOpen={qrOpen} onToggleQr={handleToggleQr} expandedPanel={expandedPanel} onTogglePanel={handleTogglePanel} />
		</div>
	)

	if (typeof document === 'undefined') return null
	return createPortal(app, document.body)
}
