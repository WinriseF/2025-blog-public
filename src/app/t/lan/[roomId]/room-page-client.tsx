'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

const LanTransferTool = dynamic(() => import('../../../toolbox/lan-transfer-tool').then(mod => mod.LanTransferTool), {
	ssr: false,
	loading: () => <div className='text-secondary rounded-2xl border border-border bg-article px-4 py-3 text-sm'>正在恢复局域网房间...</div>,
})

export function LanRoomPageClient({ roomId }: { roomId: string }) {
	const router = useRouter()
	const leave = () => router.replace('/t')
	return <LanTransferTool initialRoomId={roomId} onLeaveSession={leave} onSwitchRelay={leave} />
}
