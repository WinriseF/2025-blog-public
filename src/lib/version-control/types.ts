export const VERSION_CONTROL_BRIDGE_VERSION = 2

export type VersionControlCallback = {
	nonce: string
	bridgeEndpoint: string
	certificateSha256: string
	launchToken: string
	expiresAt: number
	error?: 'agent_busy'
}

export type RevisionRef = { kind: 'empty' } | { kind: 'commit'; oid: string } | { kind: 'stash'; oid: string } | { kind: 'working-tree' } | { kind: 'index' }

export type RepositoryKind = 'git' | 'svn'
export type RepositoryCandidate = {
	candidateId: string
	repositoryKind: RepositoryKind
	displayName: string
	relativeUrl?: string
}

export type WorkingTreeGroup = 'all' | 'staged' | 'unstaged' | 'untracked' | 'conflicted'
export type ConflictPerspective = 'base-to-ours' | 'base-to-theirs' | 'ours-to-theirs' | 'head-to-working'
export type ExportFormat = 'markdown' | 'json' | 'xml' | 'txt'
export type ExportLayout = 'split' | 'unified' | 'git-patch'

export type GitRef = { name: string; kind: 'head' | 'branch' | 'remote-branch' | 'tag' | 'stash' | 'deleted-branch' }

export type GraphCommit = {
	hash: string
	shortHash: string
	author: string
	timestampMs: number
	message: string
	parentHashes: string[]
	refs: GitRef[]
	isStash: boolean
}

export type RepositoryOverview = {
	repositoryKind: RepositoryKind
	displayName: string
	currentBranch: string | null
	isDetachedHead: boolean
	isBare: boolean
	headHash: string | null
	headShortHash: string | null
	upstreamBranch: string | null
	ahead: number
	behind: number
	hasStagedChanges: boolean
	hasUnstagedChanges: boolean
	hasUntrackedFiles: boolean
	conflictedCount: number
	stashCount: number
	capabilities?: {
		canExport: boolean
		supportsStaging: boolean
		supportsHistory: boolean
	}
	svn?: {
		relativeUrl: string
		workingRevision: number
		mixedRevision: boolean
		depth?: string
		historyConnected: boolean
		networkRequiredForHistory: boolean
		cliVersion: string
	}
}

export type DiffSummary = {
	filesChanged: number
	filesAdded: number
	filesModified: number
	filesDeleted: number
	filesRenamed: number
	filesConflicted: number
	insertions: number
	deletions: number
}

export type DiffFile = {
	fileId: number
	path: string
	oldPath: string | null
	status: string
	groups: WorkingTreeGroup[]
	additions: number
	deletions: number
	isBinary: boolean
	isSubmodule: boolean
	previewTooLarge: boolean
	exportTooLarge: boolean
	hasConflictViews: boolean
	propertiesChanged?: boolean
}

export type DiffSessionInfo = { diffId: string; summary: DiffSummary; totalFiles: number }
export type PreviewContent = { original: string; modified: string }
export type ExportEvent =
	| { type: 'export-complete'; exportTargetId: string; insideRepository: boolean }
	| { type: 'export-failed'; exportTargetId: string; error: string }
	| { type: 'export-cancelled'; exportTargetId: string }
