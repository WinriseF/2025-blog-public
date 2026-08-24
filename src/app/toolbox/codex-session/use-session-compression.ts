'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionCompressionReport, SessionCompressionScan, SessionCompressionSelection, SessionCompressionWorkerResponse } from '@/lib/codex-session/types'

type CompressionState =
	| { status: 'scanning'; bytesRead: number; records: number }
	| { status: 'ready'; scan: SessionCompressionScan }
	| { status: 'compressing'; scan: SessionCompressionScan; bytesRead: number; records: number }
	| { status: 'complete'; scan: SessionCompressionScan; report: SessionCompressionReport }
	| { status: 'error'; scan?: SessionCompressionScan; message: string }

function download(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.hidden = true
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function useSessionCompression(file: File) {
	const [state, setState] = useState<CompressionState>({ status: 'scanning', bytesRead: 0, records: 0 })
	const workerRef = useRef<Worker | null>(null)
	const requestRef = useRef(0)

	const stopWorker = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
	}, [])

	const createWorker = useCallback(() => {
		stopWorker()
		const worker = new Worker(new URL('../../../lib/codex-session/parser.worker.ts', import.meta.url), { type: 'module' })
		workerRef.current = worker
		return worker
	}, [stopWorker])

	const scan = useCallback(() => {
		const id = ++requestRef.current
		setState({ status: 'scanning', bytesRead: 0, records: 0 })
		let worker: Worker
		try {
			worker = createWorker()
		} catch (error) {
			setState({ status: 'error', message: `压缩 Worker 初始化失败：${error instanceof Error ? error.message : '浏览器不支持 Worker'}` })
			return
		}
		worker.onmessage = (event: MessageEvent<SessionCompressionWorkerResponse>) => {
			const response = event.data
			if (response.id !== requestRef.current) return
			if (response.type === 'compression-progress') setState({ status: 'scanning', bytesRead: response.bytesRead, records: response.records })
			else if (response.type === 'compression-scan-success') {
				setState({ status: 'ready', scan: response.scan })
				stopWorker()
			} else if (response.type === 'error') {
				setState({ status: 'error', message: response.message })
				stopWorker()
			}
		}
		worker.onerror = event => {
			if (id !== requestRef.current) return
			setState({ status: 'error', message: `Session 扫描失败：${event.message || '未知错误'}` })
			stopWorker()
		}
		try {
			worker.postMessage({ type: 'scan-compression', id, file })
		} catch (error) {
			setState({ status: 'error', message: `无法扫描 Session：${error instanceof Error ? error.message : '未知错误'}` })
			stopWorker()
		}
	}, [createWorker, file, stopWorker])

	useEffect(() => {
		scan()
		return stopWorker
	}, [scan, stopWorker])

	const compress = useCallback((selections: SessionCompressionSelection[]) => {
		const scanResult = state.status === 'ready' || state.status === 'complete' || state.status === 'error' ? state.scan : undefined
		if (!scanResult) return
		const id = ++requestRef.current
		setState({ status: 'compressing', scan: scanResult, bytesRead: 0, records: 0 })
		let worker: Worker
		try {
			worker = createWorker()
		} catch (error) {
			setState({ status: 'error', scan: scanResult, message: `压缩 Worker 初始化失败：${error instanceof Error ? error.message : '浏览器不支持 Worker'}` })
			return
		}
		worker.onmessage = (event: MessageEvent<SessionCompressionWorkerResponse>) => {
			const response = event.data
			if (response.id !== requestRef.current) return
			if (response.type === 'compression-progress') setState({ status: 'compressing', scan: scanResult, bytesRead: response.bytesRead, records: response.records })
			else if (response.type === 'compression-success') {
				download(response.blob, response.fileName)
				setState({ status: 'complete', scan: scanResult, report: response.report })
				stopWorker()
			} else if (response.type === 'error') {
				setState({ status: 'error', scan: scanResult, message: response.message })
				stopWorker()
			}
		}
		worker.onerror = event => {
			if (id !== requestRef.current) return
			setState({ status: 'error', scan: scanResult, message: `Session 压缩失败：${event.message || '未知错误'}` })
			stopWorker()
		}
		try {
			worker.postMessage({ type: 'compress-session', id, file, selections })
		} catch (error) {
			setState({ status: 'error', scan: scanResult, message: `无法压缩 Session：${error instanceof Error ? error.message : '未知错误'}` })
			stopWorker()
		}
	}, [createWorker, file, state, stopWorker])

	const cancel = useCallback(() => {
		const scanResult = state.status === 'compressing' ? state.scan : undefined
		workerRef.current?.postMessage({ type: 'cancel', id: requestRef.current })
		requestRef.current++
		stopWorker()
		if (scanResult) setState({ status: 'ready', scan: scanResult })
	}, [state, stopWorker])

	return { state, scan, compress, cancel }
}
