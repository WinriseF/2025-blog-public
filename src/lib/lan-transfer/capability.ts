import { LAN_LIMITS, LAN_PROTOCOL_VERSION, type LanBrowserKind, type LanCapability, type LanPlatformKind, type LanStorageKind } from './types'

function userAgent() {
	return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

function detectBrowser(ua = userAgent()): LanBrowserKind {
	const lower = ua.toLowerCase()
	if (/micromessenger/.test(lower)) return 'wechat'
	if (/qq\//.test(lower) || /mqqbrowser/.test(lower)) return 'qq'
	if (/edg\//.test(lower)) return 'edge'
	if (/firefox\//.test(lower)) return 'firefox'
	if (/chrome\//.test(lower) || /crios\//.test(lower)) return 'chrome'
	if (/safari\//.test(lower)) return 'safari'
	return 'unknown'
}

function detectPlatform(ua = userAgent()): LanPlatformKind {
	const lower = ua.toLowerCase()
	if (/android/.test(lower)) return 'android'
	if (/iphone|ipad|ipod/.test(lower)) return 'ios'
	if (/windows|macintosh|linux|x11/.test(lower)) return 'desktop'
	return 'unknown'
}

function hasIndexedDB() {
	return typeof indexedDB !== 'undefined'
}

async function probeOPFS() {
	if (typeof navigator === 'undefined' || !navigator.storage || !('getDirectory' in navigator.storage)) return false
	try {
		const root = await navigator.storage.getDirectory()
		const dir = await root.getDirectoryHandle('winrisef-lan-probe', { create: true })
		const file = await dir.getFileHandle('probe.bin', { create: true })
		const writable = await file.createWritable()
		await writable.write(new Uint8Array([1, 2, 3]))
		await writable.close()
		await dir.removeEntry('probe.bin').catch(() => {})
		await root.removeEntry('winrisef-lan-probe', { recursive: true }).catch(() => {})
		return true
	} catch {
		return false
	}
}

function hasFileSystemAccess() {
	return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

function chooseStorage(opfs: boolean, indexedDB: boolean, fileSize = 0): LanStorageKind {
	if (fileSize > LAN_LIMITS.memoryMaxBytes && opfs) return 'opfs'
	if (fileSize > LAN_LIMITS.memoryMaxBytes && indexedDB) return 'indexeddb'
	return 'memory'
}

export async function detectLanCapability(peerId: string, fileSize = 0): Promise<LanCapability> {
	const browser = detectBrowser()
	const platform = detectPlatform()
	const isEmbeddedBrowser = browser === 'wechat' || browser === 'qq'
	const indexedDBSupported = hasIndexedDB()
	const opfsSupported = await probeOPFS()
	const fileSystemAccessSupported = hasFileSystemAccess()
	const notes: string[] = []
	let quota: number | undefined
	let usage: number | undefined
	let available: number | undefined
	let persisted: boolean | undefined

	if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
		const estimate = await navigator.storage.estimate().catch(() => null)
		quota = estimate?.quota
		usage = estimate?.usage
		if (typeof quota === 'number' && typeof usage === 'number') available = Math.max(0, quota - usage)
	}
	if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
		persisted = await navigator.storage.persisted().catch(() => undefined)
	}
	if (!persisted && typeof navigator !== 'undefined' && navigator.storage?.persist) {
		persisted = await navigator.storage.persist().catch(() => persisted)
	}

	let maxRecommendedFileSize = LAN_LIMITS.memoryMaxBytes
	let maxExperimentalFileSize = LAN_LIMITS.memoryMaxBytes
	let recommendedChunkSize = LAN_LIMITS.legacyChunkSize
	let recommendedStorage = chooseStorage(opfsSupported, indexedDBSupported, fileSize)

	if (isEmbeddedBrowser) {
		notes.push('当前是内置浏览器，不建议接收大文件，请使用系统 Chrome / Edge 打开。')
	} else if (platform === 'ios') {
		maxRecommendedFileSize = 500 * 1024 * 1024
		maxExperimentalFileSize = 2 * 1024 * 1024 * 1024
		recommendedChunkSize = LAN_LIMITS.legacyChunkSize
		notes.push('iOS Safari 对后台和大文件写入限制更严格，不承诺 10GB+。')
	} else if (opfsSupported) {
		maxRecommendedFileSize = LAN_LIMITS.opfsRecommendedBytes
		maxExperimentalFileSize = LAN_LIMITS.experimentalMaxBytes
		recommendedChunkSize = platform === 'android' ? LAN_LIMITS.opfsMobileChunkSize : LAN_LIMITS.opfsDesktopChunkSize
		recommendedStorage = 'opfs'
		notes.push('支持 OPFS 增强模式，可用于 10GB+ 实验传输；断线后需要重新发送。')
	} else if (indexedDBSupported) {
		maxRecommendedFileSize = LAN_LIMITS.indexedDbRecommendedBytes
		maxExperimentalFileSize = LAN_LIMITS.indexedDbExperimentalBytes
		recommendedChunkSize = LAN_LIMITS.mobileChunkSize
		recommendedStorage = 'indexeddb'
		notes.push('不支持 OPFS，已降级为 IndexedDB；中大型文件导出可能不稳定，不建议超过 2GB。')
	}

	if (typeof available === 'number') {
		const storageSafeLimit = Math.floor(available * 0.85)
		maxRecommendedFileSize = Math.min(maxRecommendedFileSize, storageSafeLimit)
		maxExperimentalFileSize = Math.min(maxExperimentalFileSize, Math.floor(available * 0.95))
		if (fileSize && fileSize > storageSafeLimit) notes.push('接收端浏览器可用存储可能不足。')
	}

	return {
		type: 'capability',
		protocolVersion: LAN_PROTOCOL_VERSION,
		peerId,
		platform,
		browser,
		isEmbeddedBrowser,
		storage: {
			memory: true,
			opfs: opfsSupported,
			indexedDB: indexedDBSupported,
			fileSystemAccess: fileSystemAccessSupported,
			quota,
			usage,
			available,
			persisted
		},
		limits: {
			maxRecommendedFileSize,
			maxExperimentalFileSize,
			recommendedChunkSize,
			recommendedStorage
		},
		notes
	}
}

export function selectStorageForFile(size: number, capability: LanCapability | null): LanStorageKind {
	if (!capability) return size <= LAN_LIMITS.memoryMaxBytes ? 'memory' : 'indexeddb'
	if (size <= LAN_LIMITS.memoryMaxBytes) return 'memory'
	if (capability.storage.opfs) return 'opfs'
	if (capability.storage.indexedDB) return 'indexeddb'
	return 'memory'
}

export function assertCanReceiveFile(size: number, capability: LanCapability | null) {
	if (!capability) return
	if (capability.isEmbeddedBrowser && size > LAN_LIMITS.memoryMaxBytes) throw new Error('接收端是微信/QQ 内置浏览器，不适合大文件传输，请使用系统 Chrome / Edge 打开。')
	if (size > LAN_LIMITS.memoryMaxBytes && !capability.storage.opfs && !capability.storage.indexedDB) throw new Error('接收端浏览器不支持 OPFS/IndexedDB 分块存储，不能接收大文件。')
	if (typeof capability.storage.available === 'number' && size > capability.storage.available * 0.9) throw new Error('接收端浏览器可用存储空间不足，无法安全接收该文件。')
	if (size > capability.limits.maxExperimentalFileSize) throw new Error('文件超过当前接收设备的实验性上限，请换用桌面 Chrome/Edge 或清理空间后重试。')
}
