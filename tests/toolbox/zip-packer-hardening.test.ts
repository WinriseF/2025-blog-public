import { describe, expect, it, vi } from 'vitest'
import {
  analyzeZipSelection,
  scanZipFiles,
  suggestedZipName,
  toggleZipSubtree,
  writeZipArchive,
  type ZipNode
} from '../../src/lib/zip-packer'

describe('ZIP packer hardening', () => {
  it('sanitizes Windows-forbidden output filename characters', () => {
    expect(suggestedZipName('a<b>c:d"e/f\\g|h?i* . ')).not.toMatch(/[<>:"/\\|?*]/)
    expect(suggestedZipName('...')).toBe('archive.zip')
  })

  it('keeps duplicate input filenames as distinct selected nodes', () => {
    const a = new File(['a'], 'same.txt', { lastModified: 1 })
    const b = new File(['bb'], 'same.txt', { lastModified: 2 })
    const scan = scanZipFiles([a, b])
    expect(scan.nodes).toHaveLength(2)
    expect(new Set(scan.nodes.map(node => node.id)).size).toBe(2)
    expect(scan.totalBytes).toBe(3)
  })

  it('handles paths far beyond the Windows 260-character legacy limit as data, not filesystem paths', () => {
    const long = `${'deep/'.repeat(70)}file.txt`
    const node: ZipNode = {
      id: long,
      parentId: null,
      children: [],
      name: 'file.txt',
      path: long,
      kind: 'file',
      size: 42,
      lastModified: 1,
      suggestedExcluded: false
    }
    expect(analyzeZipSelection([node], new Set([node.id])).stats).toEqual({ files: 1, bytes: 42 })
  })

  it('toggles an entire subtree deterministically', () => {
    const nodes: ZipNode[] = [
      { id: 'root', parentId: null, children: ['root/a', 'root/b'], name: 'root', path: 'root', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: false, loaded: true },
      { id: 'root/a', parentId: 'root', children: [], name: 'a', path: 'root/a', kind: 'file', size: 1, lastModified: 1, suggestedExcluded: false },
      { id: 'root/b', parentId: 'root', children: [], name: 'b', path: 'root/b', kind: 'file', size: 1, lastModified: 1, suggestedExcluded: false }
    ]
    const map = new Map(nodes.map(node => [node.id, node]))
    expect(toggleZipSubtree(map, new Set(), 'root', true)).toEqual(new Set(['root', 'root/a', 'root/b']))
    expect(toggleZipSubtree(map, new Set(['root', 'root/a', 'root/b']), 'root', false).size).toBe(0)
  })

  it('rejects a selected deferred directory before opening the output stream', async () => {
    const outputHandle = { createWritable: vi.fn() } as unknown as FileSystemFileHandle
    const scan = {
      rootId: 'root', rootName: 'root', totalBytes: 0, unloadedDirectories: 1, skippedEntries: [],
      nodes: [{ id: 'root', parentId: null, children: [], name: 'root', path: 'root', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: false, loaded: false }]
    } as never

    await expect(writeZipArchive({
      scan,
      selectedIds: new Set(['root']),
      compression: { level: 6, skipAlreadyCompressed: true },
      includeRoot: true,
      outputHandle,
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow('仍有已选目录尚未读取完成')
    expect(outputHandle.createWritable).not.toHaveBeenCalled()
  })

  it('rejects using a selected input file as the output archive', async () => {
    const outputHandle = { name: 'result.zip', createWritable: vi.fn() } as unknown as FileSystemFileHandle
    const scan = {
      rootId: 'root', rootName: 'root', totalBytes: 1, unloadedDirectories: 0, skippedEntries: [],
      rootHandle: { resolve: vi.fn(async () => ['result.zip']) },
      nodes: [{ id: 'root/result.zip', parentId: 'root', children: [], name: 'result.zip', path: 'root/result.zip', kind: 'file', size: 1, lastModified: 1, suggestedExcluded: false, file: new File(['x'], 'result.zip') }]
    } as never

    await expect(writeZipArchive({
      scan,
      selectedIds: new Set(['root/result.zip']),
      compression: { level: 6, skipAlreadyCompressed: true },
      includeRoot: true,
      outputHandle,
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow('输出 ZIP 不能同时作为输入文件')
    expect(outputHandle.createWritable).not.toHaveBeenCalled()
  })
})
