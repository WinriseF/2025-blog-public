import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVersionControlStore } from '../../src/lib/version-control/store'
import type { DiffFile, GraphCommit, RepositoryDataSource, RepositoryOverview } from '../../src/lib/version-control/types'

const overview: RepositoryOverview = {
  repositoryKind: 'git', displayName: 'repo', currentBranch: 'main', isDetachedHead: false, isBare: false,
  headHash: 'head', headShortHash: 'head', upstreamBranch: null, ahead: 0, behind: 0,
  hasStagedChanges: false, hasUnstagedChanges: false, hasUntrackedFiles: false, conflictedCount: 0, stashCount: 0,
  capabilities: { canExport: true, supportsStaging: true, supportsHistory: true, hasWorkingTree: true }
}

function commit(hash: string, parents: string[] = []): GraphCommit {
  return { hash, shortHash: hash.slice(0, 7), author: 'a', timestampMs: 1, message: hash, parentHashes: parents, refs: [], isStash: false }
}

function file(fileId: number, overrides: Partial<DiffFile> = {}): DiffFile {
  return { fileId, path: `f${fileId}.ts`, oldPath: null, status: 'Modified', groups: ['all'], additions: 1, deletions: 0,
    isBinary: false, isSubmodule: false, previewTooLarge: false, exportTooLarge: false, hasConflictViews: false, nodeKind: 'file', ...overrides }
}

function repository(overrides: Partial<RepositoryDataSource> = {}): RepositoryDataSource {
  return {
    key: 'mock', source: 'local-agent', connectHistory: vi.fn(async () => overview), close: vi.fn(async () => {}), refresh: vi.fn(async () => overview),
    getHistory: vi.fn(async () => ({ items: [], nextCursor: null })), getDirectory: vi.fn(async () => ({ items: [], nextCursor: null })),
    openRepositoryFile: vi.fn(), openDiff: vi.fn(async () => ({ diffId: 'd', summary: {} as any, totalFiles: 4 })),
    getDiffFiles: vi.fn(async () => ({ items: [], nextCursor: null })), openPreview: vi.fn(), ...overrides
  } as RepositoryDataSource
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  useVersionControlStore.getState().disconnect()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('version control store', () => {
  it('opens a root commit against the empty revision and selects only exportable files', async () => {
    const files = [file(1), file(2, { isBinary: true }), file(3, { exportTooLarge: true }), file(4, { nodeKind: 'dir' })]
    const repo = repository({ getDiffFiles: vi.fn(async () => ({ items: files, nextCursor: null })) })
    useVersionControlStore.setState({ repository: repo, overview })
    const selected = commit('abc')
    const pending = useVersionControlStore.getState().selectVersion({ kind: 'commit', commit: selected })
    await vi.advanceTimersByTimeAsync(100); await pending
    expect(repo.openDiff).toHaveBeenCalledWith({ kind: 'empty' }, { kind: 'commit', oid: 'abc' }, 'all')
    expect([...useVersionControlStore.getState().selectedFileIds]).toEqual([1])
  })

  it('opens a normal commit against its first parent', async () => {
    const repo = repository()
    useVersionControlStore.setState({ repository: repo, overview })
    const pending = useVersionControlStore.getState().selectVersion({ kind: 'commit', commit: commit('child', ['parent', 'merge-parent']) })
    await vi.advanceTimersByTimeAsync(100); await pending
    expect(repo.openDiff).toHaveBeenCalledWith({ kind: 'commit', oid: 'parent' }, { kind: 'commit', oid: 'child' }, 'all')
  })

  it('normalizes working-tree vs commit comparisons into historical -> working-tree order', async () => {
    const repo = repository()
    useVersionControlStore.setState({ repository: repo, overview, selection: { kind: 'working-tree', label: '工作区' } })
    const pending = useVersionControlStore.getState().compareWith({ kind: 'commit', commit: commit('old') })
    await vi.advanceTimersByTimeAsync(100); await pending
    expect(repo.openDiff).toHaveBeenCalledWith({ kind: 'commit', oid: 'old' }, { kind: 'working-tree' }, 'all')
  })

  it('toggle/invert operations never mutate the previous Set instance', () => {
    useVersionControlStore.setState({ selectedFileIds: new Set([1, 2]) })
    const before = useVersionControlStore.getState().selectedFileIds
    useVersionControlStore.getState().toggleFile(2)
    const after = useVersionControlStore.getState().selectedFileIds
    expect(after).toEqual(new Set([1])); expect(after).not.toBe(before)
    useVersionControlStore.getState().invertFiles([1, 3])
    expect(useVersionControlStore.getState().selectedFileIds).toEqual(new Set([3]))
  })

  it('passes selected file ids and total file count to export', async () => {
    const prepareExport = vi.fn(async () => ({ cancelled: false, exportTargetId: 'x' }))
    const repo = repository({ prepareExport })
    useVersionControlStore.setState({ repository: repo, diff: { diffId: 'd', summary: {} as any, totalFiles: 3 }, files: [file(1), file(2), file(3)], selectedFileIds: new Set([1, 3]) })
    await useVersionControlStore.getState().prepareExport('json', 'unified')
    expect(prepareExport).toHaveBeenCalledWith('d', 'json', 'unified', expect.arrayContaining([1, 3]), 3)
  })
})
