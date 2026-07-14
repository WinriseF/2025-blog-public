import { LAN_PROTOCOL_VERSION, type LanAttachment, type LanAttachmentKind, type LanCapability, type LanChatMessage, type LanControlMessage, type LanFileRecord, type LanSession } from './types'
import type { LanTransferDiagnostics } from './diagnostics'

export type RuntimeContext = {
	session: LanSession
	remotePeerName?: string
	remoteCapability?: LanCapability | null
	localCapability?: LanCapability | null
	getHistory?: () => LanChatMessage[]
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
	| { type: 'diagnostics'; diagnostics: Partial<LanTransferDiagnostics> }

export type RuntimeEmit = (event: LanConnectionRuntimeEvent) => void

export type RuntimeControlBase = <T extends LanControlMessage['type']>(type: T, createdAt?: number) => {
	type: T
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
}
