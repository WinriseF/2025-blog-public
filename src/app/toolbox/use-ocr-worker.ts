'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OcrErrorPhase, OcrModel, OcrResult, OcrWorkerRequest, OcrWorkerResponse } from '@/lib/ocr/types'

export type OcrPhase = 'idle' | 'initializing' | 'recognizing' | 'success' | 'error'

type OcrWorkerState = {
	phase: OcrPhase
	result: OcrResult | null
	error: string | null
	errorPhase: OcrErrorPhase | null
}

const INITIAL_STATE: OcrWorkerState = {
	phase: 'idle',
	result: null,
	error: null,
	errorPhase: null
}

export function useOcrWorker() {
	const [state, setState] = useState<OcrWorkerState>(INITIAL_STATE)
	const workerRef = useRef<Worker | null>(null)
	const activeRequestIdRef = useRef<number | null>(null)
	const nextRequestIdRef = useRef(0)
	const readyRef = useRef(false)

	const terminateWorker = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
		activeRequestIdRef.current = null
		readyRef.current = false
	}, [])

	const failWorker = useCallback(
		(message: string, phase: OcrErrorPhase) => {
			terminateWorker()
			setState({ phase: 'error', result: null, error: message, errorPhase: phase })
		},
		[terminateWorker]
	)

	const createWorker = useCallback(() => {
		const worker = new Worker(new URL('../../lib/ocr/ocr.worker.ts', import.meta.url))

		worker.onmessage = (event: MessageEvent<OcrWorkerResponse>) => {
			const response = event.data
			if (response.id !== activeRequestIdRef.current) return

			if (response.type === 'status') {
				if (response.status === 'recognizing') readyRef.current = true
				setState(current => ({ ...current, phase: response.status }))
				return
			}

			if (response.type === 'success') {
				activeRequestIdRef.current = null
				readyRef.current = true
				setState({
					phase: 'success',
					result: {
						text: response.text,
						confidence: response.confidence,
						items: response.items
					},
					error: null,
					errorPhase: null
				})
				return
			}

			failWorker(response.message, response.phase)
		}

		worker.onerror = event => {
			event.preventDefault()
			failWorker(event.message || 'OCR Worker 运行异常', readyRef.current ? 'recognize' : 'initialize')
		}

		worker.onmessageerror = () => {
			failWorker('无法读取 OCR Worker 返回的数据', readyRef.current ? 'recognize' : 'initialize')
		}

		workerRef.current = worker
		return worker
	}, [failWorker])

	const recognize = useCallback(
		async (file: File, model: OcrModel) => {
			if (activeRequestIdRef.current !== null) return

			const worker = workerRef.current ?? createWorker()
			const id = ++nextRequestIdRef.current
			activeRequestIdRef.current = id
			setState({
				phase: readyRef.current ? 'recognizing' : 'initializing',
				result: null,
				error: null,
				errorPhase: null
			})

			try {
				const image = await file.arrayBuffer()
				if (activeRequestIdRef.current !== id) return

				const request: OcrWorkerRequest = { id, type: 'recognize', model, image }
				worker.postMessage(request, [image])
			} catch (error) {
				if (activeRequestIdRef.current !== id) return
				failWorker(error instanceof Error ? error.message : '图片读取失败', 'recognize')
			}
		},
		[createWorker, failWorker]
	)

	const cancel = useCallback(() => {
		if (activeRequestIdRef.current === null) return
		terminateWorker()
		setState(INITIAL_STATE)
	}, [terminateWorker])

	const reset = useCallback(() => {
		if (activeRequestIdRef.current !== null) terminateWorker()
		setState(INITIAL_STATE)
	}, [terminateWorker])

	const restart = useCallback(() => {
		terminateWorker()
		setState(INITIAL_STATE)
	}, [terminateWorker])

	useEffect(() => terminateWorker, [terminateWorker])

	return { ...state, recognize, cancel, reset, restart }
}
