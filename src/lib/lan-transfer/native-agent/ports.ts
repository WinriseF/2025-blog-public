import type { LanStorageEngine, TransferFileMeta } from '../storage/types'
import type { LanNativeFileDataPlane, LanNativeSelectedFile, LanNativeTransferEvent, LanNativeTransferGrant } from './types'

export interface LanNativeLocalAgentPort {
	selectFiles(): Promise<LanNativeSelectedFile[]>
	createSendTransfer(options: { sourceId: string; attachmentId: string; ownerDeviceId: string; peerDeviceId: string; dataPlane: LanNativeFileDataPlane }): Promise<LanNativeTransferGrant>
	prepareReceiveTransfer(options: { attachmentId: string; ownerDeviceId: string; peerDeviceId: string; name: string; totalBytes: number; dataPlane: LanNativeFileDataPlane }): Promise<LanNativeTransferGrant | null>
	cancelTransfer(transferId: string): Promise<void>
	finishSendTransfer(transferId: string): Promise<void>
	releaseSource(sourceId: string): Promise<void>
	subscribe(listener: (event: LanNativeTransferEvent) => void): () => void
}

export interface LanNativePeerBulkPort {
	download(options: { grant: LanNativeTransferGrant; peerDeviceId: string; meta: TransferFileMeta; storage: LanStorageEngine; signal: AbortSignal; onProgress: (bytes: number) => void }): Promise<void>
	upload(options: { grant: LanNativeTransferGrant; peerDeviceId: string; file: File; signal: AbortSignal; onProgress: (bytes: number) => void }): Promise<void>
}
