import { describe, expect, it } from 'vitest'
import { scanZipFiles, selectedZipEntries, suggestedZipName, toggleZipSubtree, analyzeZipSelection } from '../../src/lib/zip-packer'

describe('ZIP selection helpers', () => {
  it('sanitizes Windows-reserved filename characters and trailing dots/spaces', () => {
    expect(suggestedZipName('a<b>:c"d/e\\f|g?h* .')).toBe('a-b--c-d-e-f-g-h-.zip')
    expect(suggestedZipName('...')).toBe('archive.zip')
  })

  it('derives a stable root name for a single file and archive for multiple files', () => {
    expect(scanZipFiles([new File(['x'], 'report.txt')]).rootName).toBe('report')
    expect(scanZipFiles([new File(['x'], 'a.txt'), new File(['x'], 'b.txt')]).rootName).toBe('archive')
  })

  it('toggles an entire subtree and returns a new Set', () => {
    const nodes: any[] = [
      { id: 'r', children: ['a'], kind: 'directory' }, { id: 'a', children: ['b'], kind: 'directory' }, { id: 'b', children: [], kind: 'file', size: 2 }
    ]
    const map = new Map(nodes.map(n => [n.id, n]))
    const original = new Set<string>()
    const selected = toggleZipSubtree(map as never, original, 'r', true)
    expect(selected).toEqual(new Set(['r', 'a', 'b']))
    expect(original.size).toBe(0)
    const analysis = analyzeZipSelection(nodes as never, selected)
    expect(selectedZipEntries(nodes as never, analysis.states)).toEqual(new Set(['r', 'a', 'b']))
  })
})
