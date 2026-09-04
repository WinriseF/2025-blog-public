import type { LanNativeAgentTicket } from './native-agent/types'
import type { LanNativeLocalAgentPort } from './native-agent/ports'
import type { LanStorageEngine, TransferFileMeta } from './storage/types'
import type { LanAttachment, LanAttachmentAccept, LanAttachmentKind, LanAttachmentOffer, LanCapability, LanChatMessage, LanFileRecord, LanSession, PreparedLanAttachment } from './types'

export type IncomingAttachment = { offer: LanAttachmentOffer; meta: TransferFileMeta; engine: LanStorageEngine; received: number; chunkCount: number }
export type PreparedEntry = { file: PreparedLanAttachment; createdAt: number; acked: number; ranges: Array<[number, number]>; offered: boolean; accepted?: LanAttachmentAccept }
export type CachedReceivedFile = { engine: LanStorageEngine; fileId: string; messageId: string; size: number; chunkCount: number; storage: TransferFileMeta['storage']; url?: string }
export type ProgressCheckpoint = { bytes: number; ts: number }
export type TransferSample = { bytes: number; ts: number; speedBps: number }
export type ResumeSync = { id: string; ids: Set<string>; timer?: ReturnType<typeof setTimeout> }

export type RuntimeContext = {
	session: LanSession
	remotePeerName?: string
	remoteCapability?: LanCapability | null
	localCapability?: LanCapability | null
	getHistory?: () => LanChatMessage[]
	issueNativeAgentTicket?: (peerDeviceId: string) => Promise<LanNativeAgentTicket>
	getNativeLocalAgentPort: () => LanNativeLocalAgentPort | null
	remoteDeviceId: string
}

export type SendFilesOptions = {
	kind?: LanAttachmentKind
	durationMs?: number
}

export type AttachmentPatch = Partial<LanAttachment> & { id: string; messageId?: string }
export type MessagePatch = Partial<Pick<LanChatMessage, 'status' | 'error'>> & { id: string }

export type LanConnectionRuntimeEvent =
	| { type: 'message-upsert'; message: LanChatMessage }
	| { type: 'message-patch'; patch: MessagePatch }
	| { type: 'history-merge'; messages: LanChatMessage[] }
	| { type: 'attachment-upsert'; message: Omit<LanChatMessage, 'attachments'>; attachment: LanAttachment }
	| { type: 'attachment-patch'; patch: AttachmentPatch }
	| { type: 'file-record-upsert'; record: LanFileRecord }
	| { type: 'file-record-patch'; id: string; patch: Partial<LanFileRecord> }
	| { type: 'status'; message: string }
	| { type: 'local-capability'; capability: LanCapability }
	| { type: 'remote-capability'; capability: LanCapability }
	| { type: 'download-ready'; name: string; url: string }

export type RuntimeListener = (event: LanConnectionRuntimeEvent) => void
