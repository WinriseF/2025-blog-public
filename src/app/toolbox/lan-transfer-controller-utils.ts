import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanCapability } from '@/lib/lan-transfer/types'

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	iceCandidatePoolSize: 2
}

export function capabilityLimitLabel(capability: LanCapability | null) {
	if (!capability) return '等待连接'
	return `最高可接收 ${formatBytes(capability.limits.maxExperimentalFileSize)}`
}

export function totalSelectedSize(files: File[]) {
	return files.reduce((sum, file) => sum + file.size, 0)
}
