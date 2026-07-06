'use client'

import { useCallback, useRef, useState } from 'react'

type RecorderState = 'idle' | 'recording' | 'blocked'

export function useLanRecorder() {
	const [state, setState] = useState<RecorderState>('idle')
	const [startedAt, setStartedAt] = useState(0)
	const recorderRef = useRef<MediaRecorder | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const chunksRef = useRef<Blob[]>([])

	const cleanup = useCallback(() => {
		streamRef.current?.getTracks().forEach(track => track.stop())
		streamRef.current = null
		recorderRef.current = null
		chunksRef.current = []
	}, [])

	const start = useCallback(async () => {
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
			setState('blocked')
			throw new Error('当前浏览器不支持录音')
		}
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
		if (!stream) {
			setState('blocked')
			throw new Error('无法获取麦克风权限')
		}
		const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
		const recorder = new MediaRecorder(stream, { mimeType: mime })
		streamRef.current = stream
		recorderRef.current = recorder
		chunksRef.current = []
		recorder.ondataavailable = event => {
			if (event.data.size > 0) chunksRef.current.push(event.data)
		}
		recorder.start()
		setStartedAt(Date.now())
		setState('recording')
	}, [])

	const stop = useCallback(async () => {
		const recorder = recorderRef.current
		if (!recorder || recorder.state === 'inactive') return null
		const durationMs = Math.max(0, Date.now() - startedAt)
		const blob = await new Promise<Blob>((resolve) => {
			recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
			recorder.stop()
		})
		cleanup()
		setState('idle')
		return { blob, durationMs }
	}, [cleanup, startedAt])

	const cancel = useCallback(() => {
		const recorder = recorderRef.current
		if (recorder && recorder.state !== 'inactive') recorder.stop()
		cleanup()
		setState('idle')
	}, [cleanup])

	return { state, startedAt, start, stop, cancel }
}
