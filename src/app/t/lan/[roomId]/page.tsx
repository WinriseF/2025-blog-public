import { ToolPageShell } from '../../../toolbox/tool-page-shell'
import { LanRoomPageClient } from './room-page-client'

type LanRoomPageContext = {
	params: Promise<{ roomId: string }>
}

export default async function Page({ params }: LanRoomPageContext) {
	const { roomId } = await params
	return (
		<ToolPageShell mobileFlush>
			<LanRoomPageClient roomId={roomId} />
		</ToolPageShell>
	)
}
