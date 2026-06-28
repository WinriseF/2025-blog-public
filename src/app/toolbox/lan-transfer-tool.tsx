'use client'

import { LanTransferStatus } from './lan-transfer-status'
import { LanTransferSessionPanel } from './lan-transfer-session-panel'
import { useLanTransferController } from './use-lan-transfer-controller'

type LanTransferToolProps = {
	initialInvite?: {
		roomId: string
		token: string
	} | null
	onLeaveSession?: () => void
}

export function LanTransferTool({ initialInvite = null, onLeaveSession }: LanTransferToolProps) {
	const controller = useLanTransferController({ initialInvite, onLeaveSession })

	return (
		<div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]'>
			<LanTransferSessionPanel
				session={controller.session}
				remotePeer={controller.remotePeer}
				connected={controller.connected}
				qrDataUrl={controller.qrDataUrl}
				selectedFiles={controller.selectedFiles}
				incomingRequest={controller.incomingRequest}
				localCapability={controller.localCapability}
				remoteCapability={controller.remoteCapability}
				busy={controller.busy}
				transferBusy={controller.transferBusy}
				setSelectedFiles={controller.setSelectedFiles}
				handleCreateRoom={controller.handleCreateRoom}
				handleSendFiles={controller.handleSendFiles}
				acceptIncoming={controller.acceptIncoming}
				rejectIncoming={controller.rejectIncoming}
				copyInvite={controller.copyInvite}
				leaveSession={controller.leaveSession}
			/>
			<LanTransferStatus busy={controller.busy} status={controller.status} outgoing={controller.outgoing} incoming={controller.incoming} receivedFiles={controller.receivedFiles} onClearReceivedFile={controller.clearReceivedFile} />
		</div>
	)
}
