import { describe, expect, it } from 'vitest'
import { buildGitGraphDisplayCommits, computeGitGraphLayout, isCollapsedStashCommit } from '../../src/lib/version-control/graph-layout'
import type { GraphCommit } from '../../src/lib/version-control/types'

function commit(hash: string, parents: string[] = [], extra: Partial<GraphCommit> = {}): GraphCommit {
  return { hash, shortHash: hash.slice(0, 7), author: 'tester', timestampMs: 1, message: hash, parentHashes: parents, refs: [], isStash: false, ...extra }
}

describe('version-control graph layout', () => {
  it('collapses stash helper commits that are present in the history', () => {
    const commits = [
      commit('stash', ['base', 'index', 'untracked'], { isStash: true }),
      commit('index', ['base']),
      commit('untracked', ['base']),
      commit('base')
    ]
    const display = buildGitGraphDisplayCommits(commits)
    expect(display.map(item => item.hash)).toEqual(['stash', 'base'])
    expect(display[0].parentHashes).toEqual(['base'])
    expect(isCollapsedStashCommit(display[0])).toBe(true)
  })

  it('does not hide unrelated parents when a stash helper hash is absent', () => {
    const display = buildGitGraphDisplayCommits([commit('stash', ['base', 'missing'], { isStash: true }), commit('base')])
    expect(display.map(item => item.hash)).toEqual(['stash', 'base'])
  })

  it('keeps all swimlane parent ids inside the displayed commit set', () => {
    const display = buildGitGraphDisplayCommits([
      commit('merge', ['left', 'right']), commit('left', ['root']), commit('right', ['root']), commit('root')
    ])
    const { rows } = computeGitGraphLayout(display)
    const hashes = new Set(display.map(item => item.hash))
    for (const row of rows) {
      for (const lane of [...row.inputSwimlanes, ...row.outputSwimlanes]) expect(hashes.has(lane.id)).toBe(true)
    }
  })

  it('filters parents that are outside the loaded history page', () => {
    const display = buildGitGraphDisplayCommits([commit('head', ['not-loaded'])])
    expect(computeGitGraphLayout(display).rows[0].commit.parentHashes).toEqual([])
  })
})
