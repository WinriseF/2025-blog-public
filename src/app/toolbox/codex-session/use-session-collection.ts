'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParserWorkerResponse, SessionBatchResult } from '@/lib/codex-session/types'

export type CollectionProgress = {
	completedFiles: number
	totalFiles: number
	currentName: string
	bytesRead: number
	totalBytes: number
	records: number
}

type CollectionState =
	| { status: 'idle' }
	| { status: 'parsing'; progress: CollectionProgress }
	| { status: 'success'; result: SessionBatchResult; ignoredFiles: number }
	| { status: 'error'; message: string }

export function useSessionCollection() {
	const [state, setState] = useState<CollectionState>({ status: 'idle' })
	const workerRef = useRef<Worker | null>(null)
	const requestRef = useRef(0)
	const filesRef = useRef(new Map<string, File>())

	const stopWorker = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
	}, [])

	useEffect(() => stopWorker, [stopWorker])

	const parse = useCallback((inputFiles: File[]) => {
		stopWorker()
		const id = ++requestRef.current
		const files = inputFiles.filter(file => /\.jsonl$/i.test(file.name))
		const ignoredFiles = inputFiles.length - files.length
		if (!files.length) {
			setState({ status: 'error', message: '没有找到可解析的 JSONL 文件' })
			return
		}

		let worker: Worker
		try {
			worker = new Worker(new URL('../../../lib/codex-session/parser.worker.ts', import.meta.url), { type: 'module' })
		} catch (error) {
			setState({ status: 'error', message: `解析 Worker 初始化失败：${error instanceof Error ? error.message : '浏览器不支持 Worker'}` })
			return
		}

		filesRef.current.clear()
		const sources = files.map((file, index) => {
			const key = `source-${index}-${file.size}-${file.lastModified}`
			filesRef.current.set(key, file)
			return { key, file, relativePath: file.webkitRelativePath || undefined }
		})
		const totalBytes = files.reduce((total, file) => total + file.size, 0)
		workerRef.current = worker
		setState({
			status: 'parsing',
			progress: { completedFiles: 0, totalFiles: files.length, currentName: files[0].name, bytesRead: 0, totalBytes, records: 0 }
		})

		worker.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
			const response = event.data
			if (response.id !== requestRef.current) return
			if (response.type === 'batch-progress') setState({ status: 'parsing', progress: response })
			else if (response.type === 'batch-success') {
				setState({
					status: 'success',
					result: response.result,
					ignoredFiles
				})
				stopWorker()
			} else if (response.type === 'error') {
				setState({ status: 'error', message: response.message })
				stopWorker()
			}
		}
		worker.onerror = event => {
			if (id !== requestRef.current) return
			setState({ status: 'error', message: `解析 Worker 运行失败：${event.message || '未知错误'}` })
			stopWorker()
		}
		try {
			worker.postMessage({ type: 'parse-batch', id, sources })
		} catch (error) {
			setState({ status: 'error', message: `无法把文件交给解析 Worker：${error instanceof Error ? error.message : '未知错误'}` })
			stopWorker()
		}
	}, [stopWorker])

	const cancel = useCallback(() => {
		const id = requestRef.current
		workerRef.current?.postMessage({ type: 'cancel', id })
		requestRef.current++
		stopWorker()
		filesRef.current.clear()
		setState({ status: 'idle' })
	}, [stopWorker])

	const clear = useCallback(() => {
		requestRef.current++
		stopWorker()
		filesRef.current.clear()
		setState({ status: 'idle' })
	}, [stopWorker])

	const fileFor = useCallback((key: string) => filesRef.current.get(key), [])

	return { state, parse, cancel, clear, fileFor }
}
