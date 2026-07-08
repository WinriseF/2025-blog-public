type SimplePeerWithConnection = unknown
type CandidatePairStats = RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; selected?: boolean; state?: string }

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2,
}

export function nowLabel(date = new Date()) {
	return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function getStatsCandidateType(stats: RTCStatsReport, candidateId: string | undefined) {
	if (!candidateId) return ''
	const candidate = stats.get(candidateId) as (RTCStats & { candidateType?: string }) | undefined
	return typeof candidate?.candidateType === 'string' ? candidate.candidateType : ''
}

function getSelectedCandidatePair(stats: RTCStatsReport): CandidatePairStats | null {
	let selectedPair: CandidatePairStats | null = null
	stats.forEach(report => {
		if (selectedPair || report.type !== 'candidate-pair') return
		const candidatePair = report as CandidatePairStats
		if (candidatePair.selected || (candidatePair.nominated && candidatePair.state === 'succeeded')) selectedPair = candidatePair
	})
	return selectedPair
}

export async function inspectLanConnectionRoute(peer: SimplePeerWithConnection) {
	const connection = (peer as { _pc?: RTCPeerConnection })._pc
	if (!connection?.getStats) return '已连接'
	await new Promise(resolve => setTimeout(resolve, 250))
	const stats = await connection.getStats()
	const selectedPair = getSelectedCandidatePair(stats)
	if (!selectedPair) return '已连接'
	const localType = getStatsCandidateType(stats, selectedPair.localCandidateId)
	const remoteType = getStatsCandidateType(stats, selectedPair.remoteCandidateId)
	if (localType === 'relay' || remoteType === 'relay') throw new Error('当前网络无法直连，请换个网络后重试')
	return '已连接'
}
