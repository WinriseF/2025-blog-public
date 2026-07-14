'use client'

import { useEffect, useState } from 'react'
import { Laptop, Monitor, Smartphone } from 'lucide-react'
import { formatLanConnectionRoute } from '@/lib/lan-transfer/transport-types'
import type { LanTransferController } from './use-lan-transfer-controller'

export type LanController = LanTransferController
export type LanConnectionItem = LanController['connections'][number]

export function cn(...classes: Array<string | false | null | undefined>) {
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

export function DeviceAvatar({ type = 'desktop', avatarSeed, active = false }: { type?: string; avatarSeed?: string; active?: boolean }) {
	const [failed, setFailed] = useState(false)
	const Icon = type === 'phone' ? Smartphone : type === 'tablet' ? Monitor : Laptop
	useEffect(() => setFailed(false), [avatarSeed])
	const avatarUrl = avatarSeed ? `https://api.dicebear.com/10.x/bottts-neutral/svg?seed=${encodeURIComponent(avatarSeed)}` : ''
	return (
		<div className={cn('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border', active ? 'border-brand/35 bg-brand/10 text-brand' : 'border-border bg-background/40 text-primary')}>
			{avatarUrl && !failed ? <img src={avatarUrl} alt='' className='size-full object-cover' referrerPolicy='no-referrer' onError={() => setFailed(true)} /> : <Icon size={22} />}
		</div>
	)
}

export function connectionStatusText(connection: LanConnectionItem) {
	if (connection.connected) return formatLanConnectionRoute(connection.connectionRoute)
	return connection.status || connectionLabel[connection.connectionState] || '等待'
}
