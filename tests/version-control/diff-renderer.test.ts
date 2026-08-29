import { describe, expect, it } from 'vitest'
import { buildDiffMetadata } from '../../src/lib/version-control/diff-renderer'
import type { DiffFile } from '../../src/lib/version-control/types'

function file(overrides: Partial<DiffFile> = {}): DiffFile {
  return { fileId: 1, path: 'a.txt', oldPath: null, status: 'Modified', groups: ['all'], additions: 1, deletions: 1, isBinary: false, isSubmodule: false, previewTooLarge: false, exportTooLarge: false, hasConflictViews: false, ...overrides }
}

describe('diff metadata normalization', () => {
  it('classifies added and deleted files', () => {
    expect(buildDiffMetadata({ modelKey: 'a', file: file({ status: 'Added', additions: 1, deletions: 0 }), source: { kind: 'files', original: '', modified: 'x\n' } }).type).toBe('new')
    expect(buildDiffMetadata({ modelKey: 'b', file: file({ status: 'Deleted', additions: 0, deletions: 1 }), source: { kind: 'files', original: 'x\n', modified: '' } }).type).toBe('deleted')
  })

  it('distinguishes pure rename from rename with text changes', () => {
    const pure = file({ status: 'Renamed', oldPath: 'old.txt', path: 'new.txt', additions: 0, deletions: 0 })
    const changed = file({ status: 'Renamed', oldPath: 'old.txt', path: 'new.txt', additions: 1, deletions: 1 })
    expect(buildDiffMetadata({ modelKey: 'r1', file: pure, source: { kind: 'files', original: 'x', modified: 'x' } }).type).toBe('rename-pure')
    expect(buildDiffMetadata({ modelKey: 'r2', file: changed, source: { kind: 'files', original: 'x', modified: 'y' } }).type).toBe('rename-changed')
  })

  it('returns empty metadata for non-text binary changes instead of crashing', () => {
    const metadata = buildDiffMetadata({ modelKey: 'bin', file: file({ additions: 0, deletions: 0, isBinary: true }), source: { kind: 'patch', patch: 'not a patch' } })
    expect(metadata.hunks).toEqual([])
    expect(metadata.cacheKey).toBe('bin')
  })
})
