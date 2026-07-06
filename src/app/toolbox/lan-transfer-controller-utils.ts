import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import { chooseStorageKind } from '@/lib/lan-transfer/storage/storage-manager'
import type { TransferFileMeta } from '@/lib/lan-transfer/storage/types'
import { LAN_LIMITS, type LanAttachment, type LanAttachmentOffer, type LanCapability, type LanChatMessage, type LanFileRecord, type PreparedLanAttachment } from '@/lib/lan-transfer/types'

type SimplePeerWithConnection = unknown
type CandidatePairStats = RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; selected?: boolean; state?: string }

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2,
}

export function capabilityLimitLabel(capability: LanCapability | null) {
	if (!capability) return '等待连接'
	return `最高可接收 ${formatBytes(capability.limits.maxExperimentalFileSize)}`
}

export function totalSelectedSize(files: File[]) {
	return files.reduce((sum, file) => sum + file.size, 0)
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
	if (!connection?.getStats) return '点对点已连接'
	await new Promise(resolve => setTimeout(resolve, 250))
	const stats = await connection.getStats()
	const selectedPair = getSelectedCandidatePair(stats)
	if (!selectedPair) return '点对点已连接'
	const localType = getStatsCandidateType(stats, selectedPair.localCandidateId)
	const remoteType = getStatsCandidateType(stats, selectedPair.remoteCandidateId)
	if (localType === 'relay' || remoteType === 'relay') throw new Error('当前网络只能走中继，LAN Session 不启用文件中转')
	return '点对点已连接'
}

export function messageBase(id: string, direction: 'in' | 'out', createdAt: number, peerId?: string): Omit<LanChatMessage, 'attachments'> {
	return { id, direction, kind: 'attachments', status: direction === 'out' ? 'queued' : 'received', createdAt, peerId }
}

export function transferMeta(offer: LanAttachmentOffer, storage: TransferFileMeta['storage']): TransferFileMeta {
	return { ...offer.attachment, storage }
}

export function attachmentFromPrepared(file: PreparedLanAttachment, storage: TransferFileMeta['storage'], previewUrl = ''): LanAttachment {
	return { ...file, direction: 'out', storage, status: 'queued', progress: 0, previewUrl }
}

export function attachmentFromOffer(offer: LanAttachmentOffer, storage: TransferFileMeta['storage'], progress = 0): LanAttachment {
	return { ...offer.attachment, direction: 'in', storage, status: 'receiving', progress }
}

export function fileRecord(messageId: string, attachment: LanAttachment, peerName?: string): LanFileRecord {
	return {
		id: attachment.id,
		messageId,
		direction: attachment.direction,
		kind: attachment.kind,
		name: attachment.name,
		mime: attachment.mime,
		size: attachment.size,
		storage: attachment.storage,
		status: attachment.status,
		url: attachment.url,
		createdAt: Date.now(),
		peerName,
	}
}

export function receiveStorageCandidates(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null) {
	const candidates: TransferFileMeta['storage'][] = []
	const add = (kind: TransferFileMeta['storage']) => {
		if (!candidates.includes(kind)) candidates.push(kind)
	}

	if (capability?.storage.fileSystemAccess && capability.platform === 'desktop') add('file')
	if (requested === 'opfs' && capability?.storage.opfs) add('opfs')
	if (requested === 'indexeddb' && capability?.storage.indexedDB) add('indexeddb')
	if (capability?.storage.opfs) add('opfs')
	if (capability?.storage.indexedDB) add('indexeddb')
	if (size <= LAN_LIMITS.memoryMaxBytes) add('memory')
	const fallback = chooseStorageKind(size, requested, capability)
	if (fallback !== 'memory' || size <= LAN_LIMITS.memoryMaxBytes) add(fallback)
	return candidates
}

export function chooseReceiveStorage(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null) {
	return receiveStorageCandidates(size, requested, capability)[0] || 'memory'
}
