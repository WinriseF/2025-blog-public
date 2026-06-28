'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LanStorageEngine } from '@/lib/lan-transfer/storage/types'
import type { ReceivedLanFile } from '@/lib/lan-transfer/types'

type CachedReceivedFile = {
	engine: LanStorageEngine
	fileId: string
	url?: string
}

export function useLanReceivedFiles() {
	const [receivedFiles, setReceivedFiles] = useState<ReceivedLanFile[]>([])
	const cacheRef = useRef(new Map<string, CachedReceivedFile>())

	const addReceivedFile = useCallback((file: ReceivedLanFile, engine: LanStorageEngine, fileId: string) => {
		cacheRef.current.set(file.id, { engine, fileId, url: file.url })
		setReceivedFiles(files => [file, ...files])
	}, [])

	const clearReceivedFile = useCallback((fileId: string) => {
		const cached = cacheRef.current.get(fileId)
		if (cached) {
			cacheRef.current.delete(fileId)
			if (cached.url) URL.revokeObjectURL(cached.url)
			void cached.engine.cleanup(cached.fileId).catch(() => {})
		}
		setReceivedFiles(files => files.filter(file => file.id !== fileId))
	}, [])

	useEffect(() => {
		return () => {
			cacheRef.current.forEach(file => { if (file.url) URL.revokeObjectURL(file.url) })
			cacheRef.current.clear()
		}
	}, [])

	return { receivedFiles, addReceivedFile, clearReceivedFile }
}
