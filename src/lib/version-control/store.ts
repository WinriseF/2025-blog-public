'use client'

import { create } from 'zustand'
import { VersionControlBridge } from './bridge'
import { GitHubRestRepositoryDataSource } from './github-rest-repository-data-source'
import { LocalAgentRepositoryDataSource, type RepositoryDataSource } from './repository-data-source'
import type {
	ConflictPerspective,
	DiffFile,
	DiffSessionInfo,
	ExportEvent,
	ExportFormat,
	ExportLayout,
	GraphCommit,
	RepositoryBranch,
	RepositoryCandidate,
	RepositoryOverview,
	RevisionRef,
	VersionControlCallback,
	WorkingTreeGroup
} from './types'

export type VersionSelection = { kind: 'working-tree'; label: string } | { kind: 'commit'; commit: GraphCommit }

type VersionControlState = {
	agentBridge: VersionControlBridge | null
	repository: RepositoryDataSource | null
	connection: 'idle' | 'launching' | 'connecting' | 'connected' | 'error'
	expectedNonce: string | null
	error: string | null
	candidates: RepositoryCandidate[]
	overview: RepositoryOverview | null
	branches: RepositoryBranch[]
	branchesLoaded: boolean
	branchesLoading: boolean
	branchFilter: string[]
	commits: GraphCommit[]
	historyCursor: string | null
	historyHasMore: boolean
	search: string
	selection: VersionSelection | null
	comparison: { old: VersionSelection; current: VersionSelection } | null
	group: WorkingTreeGroup
	diff: DiffSessionInfo | null
	files: DiffFile[]
	selectedFileIds: Set<number>
	activeFile: DiffFile | null
	conflictPerspective: ConflictPerspective
	loading: boolean
	exportEvent: ExportEvent | null
	setLaunch: (nonce: string) => void
	connect: (callback: VersionControlCallback) => Promise<void>
	openRemoteRepository: (url: string) => Promise<void>
	selectRepository: () => Promise<void>
	chooseRepositoryCandidate: (candidateId: string) => Promise<void>
	connectHistory: () => Promise<void>
	closeRepository: () => Promise<void>
	loadBranches: () => Promise<void>
	loadMoreHistory: () => Promise<void>
	setBranchFilter: (branchRefs: string[]) => void
	setSearch: (query: string) => Promise<void>
	selectVersion: (selection: VersionSelection) => Promise<void>
	compareWith: (selection: VersionSelection) => Promise<void>
	clearComparison: () => Promise<void>
	setGroup: (group: WorkingTreeGroup) => Promise<void>
	refresh: () => Promise<void>
	toggleFile: (fileId: number) => void
	toggleFiles: (fileIds: number[], selected: boolean) => void
	invertFiles: (fileIds: number[]) => void
	openFile: (file: DiffFile | null) => void
	setPerspective: (perspective: ConflictPerspective) => void
	prepareExport: (format: ExportFormat, layout: ExportLayout) => Promise<{ cancelled: boolean; exportTargetId?: string; insideRepository?: boolean }>
	confirmExport: (targetId: string, allowInside: boolean) => Promise<void>
	cancelExport: (targetId: string) => Promise<void>
	clearError: () => void
	clearCandidates: () => void
	disconnect: () => void
}

const initialSession = {
	repository: null,
	candidates: [],
	overview: null,
	branches: [],
	branchesLoaded: false,
	branchesLoading: false,
	branchFilter: [],
	commits: [],
	historyCursor: null,
	historyHasMore: false,
	selection: null,
	comparison: null,
	diff: null,
	files: [],
	selectedFileIds: new Set<number>(),
	activeFile: null,
	exportEvent: null
}

const DIFF_INTENT_DEBOUNCE_MS = 90
const BRANCH_FILTER_DEBOUNCE_MS = 220
let latestDiffGeneration = 0
let diffQueue: Promise<void> = Promise.resolve()
let latestHistoryGeneration = 0
let branchFilterTimer: number | null = null
const historyRequests = new Map<string, Promise<void>>()

export const useVersionControlStore = create<VersionControlState>((set, get) => ({
	agentBridge: null,
	connection: 'idle',
	expectedNonce: null,
	error: null,
	...initialSession,
	search: '',
	group: 'all',
	conflictPerspective: 'base-to-ours',
	loading: false,

	setLaunch: nonce => set({ connection: 'launching', expectedNonce: nonce, error: null }),

	connect: async callback => {
		invalidateDiffLoads()
		invalidateHistoryLoads()
		if (get().expectedNonce && callback.nonce !== get().expectedNonce) return
		if (callback.error === 'agent_busy') {
			set({ connection: 'error', expectedNonce: null, error: 'Agent 正被快传或另一个版本控制器会话占用，请先关闭它。' })
			return
		}
		set({ connection: 'connecting', error: null })
		const bridge = new VersionControlBridge()
		try {
			await bridge.connect(callback)
			bridge.onExport(event => {
				set({ exportEvent: event })
				if (event.type === 'export-complete' && event.insideRepository) void get().refresh()
			})
			get().agentBridge?.close()
			set({ agentBridge: bridge, connection: 'connected', expectedNonce: null })
		} catch (error) {
			bridge.close()
			set({ connection: 'error', error: message(error) })
		}
	},

	openRemoteRepository: async url => {
		invalidateDiffLoads()
		return run(set, async () => {
			const repository = await GitHubRestRepositoryDataSource.open(url)
			const overview = await repository.connectHistory()
			get().repository?.dispose?.()
			const historyGeneration = invalidateHistoryLoads()
			set({ ...initialSession, repository, overview, search: '', group: 'all', loading: true })
			await loadHistory(get, set, true, historyGeneration)
			const first = get().commits[0]
			if (first) await get().selectVersion({ kind: 'commit', commit: first })
		})
	},

	selectRepository: async () => {
		invalidateDiffLoads()
		return run(set, async () => {
			const bridge = required(get().agentBridge, 'Agent 尚未连接')
			const selected = await bridge.selectRepository()
			if (selected.cancelled) return
			if (selected.candidates?.length) {
				set({ candidates: selected.candidates, error: null })
				return
			}
			if (!selected.repositoryId || !selected.overview) return
			const historyGeneration = invalidateHistoryLoads()
			set({ ...initialSession, candidates: [], repository: new LocalAgentRepositoryDataSource(bridge, selected.repositoryId), overview: selected.overview, loading: true })
			await loadHistory(get, set, true, historyGeneration)
			if (selected.overview.isBare) {
				const first = get().commits[0]
				if (first) await get().selectVersion({ kind: 'commit', commit: first })
			}
		})
	},

	chooseRepositoryCandidate: async candidateId => {
		invalidateDiffLoads()
		return run(set, async () => {
			const bridge = required(get().agentBridge, 'Agent 尚未连接')
			const selected = await bridge.openRepositoryCandidate(candidateId)
			if (selected.cancelled || !selected.repositoryId || !selected.overview) return
			const historyGeneration = invalidateHistoryLoads()
			set({ ...initialSession, candidates: [], repository: new LocalAgentRepositoryDataSource(bridge, selected.repositoryId), overview: selected.overview, loading: true })
			await loadHistory(get, set, true, historyGeneration)
			if (selected.overview.isBare) {
				const first = get().commits[0]
				if (first) await get().selectVersion({ kind: 'commit', commit: first })
			}
		})
	},

	connectHistory: async () => {
		return run(set, async () => {
			const repository = required(get().repository, '尚未打开项目')
			const overview = await repository.connectHistory()
			const historyGeneration = invalidateHistoryLoads()
			set({ overview, commits: [], historyCursor: null, historyHasMore: false })
			await loadHistory(get, set, true, historyGeneration)
		})
	},

	closeRepository: async () => {
		invalidateDiffLoads()
		invalidateHistoryLoads()
		return run(set, async () => {
			const { repository } = get()
			if (repository) await repository.close()
			repository?.dispose?.()
			set({ ...initialSession, candidates: [] })
		})
	},

	loadBranches: async () => {
		const { repository, branchesLoaded, branchesLoading } = get()
		if (!repository?.getBranches || branchesLoaded || branchesLoading) return
		set({ branchesLoading: true, error: null })
		try {
			const branches = await repository.getBranches()
			if (get().repository === repository) set({ branches, branchesLoaded: true })
		} catch (error) {
			if (get().repository === repository) set({ error: message(error) })
		} finally {
			if (get().repository === repository) set({ branchesLoading: false })
		}
	},

	loadMoreHistory: async () => run(set, () => loadHistory(get, set, false, latestHistoryGeneration)),

	setBranchFilter: branchRefs => {
		const branches = get().branches
		const branchFilter = normalizeBranchFilter(branchRefs, branches)
		if (sameStrings(branchFilter, get().branchFilter)) return
		invalidateDiffLoads()
		const generation = invalidateHistoryLoads()
		set({
			branchFilter,
			commits: [],
			historyCursor: null,
			historyHasMore: false,
			selection: null,
			comparison: null,
			diff: null,
			files: [],
			selectedFileIds: new Set<number>(),
			activeFile: null,
			loading: true,
			error: null
		})
		branchFilterTimer = window.setTimeout(() => {
			branchFilterTimer = null
			void loadHistory(get, set, true, generation).then(
				() => generation === latestHistoryGeneration && set({ loading: false }),
				error => generation === latestHistoryGeneration && set({ loading: false, error: message(error) })
			)
		}, BRANCH_FILTER_DEBOUNCE_MS)
	},

	setSearch: async query => {
		const generation = invalidateHistoryLoads()
		return run(set, async () => {
			set({ search: query, commits: [], historyCursor: null, historyHasMore: false })
			await loadHistory(get, set, true, generation)
		})
	},

	selectVersion: async selection => {
		set({ selection, comparison: null, group: selection.kind === 'working-tree' ? get().group : 'all' })
		await scheduleDiff(set, generation => openSelection(get, set, selection, generation))
	},

	compareWith: async current => {
		const old = get().selection
		if (!old || sameSelection(old, current)) return
		const comparison = old.kind === 'working-tree' && current.kind === 'commit' ? { old: current, current: old } : { old, current }
		set({ comparison })
		await scheduleDiff(set, generation => openComparison(get, set, comparison.old, comparison.current, generation))
	},

	clearComparison: async () => {
		const selection = get().selection
		if (!selection) return
		set({ comparison: null })
		await scheduleDiff(set, generation => openSelection(get, set, selection, generation))
	},

	setGroup: async group => {
		set({ group })
		const selection = get().selection
		if (selection?.kind === 'working-tree' && !get().comparison)
			await scheduleDiff(set, generation => openSelection(get, set, selection, generation))
	},

	refresh: async () => {
		const selectedPaths = new Set(
			get()
				.files.filter(file => get().selectedFileIds.has(file.fileId))
				.map(file => file.path)
		)
		const activePath = get().activeFile?.path
		await scheduleDiff(set, async generation => {
			const repository = required(get().repository, '尚未打开项目')
			const selection = get().selection
			const comparison = get().comparison
			const hadBranchesLoaded = get().branchesLoaded
			const overview = await repository.refresh()
			const branches = hadBranchesLoaded && repository.getBranches ? await repository.getBranches() : []
			if (!isLatestDiff(generation)) return
			const historyGeneration = invalidateHistoryLoads()
			set({
				overview,
				branches,
				branchesLoaded: hadBranchesLoaded && Boolean(repository.getBranches),
				branchesLoading: false,
				branchFilter: normalizeBranchFilter(get().branchFilter, branches),
				commits: [],
				historyCursor: null,
				historyHasMore: false
			})
			await loadHistory(get, set, true, historyGeneration)
			if (!isLatestDiff(generation)) return
			const supportsWorkingTree = overview.capabilities?.hasWorkingTree !== false && !overview.isBare
			const fallback = supportsWorkingTree
				? ({ kind: 'working-tree', label: '工作区' } as VersionSelection)
				: get().commits[0]
					? ({ kind: 'commit', commit: get().commits[0] } as VersionSelection)
					: null
			const valid = selection?.kind === 'commit' && !get().commits.some(item => item.hash === selection.commit.hash) ? fallback : selection
			set({ selection: valid || null })
			if (!valid) return
			const comparisonOldHash = comparison?.old.kind === 'commit' ? comparison.old.commit.hash : null
			if (comparison && comparisonOldHash && get().commits.some(item => item.hash === comparisonOldHash))
				await openComparison(get, set, comparison.old, comparison.current, generation)
			else await openSelection(get, set, valid, generation)
			if (!isLatestDiff(generation)) return
			const refreshedFiles = get().files
			set({
				selectedFileIds: new Set(
					refreshedFiles.filter(file => selectedPaths.has(file.path) && isSelectableFile(file)).map(file => file.fileId)
				),
				activeFile: activePath ? refreshedFiles.find(file => file.path === activePath) || null : null
			})
		})
	},

	toggleFile: fileId =>
		set(state => {
			const selected = new Set(state.selectedFileIds)
			if (selected.has(fileId)) selected.delete(fileId)
			else selected.add(fileId)
			return { selectedFileIds: selected }
		}),

	toggleFiles: (fileIds, selected) =>
		set(state => {
			const next = new Set(state.selectedFileIds)
			for (const fileId of fileIds) selected ? next.add(fileId) : next.delete(fileId)
			return { selectedFileIds: next }
		}),

	invertFiles: fileIds =>
		set(state => {
			const next = new Set(state.selectedFileIds)
			for (const fileId of fileIds) next.has(fileId) ? next.delete(fileId) : next.add(fileId)
			return { selectedFileIds: next }
		}),

	openFile: activeFile => set({ activeFile }),
	setPerspective: conflictPerspective => set({ conflictPerspective }),

	prepareExport: async (format, layout) => {
		const { repository, diff, files, selectedFileIds } = get()
		const source = required(repository, '尚未打开项目')
		if (!source.prepareExport) throw new Error('当前仓库不支持导出')
		return source.prepareExport(required(diff, '尚未创建比较').diffId, format, layout, [...selectedFileIds], files.length)
	},
	confirmExport: async (targetId, allowInside) => {
		const source = required(get().repository, '尚未打开项目')
		if (!source.confirmExport) throw new Error('当前仓库不支持导出')
		await source.confirmExport(targetId, allowInside)
	},
	cancelExport: async targetId => {
		const source = required(get().repository, '尚未打开项目')
		if (!source.cancelExport) throw new Error('当前仓库不支持导出')
		await source.cancelExport(targetId)
	},
	clearError: () => set({ error: null }),
	clearCandidates: () => set({ candidates: [] }),
	disconnect: () => {
		invalidateDiffLoads()
		invalidateHistoryLoads()
		get().repository?.dispose?.()
		get().agentBridge?.close()
		set({ agentBridge: null, connection: 'idle', expectedNonce: null, error: null, ...initialSession, candidates: [] })
	}
}))

async function loadHistory(
	get: () => VersionControlState,
	set: (partial: Partial<VersionControlState>) => void,
	reset: boolean,
	generation: number
) {
	const { repository, search, branchFilter } = get()
	if (!repository) return
	const cursor = reset ? null : get().historyCursor
	if (!reset && !get().historyHasMore) return
	const key = `${generation}:${repository.key}:${search}:${JSON.stringify(branchFilter)}:${cursor || 'start'}`
	let request = historyRequests.get(key)
	if (!request) {
		request = repository.getHistory(search, cursor, undefined, branchFilter).then(page => {
			if (
				generation !== latestHistoryGeneration ||
				get().repository !== repository ||
				get().search !== search ||
				!sameStrings(get().branchFilter, branchFilter)
			)
				return
			if (!reset && get().historyCursor !== cursor) return
			set({ commits: reset ? page.items : [...get().commits, ...page.items], historyCursor: page.nextCursor, historyHasMore: page.nextCursor !== null })
		})
		historyRequests.set(key, request)
	}
	try {
		await request
	} catch (error) {
		if (generation === latestHistoryGeneration) throw error
	} finally {
		if (historyRequests.get(key) === request) historyRequests.delete(key)
	}
}

async function openSelection(
	get: () => VersionControlState,
	set: (partial: Partial<VersionControlState>) => void,
	selection: VersionSelection,
	generation: number
) {
	const overview = required(get().overview, '仓库状态不可用')
	if (selection.kind === 'working-tree') {
		const oldRevision: RevisionRef = overview.headHash ? { kind: 'commit', oid: overview.headHash } : { kind: 'empty' }
		await openDiff(get, set, oldRevision, { kind: 'working-tree' }, get().group, generation)
		return
	}
	const commit = selection.commit
	const oldRevision: RevisionRef = commit.parentHashes[0] ? { kind: 'commit', oid: commit.parentHashes[0] } : { kind: 'empty' }
	const newRevision: RevisionRef = commit.isStash ? { kind: 'stash', oid: commit.hash } : { kind: 'commit', oid: commit.hash }
	await openDiff(get, set, oldRevision, newRevision, 'all', generation)
}

async function openComparison(
	get: () => VersionControlState,
	set: (partial: Partial<VersionControlState>) => void,
	old: VersionSelection,
	current: VersionSelection,
	generation: number
) {
	await openDiff(get, set, revisionFor(old), revisionFor(current), 'all', generation)
}

function revisionFor(selection: VersionSelection): RevisionRef {
	if (selection.kind === 'working-tree') return { kind: 'working-tree' }
	return selection.commit.isStash ? { kind: 'stash', oid: selection.commit.hash } : { kind: 'commit', oid: selection.commit.hash }
}

async function openDiff(
	get: () => VersionControlState,
	set: (partial: Partial<VersionControlState>) => void,
	oldRevision: RevisionRef,
	newRevision: RevisionRef,
	group: WorkingTreeGroup,
	generation: number
) {
	const repository = required(get().repository, '尚未打开项目')
	const diff = await repository.openDiff(oldRevision, newRevision, group)
	if (!isLatestDiff(generation)) return
	const firstPage = await repository.getDiffFiles(diff.diffId, null)
	if (!isLatestDiff(generation)) return
	set({
		diff,
		files: firstPage.items,
		selectedFileIds: new Set(firstPage.items.filter(isSelectableFile).map(file => file.fileId)),
		activeFile: null
	})
	let cursor = firstPage.nextCursor
	while (cursor !== null) {
		const page = await repository.getDiffFiles(diff.diffId, cursor)
		if (!isLatestDiff(generation)) return
		const state = get()
		const files = [...state.files, ...page.items]
		const selectedFileIds = new Set(state.selectedFileIds)
		for (const file of page.items) {
			if (isSelectableFile(file)) selectedFileIds.add(file.fileId)
		}
		set({ files, selectedFileIds })
		cursor = page.nextCursor
	}
}

function isSelectableFile(file: DiffFile) {
	return !file.isBinary && !file.exportTooLarge && file.nodeKind !== 'dir'
}

function normalizeBranchFilter(branchRefs: string[], branches: RepositoryBranch[]) {
	if (!branchRefs.length || !branches.length) return []
	const selected = new Set(branchRefs)
	return branches.filter(branch => selected.has(branch.id)).map(branch => branch.id)
}

function sameStrings(left: string[], right: string[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

async function scheduleDiff(
	set: (partial: Partial<VersionControlState>) => void,
	action: (generation: number) => Promise<void>
) {
	const generation = ++latestDiffGeneration
	set({ loading: true, error: null, diff: null, files: [], selectedFileIds: new Set<number>(), activeFile: null })
	await new Promise(resolve => window.setTimeout(resolve, DIFF_INTENT_DEBOUNCE_MS))
	if (!isLatestDiff(generation)) return

	const queued = diffQueue.catch(() => undefined).then(async () => {
		if (!isLatestDiff(generation)) return
		try {
			await action(generation)
		} catch (error) {
			if (isLatestDiff(generation)) set({ error: message(error) })
		} finally {
			if (isLatestDiff(generation)) set({ loading: false })
		}
	})
	diffQueue = queued
	await queued
}

function invalidateDiffLoads() {
	latestDiffGeneration += 1
}

function invalidateHistoryLoads() {
	if (branchFilterTimer !== null) {
		window.clearTimeout(branchFilterTimer)
		branchFilterTimer = null
	}
	latestHistoryGeneration += 1
	return latestHistoryGeneration
}

function isLatestDiff(generation: number) {
	return generation === latestDiffGeneration
}

async function run(set: (partial: Partial<VersionControlState>) => void, action: () => Promise<void>) {
	set({ loading: true, error: null })
	try {
		await action()
	} catch (error) {
		set({ error: message(error) })
	} finally {
		set({ loading: false })
	}
}

function sameSelection(left: VersionSelection, right: VersionSelection) {
	return left.kind === right.kind && (left.kind === 'working-tree' || right.kind === 'working-tree' || left.commit.hash === right.commit.hash)
}

function required<T>(value: T | null | undefined, error: string): T {
	if (value == null) throw new Error(error)
	return value
}

function message(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
