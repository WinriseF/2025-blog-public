'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Languages, Settings2 } from 'lucide-react'
import { createSessionConfigStore } from '@/lib/reading-translation/model-config'
import { createReadingTextIndex } from '@/lib/reading-translation/text-selection'
import type { ReadingSelection, TranslationConfig } from '@/lib/reading-translation/types'
import { ModelSettings } from './model-settings'
import { TranslationPanel } from './translation-panel'
import { useReaderSelection } from './use-reader-selection'
import { useTranslation } from './use-translation'
import styles from './reader.module.css'

const HIGHLIGHT_NAME = 'english-reading-selection'

type HighlightRegistry = {
	set(name: string, highlight: unknown): void
	delete(name: string): boolean
}

type HighlightConstructor = new (...ranges: Range[]) => unknown

function getHighlightApi() {
	const browser = globalThis as unknown as {
		CSS?: { highlights?: HighlightRegistry }
		Highlight?: HighlightConstructor
	}
	const registry = browser.CSS?.highlights
	const HighlightClass = browser.Highlight
	return registry && HighlightClass ? { registry, HighlightClass } : null
}

export default function EnglishReadingBody({ children, title }: { children: ReactNode; title: string }) {
	const rootRef = useRef<HTMLDivElement>(null)
	const [configStore] = useState(createSessionConfigStore)
	const [enabled, setEnabled] = useState(true)
	const [supportsCustomHighlights, setSupportsCustomHighlights] = useState(false)
	const [selection, setSelection] = useState<ReadingSelection | null>(null)
	const [panel, setPanel] = useState<'translation' | 'settings' | null>(null)
	const [notice, setNotice] = useState('')
	const { state, translate, cancel, clear } = useTranslation(configStore, title)
	const close = useCallback(() => {
		cancel()
		setPanel(null)
		setSelection(null)
	}, [cancel])
	const select = useCallback((value: ReadingSelection) => {
		setSelection(value)
		setPanel('translation')
		setNotice('')
		void translate(value)
	}, [translate])
	const preview = useCallback((value: ReadingSelection) => {
		cancel()
		setSelection(value)
		setPanel(null)
	}, [cancel])
	useReaderSelection({ rootRef, enabled, customTouchSelection: supportsCustomHighlights, content: children, onSelect: select, onPreview: preview, onCancel: close })

	useEffect(() => { setSupportsCustomHighlights(Boolean(getHighlightApi())) }, [])
	useEffect(() => {
		const api = getHighlightApi()
		if (!api) return
		if (selection) api.registry.set(HIGHLIGHT_NAME, new api.HighlightClass(selection.range))
		else api.registry.delete(HIGHLIGHT_NAME)
		return () => { api.registry.delete(HIGHLIGHT_NAME) }
	}, [selection])
	useEffect(() => () => configStore.clear(), [configStore])
	useEffect(() => { close() }, [children, close])

	const saveConfig = (config: TranslationConfig) => {
		configStore.set(config)
		clear()
		if (selection) { setPanel('translation'); void translate(selection) }
		else { setPanel(null); setNotice(enabled ? '模型配置已保存，可以开始划词翻译。' : '模型配置已保存，开启划词翻译后即可使用。') }
	}
	const translateNativeSelection = () => {
		if (!rootRef.current) return
		const value = createReadingTextIndex(rootRef.current).fromNativeSelection()
		if (value) select(value)
		else setNotice('请先选中正文文字，再点击翻译；也可按 Alt + Enter。')
	}
	return (
		<div className={styles.reader}>
			{/* The current Turbopack CSS parser does not understand ::highlight in CSS modules. */}
			<style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: color-mix(in srgb, var(--color-brand) 32%, transparent); color: inherit; }`}</style>
			<div className={styles.toolbar} data-click-effect='off'>
				<button type='button' aria-pressed={enabled} onClick={() => { setEnabled(!enabled); close() }} className={enabled ? styles.enabled : ''}><Languages size={16} /> 划词翻译{enabled ? '已开启' : '已关闭'}</button>
				<div className={styles.actions}>
					{enabled && <button type='button' title='翻译选中文字（Alt + Enter）' onMouseDown={event => event.preventDefault()} onClick={translateNativeSelection}>翻译选中内容</button>}
					<button type='button' onClick={() => { cancel(); setPanel('settings') }} aria-label='翻译模型设置'><Settings2 size={16} /></button>
				</div>
			</div>
			<p className={styles.hint}>
				{enabled ? <>
					<span className={styles.desktopHint}>点击查词 · 拖动选择短语或句子</span>
					<span className={styles.touchHint}>{supportsCustomHighlights ? '轻点查词 · 长按后拖动选词，松手翻译' : '长按选择正文，再点击“翻译选中内容”'}</span>
				</> : '划词翻译已暂停。'}
			</p>
			{notice && <p role='status' className={styles.hint}>{notice}</p>}
			<div ref={rootRef} tabIndex={0} aria-label='英文阅读正文' data-click-effect='off' className={`prose mt-6 max-w-none cursor-text ${styles.text}`}>{children}</div>
			{panel && <TranslationPanel selection={selection} state={state} settings={panel === 'settings'} onClose={close} onSettings={() => { cancel(); setPanel('settings') }} onRetry={() => { if (selection) void translate(selection) }}>
				<ModelSettings initial={configStore.get()} onSave={saveConfig} onClear={() => { configStore.clear(); clear(); close(); setNotice('模型配置已清除。') }} />
			</TranslationPanel>}
		</div>
	)
}
