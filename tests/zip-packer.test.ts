import { describe, expect, it, vi } from 'vitest'
import { analyzeZipSelection, initialZipSelection, loadZipDirectory, scanZipDirectory, type ZipNode } from '../src/lib/zip-packer'

type Entry = [string, FileSystemDirectoryHandle | FileSystemFileHandle]

function file(name: string, size: number, lastModified = 1) {
	const getFile = vi.fn(async () => ({ size, lastModified }) as File)
	return { handle: { kind: 'file', name, getFile } as unknown as FileSystemFileHandle, getFile }
}

function directory(name: string, entries: Entry[]) {
	return {
		kind: 'directory',
		name,
		async *entries() {
			for (const entry of entries) yield entry
		}
	} as unknown as FileSystemDirectoryHandle
}

describe('ZIP directory scanning', () => {
	it('only suggests exclusions for directories and defers their metadata reads', async () => {
		const buildFile = file('build', 12)
		const ignoredFile = file('ignored.ts', 24)
		const excludedDirectory = directory('dist', [['ignored.ts', ignoredFile.handle]])
		const root = directory('project', [['build', buildFile.handle], ['dist', excludedDirectory]])

		const scan = await scanZipDirectory(root, new AbortController().signal)
		const normalBuild = scan.nodes.find(node => node.id === 'project/build')!
		const dist = scan.nodes.find(node => node.id === 'project/dist')!

		expect(normalBuild.suggestedExcluded).toBe(false)
		expect(dist.suggestedExcluded).toBe(true)
		expect(dist.loaded).toBe(false)
		expect(ignoredFile.getFile).not.toHaveBeenCalled()
		expect(scan.unloadedDirectories).toBe(1)

		const loaded = await loadZipDirectory(scan, dist.id, new AbortController().signal)
		expect(ignoredFile.getFile).toHaveBeenCalledTimes(1)
		expect(loaded.nodes.find(node => node.id === 'project/dist/ignored.ts')?.size).toBe(24)
		expect(loaded.unloadedDirectories).toBe(0)
	})

	it('derives tree state and selected-file totals in one analysis', () => {
		const nodes: ZipNode[] = [
			{ id: 'root', parentId: null, children: ['root/one.txt', 'root/nested'], name: 'root', path: 'root', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: false, loaded: true },
			{ id: 'root/one.txt', parentId: 'root', children: [], name: 'one.txt', path: 'root/one.txt', kind: 'file', size: 10, lastModified: 1, suggestedExcluded: false },
			{ id: 'root/nested', parentId: 'root', children: ['root/nested/two.txt'], name: 'nested', path: 'root/nested', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: false, loaded: true },
			{ id: 'root/nested/two.txt', parentId: 'root/nested', children: [], name: 'two.txt', path: 'root/nested/two.txt', kind: 'file', size: 20, lastModified: 1, suggestedExcluded: false }
		]
		const selected = new Set(['root', 'root/one.txt', 'root/nested', 'root/nested/two.txt'])

		const analysis = analyzeZipSelection(nodes, selected)
		expect(analysis.states.get('root')).toBe('checked')
		expect(analysis.stats).toEqual({ files: 2, bytes: 30 })

		selected.delete('root/nested/two.txt')
		const partial = analyzeZipSelection(nodes, selected)
		expect(partial.states.get('root')).toBe('mixed')
		expect(partial.stats).toEqual({ files: 1, bytes: 10 })
	})

	it('keeps a deferred suggested directory out of the initial selection', () => {
		const nodes: ZipNode[] = [
			{ id: 'root', parentId: null, children: ['root/node_modules'], name: 'root', path: 'root', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: false, loaded: true },
			{ id: 'root/node_modules', parentId: 'root', children: [], name: 'node_modules', path: 'root/node_modules', kind: 'directory', size: 0, lastModified: 0, suggestedExcluded: true, loaded: false }
		]

		expect(initialZipSelection(nodes)).toEqual(new Set(['root']))
	})
})
