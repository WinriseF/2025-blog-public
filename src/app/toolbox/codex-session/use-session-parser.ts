'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParserWorkerResponse, SessionParseResult } from '@/lib/codex-session/types'

type ParserState =
	| { status: 'idle' }
	| { status: 'parsing'; file: File; bytesRead: number; records: number }
	| { status: 'success'; file: File; result: SessionParseResult }
	| { status: 'error'; file?: File; message: string }

export function useSessionParser() {
	const [state, setState] = useState<ParserState>({ status: 'idle' })
	const workerRef = useRef<Worker | null>(null)
	const requestRef = useRef(0)

	const stopWorker = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
	}, [])

	useEffect(() => stopWorker, [stopWorker])

	const parse = useCallback(
		(file: File) => {
			stopWorker()
			const id = ++requestRef.current
			if (!file.size) {
				setState({ status: 'error', file, message: '文件为空，无法解析' })
				return
			}

			let worker: Worker
			try {
				worker = new Worker(new URL('../../../lib/codex-session/parser.worker.ts', import.meta.url), { type: 'module' })
			} catch (error) {
				setState({ status: 'error', file, message: `解析 Worker 初始化失败：${error instanceof Error ? error.message : '浏览器不支持 Worker'}` })
				return
			}

			workerRef.current = worker
			setState({ status: 'parsing', file, bytesRead: 0, records: 0 })
			worker.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
				const response = event.data
				if (response.id !== requestRef.current) return
				if (response.type === 'progress') {
					setState(current =>
						current.status === 'parsing'
							? { ...current, bytesRead: response.bytesRead, records: response.records }
							: current
					)
				} else if (response.type === 'success') {
					setState({ status: 'success', file, result: response.result })
					stopWorker()
				} else {
					setState({ status: 'error', file, message: response.message })
					stopWorker()
				}
			}
			worker.onerror = event => {
				if (id !== requestRef.current) return
				setState({ status: 'error', file, message: `解析 Worker 运行失败：${event.message || '未知错误'}` })
				stopWorker()
			}
			try {
				worker.postMessage({ type: 'parse', id, file })
			} catch (error) {
				setState({ status: 'error', file, message: `无法把文件交给解析 Worker：${error instanceof Error ? error.message : '未知错误'}` })
				stopWorker()
			}
		},
		[stopWorker]
	)

	const cancel = useCallback(() => {
		const id = requestRef.current
		workerRef.current?.postMessage({ type: 'cancel', id })
		requestRef.current++
		stopWorker()
		setState({ status: 'idle' })
	}, [stopWorker])

	const clear = useCallback(() => {
		requestRef.current++
		stopWorker()
		setState({ status: 'idle' })
	}, [stopWorker])

	return { state, parse, cancel, clear }
}
