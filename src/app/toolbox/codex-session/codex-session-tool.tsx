'use client'

import { useState } from 'react'
import type { SessionCollectionFilters, SessionSummary } from '@/lib/codex-session/types'
import { CollectionDashboard } from './collection-dashboard'
import { SessionDetail } from './session-detail'
import { SessionImport } from './session-surface'
import { useSessionCollection } from './use-session-collection'
import { useSessionParser } from './use-session-parser'

type ToolMode = 'import' | 'collection' | 'detail'

export function CodexSessionTool() {
	const detail = useSessionParser()
	const collection = useSessionCollection()
	const [mode, setMode] = useState<ToolMode>('import')
	const [detailFromCollection, setDetailFromCollection] = useState(false)
	const [collectionFilters, setCollectionFilters] = useState<SessionCollectionFilters>({})

	const importFiles = (inputFiles: File[]) => {
		const files = inputFiles.filter(file => /\.jsonl$/i.test(file.name))
		detail.clear()
		if (files.length === 1 && inputFiles.length === 1) {
			collection.clear()
			setDetailFromCollection(false)
			setMode('detail')
			detail.parse(files[0])
			return
		}
		setMode('collection')
		setDetailFromCollection(false)
		setCollectionFilters({})
		collection.parse(inputFiles)
	}

	const openSession = (session: SessionSummary) => {
		const file = collection.fileFor(session.key)
		if (!file) return
		setDetailFromCollection(true)
		setMode('detail')
		detail.parse(file)
	}

	const leaveDetail = () => {
		detail.clear()
		if (detailFromCollection && collection.state.status === 'success') setMode('collection')
		else setMode('import')
	}

	if (mode === 'collection' && collection.state.status === 'success') {
		return <CollectionDashboard
			sessions={collection.state.result.sessions}
			failures={collection.state.result.failures}
			ignoredFiles={collection.state.ignoredFiles}
			onSelect={openSession}
			onClear={() => { collection.clear(); setMode('import') }}
			onFiles={importFiles}
			filters={collectionFilters}
			onFiltersChange={setCollectionFilters}
		/>
	}

	if (mode === 'detail' && detail.state.status === 'success') {
		return <SessionDetail
			key={`${detail.state.result.meta.id ?? detail.state.file.name}-${detail.state.file.lastModified}`}
			result={detail.state.result}
			file={detail.state.file}
			onExit={leaveDetail}
			onFile={file => importFiles([file])}
			backToTimeline={detailFromCollection}
		/>
	}

	if (mode === 'detail') {
		return <SessionImport
			onFiles={importFiles}
			progress={detail.state.status === 'parsing' ? { currentName: detail.state.file.name, bytesRead: detail.state.bytesRead, totalBytes: detail.state.file.size, records: detail.state.records } : undefined}
			error={detail.state.status === 'error' ? detail.state.message : undefined}
			onCancel={leaveDetail}
		/>
	}

	const progress = collection.state.status === 'parsing' ? collection.state.progress : undefined
	return <SessionImport
		onFiles={importFiles}
		progress={progress}
		error={collection.state.status === 'error' ? collection.state.message : undefined}
		onCancel={collection.state.status === 'idle' ? undefined : () => { collection.cancel(); setMode('import') }}
	/>
}
