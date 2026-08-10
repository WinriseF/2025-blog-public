export type SourceRef = {
	line: number
	byteStart: number
	byteEnd: number
}

export type SessionSource = {
	name: string
	size: number
	lastModified: number
	recordCount: number
	lineCount: number
}

export type SessionMetadata = {
	id?: string
	cwd?: string
	startedAt?: string
	endedAt?: string
	model?: string
	models: string[]
	cliVersion?: string
	gitBranch?: string
	forkedFromId?: string
	isSubagent: boolean
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export type ParseDiagnostic = {
	id: string
	severity: DiagnosticSeverity
	code: string
	message: string
	sourceRef?: SourceRef
	processId?: string
}

export type EventStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown'

export type ShellDialect = 'powershell' | 'bash' | 'cmd' | 'generic'
export type ShellParseStatus = 'complete' | 'partial' | 'opaque'
export type CommandConfidence = 'confirmed' | 'partial'
export type CommandCategory = 'git' | 'docker' | 'package' | 'build' | 'runtime' | 'search' | 'file' | 'network' | 'system' | 'other'

export type ParsedCommand = {
	id: string
	name: string
	normalizedName: string
	subcommand?: string
	category: CommandCategory
	summary: string
	raw: string
	start: number
	end: number
	depth: number
	parentId?: string
	confidence: CommandConfidence
	inLoop: boolean
	conditional: boolean
	inPipeline: boolean
}

export type ShellAnalysis = {
	dialect: ShellDialect
	status: ShellParseStatus
	commands: ParsedCommand[]
	errorCount: number
	structuralIssue?: string
	notes: string[]
}

export type ProcessRun = {
	id: string
	sequence: number
	callId?: string
	parentCallId?: string
	turnId?: string
	timestamp?: string
	toolName?: string
	command: string
	argv?: string[]
	executionMode?: 'shell' | 'argv'
	cwd?: string
	shellHint?: string
	status: EventStatus
	exitCode?: number
	output?: string
	sessionId?: string
	cellId?: string
	continuationCallIds: string[]
	sourceRefs: SourceRef[]
	analysis?: ShellAnalysis
}

export type FileReadOccurrence = {
	id: string
	sequence: number
	timestamp?: string
	callId?: string
	status: EventStatus
	sourceRef?: SourceRef
}

export type FileRead = {
	key: string
	path: string
	count: number
	occurrences: FileReadOccurrence[]
}

export type FileChangeOperation = 'create' | 'modify' | 'move' | 'delete'

export type FilePatch = {
	id: string
	sequence: number
	timestamp?: string
	callId?: string
	operation: FileChangeOperation
	path: string
	oldPath?: string
	diff?: string
	diffMode: 'parsed' | 'fragment' | 'missing'
	additions: number
	deletions: number
	sourceRef?: SourceRef
}

export type FileChange = {
	key: string
	path: string
	originalPaths: string[]
	operations: FileChangeOperation[]
	patches: FilePatch[]
	additions: number
	deletions: number
}

export type FileAudit = {
	reads: FileRead[]
	changes: FileChange[]
	readOperations: number
	searchOperations: number
	patchAttempts: number
	failedPatchAttempts: number
}

export type TokenUsageNumbers = {
	input: number
	freshInput: number
	cachedInput: number
	cacheWriteInput: number
	output: number
	reasoningOutput: number
	total: number
}

export type TokenUsageSample = TokenUsageNumbers & {
	id: string
	sequence: number
	timestamp?: string
	contextWindow?: number
	sourceRef: SourceRef
}

export type SessionTokenUsage = {
	status: 'available' | 'missing' | 'invalid'
	scope: 'session' | 'possibly-inherited'
	total?: TokenUsageNumbers
	contextWindow?: number
	samples: TokenUsageSample[]
}

export type SessionParseResult = {
	source: SessionSource
	meta: SessionMetadata
	processes: ProcessRun[]
	fileAudit: FileAudit
	tokenUsage: SessionTokenUsage
	diagnostics: ParseDiagnostic[]
}

export type ParserWorkerRequest =
	| { type: 'parse'; id: number; file: File }
	| { type: 'cancel'; id: number }

export type ParserWorkerResponse =
	| { type: 'progress'; id: number; bytesRead: number; records: number }
	| { type: 'success'; id: number; result: SessionParseResult }
	| { type: 'error'; id: number; message: string }
