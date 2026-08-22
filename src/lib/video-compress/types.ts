export type VideoPresetId = 'clarity' | 'balanced' | 'compact' | 'custom'

export type VideoInspection = {
	name: string
	size: number
	format: string
	duration: number | null
	width: number
	height: number
	frameRate: number | null
	videoCodec: string
	audioCodec: string | null
	videoBitrate: number | null
	audioBitrate: number | null
	videoTrackCount: number
	audioTrackCount: number
	extraTrackCount: number
	hasHighDynamicRange: boolean
}

export type VideoCompressionConfig = {
	preset: VideoPresetId
	width: number
	height: number
	frameRate: number
	videoBitrate: number
	audioBitrate: number
}

export type VideoWorkerMode = 'single' | 'dual'

export type VideoLaneProgress = {
	lane: number
	segmentIndex: number | null
	start: number
	end: number
	progress: number
	speed: number
}

export type VideoWorkerRequest =
	| { type: 'inspect'; id: number; file: File }
	| { type: 'start'; id: number; file: File; outputHandle: FileSystemFileHandle; config: VideoCompressionConfig; workerMode: VideoWorkerMode }
	| { type: 'pause'; id: number }
	| { type: 'resume'; id: number }
	| { type: 'cancel'; id: number }

export type VideoWorkerResponse =
	| { type: 'inspection'; id: number; inspection: VideoInspection }
	| { type: 'phase'; id: number; phase: 'preparing' | 'running' | 'paused' | 'finalizing' }
	| { type: 'progress'; id: number; progress: number; processedTime: number; outputBytes: number; elapsedMs: number; speed: number; workerCount: number; lanes: VideoLaneProgress[] }
	| { type: 'complete'; id: number; outputBytes: number; elapsedMs: number }
	| { type: 'canceled'; id: number }
	| { type: 'error'; id: number; stage: 'inspect' | 'compress'; message: string }

export type VideoCompressionPhase =
	| 'idle'
	| 'inspecting'
	| 'ready'
	| 'preparing'
	| 'running'
	| 'pausing'
	| 'paused'
	| 'finalizing'
	| 'canceling'
	| 'done'
	| 'canceled'
	| 'error'

export type VideoSegment = {
	index: number
	start: number
	end: number
}

export type VideoSegmentWorkerRequest =
	| { type: 'encode'; jobId: number; file: File; config: VideoCompressionConfig; segment: VideoSegment }
	| { type: 'pause'; jobId: number }
	| { type: 'resume'; jobId: number }
	| { type: 'cancel'; jobId: number }

export type VideoSegmentWorkerResponse =
	| { type: 'progress'; jobId: number; segment: VideoSegment; progress: number; processedTime: number; speed: number }
	| { type: 'paused'; jobId: number; segment: VideoSegment }
	| { type: 'complete'; jobId: number; segment: VideoSegment; buffer: ArrayBuffer; elapsedMs: number }
	| { type: 'canceled'; jobId: number }
	| { type: 'error'; jobId: number; message: string }
