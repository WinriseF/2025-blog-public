import { formatBytes } from '@/lib/lan-transfer/file-transfer'
import type { LanCapability } from '@/lib/lan-transfer/types'

export const lanRtcConfig: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

export function capabilityLabel(capability: LanCapability | null) {
	if (!capability) return '等待能力检测'
	const storage = capability.limits.recommendedStorage.toUpperCase()
	return `${capability.platform} · ${capability.browser} · ${storage} · 推荐 ${formatBytes(capability.limits.maxRecommendedFileSize)}`
}

export function totalSelectedSize(files: File[]) {
	return files.reduce((sum, file) => sum + file.size, 0)
}
