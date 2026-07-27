'use client'

import { create } from 'zustand'
import { VersionControlBridge } from './bridge'
import type {
	ConflictPerspective,
	DiffFile,
	DiffSessionInfo,
	ExportEvent,
	ExportFormat,
	ExportLayout,
	GraphCommit,
	RepositoryOverview,
	RevisionRef,
	VersionControlCallback,
	WorkingTreeGroup
} from './types'

export type VersionSelection = { kind: 'working-tree'; label: string } | { kind: 'commit'; commit: GraphCommit }

type VersionControlState = {
	bridge: VersionControlBridge | null
	connection: 'idle' | 'launching' | 'connecting' | 'connected' | 'error'
	expectedNonce: string | null
	error: string | null
	repositoryId: string | null
	overview: RepositoryOverview | null
	commits: GraphCommit[]
	historySkip: number
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
	selectRepository: () => Promise<void>
	closeRepository: () => Promise<void>
	loadMoreHistory: () => Promise<void>
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
	disconnect: () => void
}

const initialSession = {
	repositoryId: null,
	overview: null,
	commits: [],
	historySkip: 0,
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
let latestDiffGeneration = 0
let diffQueue: Promise<void> = Promise.resolve()
let latestHistoryGeneration = 0
const historyRequests = new Map<string, Promise<void>>()

export const useVersionControlStore = create<VersionControlState>((set, get) => ({
	bridge: null,
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
			get().bridge?.close()
			set({ bridge, connection: 'connected', expectedNonce: null })
		} catch (error) {
			bridge.close()
			set({ connection: 'error', error: message(error) })
		}
	},

	selectRepository: async () => {
		invalidateDiffLoads()
		return run(set, async () => {
			const bridge = required(get().bridge, 'Agent 尚未连接')
			const selected = await bridge.selectRepository()
			if (selected.cancelled || !selected.repositoryId || !selected.overview) return
			const historyGeneration = invalidateHistoryLoads()
			set({ ...initialSession, repositoryId: selected.repositoryId, overview: selected.overview, loading: true })
			await loadHistory(get, set, true, historyGeneration)
			if (selected.overview.isBare) {
				const first = get().commits[0]
				if (first) await get().selectVersion({ kind: 'commit', commit: first })
			} else await get().selectVersion({ kind: 'working-tree', label: '工作区' })
		})
	},

	closeRepository: async () => {
		invalidateDiffLoads()
		invalidateHistoryLoads()
		return run(set, async () => {
			const { bridge, repositoryId } = get()
			if (bridge && repositoryId) await bridge.closeRepository(repositoryId)
			set({ ...initialSession })
		})
	},

	loadMoreHistory: async () => run(set, () => loadHistory(get, set, false, latestHistoryGeneration)),

	setSearch: async query => {
		const generation = invalidateHistoryLoads()
		return run(set, async () => {
			set({ search: query, commits: [], historySkip: 0, historyHasMore: false })
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
			const bridge = required(get().bridge, 'Agent 尚未连接')
			const repositoryId = required(get().repositoryId, '尚未打开项目')
			const selection = get().selection
			const comparison = get().comparison
			const overview = await bridge.refresh(repositoryId)
			if (!isLatestDiff(generation)) return
			const historyGeneration = invalidateHistoryLoads()
			set({ overview, commits: [], historySkip: 0, historyHasMore: false })
			await loadHistory(get, set, true, historyGeneration)
			if (!isLatestDiff(generation)) return
			const valid =
				selection?.kind === 'commit' && !get().commits.some(item => item.hash === selection.commit.hash)
					? ({ kind: 'working-tree', label: '工作区' } as VersionSelection)
					: selection
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
					refreshedFiles.filter(file => selectedPaths.has(file.path) && !file.isBinary && !file.exportTooLarge).map(file => file.fileId)
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
		const { bridge, repositoryId, diff, files, selectedFileIds } = get()
		return required(bridge, 'Agent 尚未连接').prepareExport(required(repositoryId, '尚未打开项目'), required(diff, '尚未创建比较').diffId, format, layout, [
			...selectedFileIds
		], files.length)
	},
	confirmExport: async (targetId, allowInside) => {
		await required(get().bridge, 'Agent 尚未连接').confirmExport(targetId, allowInside)
	},
	cancelExport: async targetId => {
		await required(get().bridge, 'Agent 尚未连接').cancelExport(targetId)
	},
	clearError: () => set({ error: null }),
	disconnect: () => {
		invalidateDiffLoads()
		invalidateHistoryLoads()
		get().bridge?.close()
		set({ bridge: null, connection: 'idle', expectedNonce: null, error: null, ...initialSession })
	}
}))

async function loadHistory(
	get: () => VersionControlState,
	set: (partial: Partial<VersionControlState>) => void,
	reset: boolean,
	generation: number
) {
	const { bridge, repositoryId, search } = get()
	if (!bridge || !repositoryId) return
	const skip = reset ? 0 : get().historySkip
	if (!reset && !get().historyHasMore) return
	const key = `${generation}:${repositoryId}:${search}:${skip}`
	let request = historyRequests.get(key)
	if (!request) {
		request = bridge.getHistory(repositoryId, search, skip).then(page => {
			if (generation !== latestHistoryGeneration || get().repositoryId !== repositoryId || get().search !== search) return
			if (!reset && get().historySkip !== skip) return
			set({ commits: reset ? page.items : [...get().commits, ...page.items], historySkip: page.nextSkip, historyHasMore: page.hasMore })
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
	await openDiff(get, set, revisionFor(old, get().overview), revisionFor(current, get().overview), 'all', generation)
}

function revisionFor(selection: VersionSelection, overview: RepositoryOverview | null): RevisionRef {
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
	const bridge = required(get().bridge, 'Agent 尚未连接')
	const repositoryId = required(get().repositoryId, '尚未打开项目')
	const diff = await bridge.openDiff(repositoryId, oldRevision, newRevision, group)
	if (!isLatestDiff(generation)) return
	const files: DiffFile[] = []
	let skip = 0
	let hasMore = true
	while (hasMore) {
		const page = await bridge.getDiffFiles(repositoryId, diff.diffId, skip)
		if (!isLatestDiff(generation)) return
		files.push(...page.items)
		skip = page.nextSkip
		hasMore = page.hasMore
	}
	set({ diff, files, selectedFileIds: new Set(files.filter(file => !file.isBinary && !file.exportTooLarge).map(file => file.fileId)), activeFile: null })
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
