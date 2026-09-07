'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_SELECTION_LENGTH, TRANSLATION_PROMPT_VERSION, translateSelection } from '@/lib/reading-translation/client'
import type { SessionConfigStore } from '@/lib/reading-translation/model-config'
import type { TranslationResult, TranslationState, TranslationTarget } from '@/lib/reading-translation/types'

export function useTranslation(configStore: SessionConfigStore, title: string) {
	const [state, setState] = useState<TranslationState>({ status: 'idle' })
	const activeRef = useRef<{ id: number; controller?: AbortController; targetKey?: string }>({ id: 0 })
	const cacheRef = useRef(new Map<string, TranslationResult>())
	const cancel = useCallback(() => {
		activeRef.current.controller?.abort()
		activeRef.current = { id: activeRef.current.id + 1 }
	}, [])
	const clear = useCallback(() => {
		cancel()
		cacheRef.current.clear()
		setState({ status: 'idle' })
	}, [cancel])

	const translate = useCallback(async (target: TranslationTarget) => {
		const targetKey = JSON.stringify([title, target.mode, target.text, target.context, target.contextOffset])
		if (activeRef.current.targetKey === targetKey && activeRef.current.controller && !activeRef.current.controller.signal.aborted) return
		cancel()
		if (target.text.length > MAX_SELECTION_LENGTH) {
			setState({ status: 'error', message: `一次最多翻译 ${MAX_SELECTION_LENGTH} 个字符，请缩小选区。` })
			return
		}
		const controller = new AbortController()
		const id = activeRef.current.id
		activeRef.current.controller = controller
		activeRef.current.targetKey = targetKey
		let timedOut = false
		const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 30000)
		setState({ status: 'loading' })
		try {
			const config = configStore.get()
			if (id !== activeRef.current.id) return
			controller.signal.throwIfAborted()
			if (!config) { setState({ status: 'unconfigured' }); return }
			const key = JSON.stringify([TRANSLATION_PROMPT_VERSION, config.endpoint, config.model, title, target.mode, target.text, target.context, target.contextOffset])
			const cached = cacheRef.current.get(key)
			if (cached) { setState({ status: 'success', result: cached }); return }
			const result = await translateSelection(config, target, title, controller.signal, text => {
				if (id === activeRef.current.id && !controller.signal.aborted) setState({ status: 'loading', result: { translation: text } })
			})
			if (id !== activeRef.current.id || controller.signal.aborted) return
			cacheRef.current.set(key, result)
			if (cacheRef.current.size > 100) cacheRef.current.delete(cacheRef.current.keys().next().value!)
			setState({ status: 'success', result })
		} catch (error) {
			if (id !== activeRef.current.id || (controller.signal.aborted && !timedOut)) return
			setState({ status: 'error', message: timedOut ? '翻译等待超时，请重试。' : error instanceof Error ? error.message : '翻译失败，请稍后重试。' })
		} finally {
			window.clearTimeout(timer)
			if (id === activeRef.current.id) activeRef.current.controller = undefined
		}
	}, [cancel, configStore, title])

	useEffect(() => {
		clear()
		return cancel
	}, [configStore, title, clear, cancel])
	return { state, translate, cancel, clear }
}
