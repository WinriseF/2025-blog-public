import { VersionControlBridge } from './bridge'
import type {
	ConflictPerspective,
	DiffFile,
	DiffSessionInfo,
	ExportFormat,
	ExportLayout,
	GraphCommit,
	PreviewContent,
	RepositoryOverview,
	RepositoryFileContent,
	RepositoryTreeEntry,
	RevisionRef,
	WorkingTreeGroup
} from './types'

export type RepositorySource = 'local-agent' | 'github-rest'
export type HistoryPage = { items: GraphCommit[]; nextCursor: string | null }
export type DiffFilesPage = { items: DiffFile[]; nextCursor: string | null }
export type DirectoryPage = { items: RepositoryTreeEntry[]; nextCursor: string | null }

export interface RepositoryDataSource {
	readonly key: string
	readonly source: RepositorySource
	connectHistory(): Promise<RepositoryOverview>
	close(): Promise<unknown>
	dispose?(): void
	refresh(): Promise<RepositoryOverview>
	getHistory(query: string | null, cursor: string | null, limit?: number): Promise<HistoryPage>
	getDirectory(path: string, cursor: string | null, limit?: number): Promise<DirectoryPage>
	openRepositoryFile(path: string): Promise<RepositoryFileContent>
	openDiff(oldRevision: RevisionRef, newRevision: RevisionRef, group: WorkingTreeGroup): Promise<DiffSessionInfo>
	getDiffFiles(diffId: string, cursor: string | null, limit?: number): Promise<DiffFilesPage>
	openPreview(diffId: string, fileId: number, perspective: ConflictPerspective, mode?: 'full' | 'patch'): Promise<PreviewContent>
	prepareExport?(
		diffId: string,
		format: ExportFormat,
		layout: ExportLayout,
		selectedFileIds: number[],
		totalFiles: number
	): Promise<{ cancelled: boolean; exportTargetId?: string; insideRepository?: boolean }>
	confirmExport?(targetId: string, allowInside: boolean): Promise<unknown>
	cancelExport?(targetId: string): Promise<unknown>
}

export class LocalAgentRepositoryDataSource implements RepositoryDataSource {
	readonly source = 'local-agent'
	readonly key: string

	constructor(
		private readonly bridge: VersionControlBridge,
		private readonly repositoryId: string
	) {
		this.key = `local-agent:${repositoryId}`
	}

	connectHistory() {
		return this.bridge.connectHistory(this.repositoryId)
	}

	close() {
		return this.bridge.closeRepository(this.repositoryId)
	}

	refresh() {
		return this.bridge.refresh(this.repositoryId)
	}

	async getHistory(query: string | null, cursor: string | null, limit?: number): Promise<HistoryPage> {
		const page = await this.bridge.getHistory(this.repositoryId, query, parseCursor(cursor), limit)
		return { items: page.items, nextCursor: page.hasMore ? String(page.nextSkip) : null }
	}

	async getDirectory(path: string, cursor: string | null, limit?: number): Promise<DirectoryPage> {
		const page = await this.bridge.getDirectory(this.repositoryId, path, parseCursor(cursor), limit)
		return { items: page.items, nextCursor: page.hasMore ? String(page.nextSkip) : null }
	}

	async openRepositoryFile(path: string): Promise<RepositoryFileContent> {
		const content = await this.bridge.openRepositoryFile(this.repositoryId, path)
		return { path, content, size: new TextEncoder().encode(content).byteLength }
	}

	openDiff(oldRevision: RevisionRef, newRevision: RevisionRef, group: WorkingTreeGroup) {
		return this.bridge.openDiff(this.repositoryId, oldRevision, newRevision, group)
	}

	async getDiffFiles(diffId: string, cursor: string | null, limit?: number): Promise<DiffFilesPage> {
		const page = await this.bridge.getDiffFiles(this.repositoryId, diffId, parseCursor(cursor), limit)
		return { items: page.items, nextCursor: page.hasMore ? String(page.nextSkip) : null }
	}

	openPreview(diffId: string, fileId: number, perspective: ConflictPerspective, mode: 'full' | 'patch' = 'full') {
		return this.bridge.openPreview(this.repositoryId, diffId, fileId, perspective, mode)
	}

	prepareExport(diffId: string, format: ExportFormat, layout: ExportLayout, selectedFileIds: number[], totalFiles: number) {
		return this.bridge.prepareExport(this.repositoryId, diffId, format, layout, selectedFileIds, totalFiles)
	}

	confirmExport(targetId: string, allowInside: boolean) {
		return this.bridge.confirmExport(targetId, allowInside)
	}

	cancelExport(targetId: string) {
		return this.bridge.cancelExport(targetId)
	}
}

function parseCursor(cursor: string | null) {
	if (cursor === null) return 0
	const value = Number(cursor)
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('仓库分页游标无效')
	return value
}
