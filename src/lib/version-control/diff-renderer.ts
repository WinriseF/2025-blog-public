import { parseDiffFromFile, parsePatchFiles, type ChangeTypes, type FileContents, type FileDiffMetadata } from '@pierre/diffs'
import type { DiffFile } from './types'

export type DiffViewerSource = { kind: 'patch'; patch: string } | { kind: 'files'; original: string; modified: string }

export type DiffRenderRequest = {
	id: number
	modelKey: string
	file: DiffFile
	source: DiffViewerSource
}

export type DiffRenderResponse =
	| { id: number; type: 'success'; metadata: FileDiffMetadata }
	| { id: number; type: 'error'; error: string }

export function buildDiffMetadata({ modelKey, file, source }: Omit<DiffRenderRequest, 'id'>): FileDiffMetadata {
	let metadata: FileDiffMetadata
	try {
		metadata = source.kind === 'patch' ? parsePatch(source.patch, modelKey, file) : parseFiles(source, modelKey, file)
	} catch (error) {
		if (!hasTextChanges(file)) metadata = emptyMetadata(modelKey, file, source.kind === 'patch')
		else throw error
	}
	return normalizeMetadata(metadata, modelKey, file)
}

function parsePatch(patch: string, modelKey: string, file: DiffFile) {
	const files = parsePatchFiles(patch, modelKey, true).flatMap(item => item.files)
	if (!files.length && !hasTextChanges(file)) return emptyMetadata(modelKey, file, true)
	if (files.length !== 1) throw new Error(`Patch 应只包含一个文件，实际解析到 ${files.length} 个`)
	return files[0]
}

function parseFiles(source: Extract<DiffViewerSource, { kind: 'files' }>, modelKey: string, file: DiffFile) {
	const type = changeType(file)
	const oldFile: FileContents = {
		name: type === 'new' ? '/dev/null' : file.oldPath || file.path,
		contents: type === 'new' ? '' : source.original,
		cacheKey: `${modelKey}:old`
	}
	const newFile: FileContents = {
		name: type === 'deleted' ? '/dev/null' : file.path,
		contents: type === 'deleted' ? '' : source.modified,
		cacheKey: `${modelKey}:new`
	}
	return parseDiffFromFile(oldFile, newFile, undefined, true)
}

function normalizeMetadata(metadata: FileDiffMetadata, modelKey: string, file: DiffFile): FileDiffMetadata {
	const type = changeType(file)
	return {
		...metadata,
		name: file.path,
		prevName: type === 'rename-pure' || type === 'rename-changed' ? file.oldPath || undefined : undefined,
		type,
		cacheKey: modelKey
	}
}

function emptyMetadata(modelKey: string, file: DiffFile, isPartial: boolean): FileDiffMetadata {
	return {
		name: file.path,
		prevName: file.oldPath || undefined,
		type: changeType(file),
		hunks: [],
		splitLineCount: 0,
		unifiedLineCount: 0,
		isPartial,
		deletionLines: [],
		additionLines: [],
		cacheKey: modelKey
	}
}

function changeType(file: DiffFile): ChangeTypes {
	if (file.status === 'Renamed' || (file.oldPath && file.oldPath !== file.path)) return hasTextChanges(file) ? 'rename-changed' : 'rename-pure'
	if (file.status === 'Added' || file.status === 'Unversioned') return 'new'
	if (file.status === 'Deleted' || file.status === 'Missing') return 'deleted'
	return 'change'
}

function hasTextChanges(file: DiffFile) {
	return file.additions > 0 || file.deletions > 0
}
