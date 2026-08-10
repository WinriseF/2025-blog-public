import type { FileChange, FileRead, ParsedCommand, ProcessRun, TokenUsageSample } from '@/lib/codex-session/types'

export type DetailSelection =
	| { type: 'command'; value: { process: ProcessRun; command: ParsedCommand } }
	| { type: 'file-change'; value: FileChange }
	| { type: 'file-read'; value: FileRead }
	| { type: 'token'; value: TokenUsageSample }
