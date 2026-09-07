'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Settings2, X } from 'lucide-react'
import type { ReadingSelection, TranslationState } from '@/lib/reading-translation/types'
import styles from './reader.module.css'

export function TranslationPanel({ selection, state, settings, children, onClose, onSettings, onRetry }: {
	selection: ReadingSelection | null
	state: TranslationState
	settings: boolean
	children?: ReactNode
	onClose: () => void
	onSettings: () => void
	onRetry: () => void
}) {
	const panelRef = useRef<HTMLElement>(null)
	const titleId = useId()
	const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
	const [copyState, setCopyState] = useState('')
	const handleStart = useRef<number | null>(null)
	useLayoutEffect(() => {
		const panel = panelRef.current
		if (!panel) return
		let frame = 0
		const place = () => {
			if (window.innerWidth <= 768) {
				const viewport = window.visualViewport
				setPosition({
					bottom: viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0,
					maxHeight: (viewport?.height || window.innerHeight) * 0.68
				})
				return
			}
			const rect = selection?.range.getBoundingClientRect()
			const width = Math.min(380, window.innerWidth - 32)
			const height = panel.offsetHeight
			const left = rect && !settings ? Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) : (window.innerWidth - width) / 2
			let top = rect && !settings ? rect.bottom + 10 : (window.innerHeight - height) / 2
			if (rect && !settings && top + height > window.innerHeight - 16) top = rect.top - height - 10
			setPosition({ width, left, top: Math.max(16, Math.min(top, window.innerHeight - height - 16)) })
		}
		const schedule = () => {
			window.cancelAnimationFrame(frame)
			frame = window.requestAnimationFrame(place)
		}
		place()
		const observer = new ResizeObserver(schedule)
		observer.observe(panel)
		window.addEventListener('resize', schedule)
		window.addEventListener('scroll', schedule, { passive: true })
		window.visualViewport?.addEventListener('resize', schedule)
		window.visualViewport?.addEventListener('scroll', schedule)
		return () => {
			observer.disconnect()
			window.cancelAnimationFrame(frame)
			window.removeEventListener('resize', schedule)
			window.removeEventListener('scroll', schedule)
			window.visualViewport?.removeEventListener('resize', schedule)
			window.visualViewport?.removeEventListener('scroll', schedule)
		}
	}, [selection, settings])

	useEffect(() => {
		const outside = (event: PointerEvent) => {
			if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onClose()
		}
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') { event.preventDefault(); onClose() }
		}
		document.addEventListener('pointerdown', outside)
		document.addEventListener('keydown', escape)
		return () => {
			document.removeEventListener('pointerdown', outside)
			document.removeEventListener('keydown', escape)
		}
	}, [onClose])
	useEffect(() => {
		setCopyState('')
		if (settings) panelRef.current?.querySelector('input')?.focus({ preventScroll: true })
	}, [selection, settings])
	useEffect(() => {
		if (!copyState) return
		const timer = window.setTimeout(() => setCopyState(''), 2000)
		return () => window.clearTimeout(timer)
	}, [copyState])

	const copy = async (text: string) => {
		try { await navigator.clipboard.writeText(text); setCopyState('已复制') }
		catch { setCopyState('复制失败，请手动选择文字复制') }
	}
	return createPortal(
		<section ref={panelRef} role='dialog' aria-labelledby={titleId} data-reading-ignore data-click-effect='off' className={styles.panel} style={position}>
			<div
				className={styles.handle}
				onPointerDown={event => { handleStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) }}
				onPointerUp={event => { if (handleStart.current !== null && event.clientY - handleStart.current > 48) onClose(); handleStart.current = null }}
				onPointerCancel={() => { handleStart.current = null }}
				aria-hidden='true'><span /></div>
			<header className={styles.panelHeader}>
				<h2 id={titleId}>{settings ? '翻译模型设置' : selection?.mode === 'word' ? '语境查词' : '片段翻译'}</h2>
				<div className={styles.actions}>
					{!settings && <button type='button' onClick={onSettings} aria-label='翻译模型设置'><Settings2 size={16} /></button>}
					<button type='button' onClick={onClose} aria-label='关闭翻译面板'><X size={18} /></button>
				</div>
			</header>
			<div className={styles.panelBody}>
				{settings ? children : selection && <>
					<p className={styles.original} lang='en'>{selection.text}</p>
					{state.status === 'unconfigured' && <div className={styles.empty}>
						<p>配置一个翻译模型，即可查看这里的语境释义。</p>
						<button type='button' className={styles.primary} onClick={onSettings}>配置翻译模型</button>
					</div>}
					{state.status === 'loading' && <p role='status' className={styles.muted}>{state.result?.translation ? '正在翻译…' : '正在获取语境译文…'}</p>}
					{state.result && <div className={styles.result}>
						{(state.result.lemma || state.result.partOfSpeech) && <p className={styles.muted}><span lang='en'>{state.result.lemma}</span> {state.result.partOfSpeech}</p>}
						<p className={styles.translation}>{state.result.translation}</p>
						{state.result.note && <p className={styles.note}>{state.result.note}</p>}
					</div>}
					{state.status === 'error' && <div className={styles.empty}><p role='alert' className={styles.error}>{state.message}</p><button type='button' onClick={onRetry}>重试</button></div>}
					<details className={styles.context}><summary>查看原文语境</summary><p lang='en'>{selection.context}</p></details>
					<div className={styles.footer}>
						<div className={styles.actions}>
							<button type='button' onClick={() => void copy(selection.text)}><Copy size={13} /> 原文</button>
							{state.status === 'success' && state.result && <button type='button' onClick={() => void copy(state.result!.translation)}><Copy size={13} /> 译文</button>}
						</div>
						<span role='status'>{copyState || (state.status === 'success' ? 'AI 语境翻译' : '')}</span>
					</div>
				</>}
			</div>
		</section>, document.body
	)
}
