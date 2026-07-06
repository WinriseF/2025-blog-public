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
		const writable = await (file as FileSystemFileHandle & { createWritable: () => Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }> }).createWritable()
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

function chooseStorage(opfs: boolean, indexedDB: boolean, fileSize = 0, fileSystemAccess = false): LanStorageKind {
	if (fileSize > LAN_LIMITS.memoryMaxBytes && fileSystemAccess) return 'file'
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
	let recommendedChunkSize = LAN_LIMITS.conservativeChunkSize
	let recommendedStorage = chooseStorage(opfsSupported, indexedDBSupported, fileSize, fileSystemAccessSupported && platform === 'desktop')

	if (isEmbeddedBrowser) {
		notes.push('请用系统浏览器接收大文件')
	} else if (platform === 'ios') {
		maxRecommendedFileSize = 500 * 1024 * 1024
		maxExperimentalFileSize = 2 * 1024 * 1024 * 1024
		recommendedChunkSize = LAN_LIMITS.conservativeChunkSize
		notes.push('接收大文件时请保持页面打开')
	} else if (fileSystemAccessSupported && platform === 'desktop') {
		maxRecommendedFileSize = LAN_LIMITS.experimentalMaxBytes
		maxExperimentalFileSize = LAN_LIMITS.experimentalMaxBytes
		recommendedChunkSize = LAN_LIMITS.dataChannelSafeChunkSize
		recommendedStorage = 'file'
		notes.push('将优先保存到你选择的位置')
	} else if (opfsSupported) {
		maxRecommendedFileSize = LAN_LIMITS.opfsRecommendedBytes
		maxExperimentalFileSize = LAN_LIMITS.experimentalMaxBytes
		recommendedChunkSize = LAN_LIMITS.dataChannelSafeChunkSize
		recommendedStorage = 'opfs'
		notes.push('连接恢复后会尽量继续接收')
	} else if (indexedDBSupported) {
		maxRecommendedFileSize = LAN_LIMITS.indexedDbRecommendedBytes
		maxExperimentalFileSize = LAN_LIMITS.indexedDbExperimentalBytes
		recommendedChunkSize = LAN_LIMITS.dataChannelSafeChunkSize
		recommendedStorage = 'indexeddb'
		notes.push('当前设备接收大文件不稳定')
	}

	if (typeof available === 'number' && recommendedStorage !== 'file') {
		const storageSafeLimit = Math.floor(available * 0.85)
		maxRecommendedFileSize = Math.min(maxRecommendedFileSize, storageSafeLimit)
		maxExperimentalFileSize = Math.min(maxExperimentalFileSize, Math.floor(available * 0.95))
		if (fileSize && fileSize > storageSafeLimit) notes.push('可用空间可能不足')
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
			persisted,
		},
		limits: {
			maxRecommendedFileSize,
			maxExperimentalFileSize,
			recommendedChunkSize,
			recommendedStorage,
		},
		notes,
	}
}

export function selectStorageForFile(size: number, capability: LanCapability | null): LanStorageKind {
	if (!capability) return size <= LAN_LIMITS.memoryMaxBytes ? 'memory' : 'indexeddb'
	if (size <= LAN_LIMITS.memoryMaxBytes) return 'memory'
	if (capability.storage.fileSystemAccess && capability.platform === 'desktop') return 'file'
	if (capability.storage.opfs) return 'opfs'
	if (capability.storage.indexedDB) return 'indexeddb'
	return 'memory'
}

export function assertCanReceiveFile(size: number, capability: LanCapability | null) {
	if (!capability) return
	if (capability.isEmbeddedBrowser && size > LAN_LIMITS.memoryMaxBytes) throw new Error('请用系统浏览器接收大文件')
	if (size > LAN_LIMITS.memoryMaxBytes && !capability.storage.fileSystemAccess && !capability.storage.opfs && !capability.storage.indexedDB) throw new Error('当前设备不能保存大文件，请换设备后重试')
	if (typeof capability.storage.available === 'number' && capability.limits.recommendedStorage !== 'file' && size > capability.storage.available * 0.9) throw new Error('可用空间不足，无法接收该文件')
	if (size > capability.limits.maxExperimentalFileSize) throw new Error('这个文件太大，请换设备或清理空间后重试')
}
