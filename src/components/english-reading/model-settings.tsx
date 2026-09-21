'use client'

import { useState, type FormEvent } from 'react'
import type { TranslationConfig } from '@/lib/reading-translation/types'
import styles from './reader.module.css'

export function ModelSettings({ initial, onSave, onClear }: {
	initial: TranslationConfig | null
	onSave: (config: TranslationConfig) => Promise<void>
	onClear: () => Promise<void>
}) {
	const [endpoint, setEndpoint] = useState(initial?.endpoint || '')
	const [model, setModel] = useState(initial?.model || '')
	const [apiKey, setApiKey] = useState(initial?.apiKey || '')
	const [error, setError] = useState('')
	const [saving, setSaving] = useState(false)
	const submit = async (event: FormEvent) => {
		event.preventDefault()
		setSaving(true)
		setError('')
		try { await onSave({ endpoint, model, apiKey }) }
		catch (error) { setError(error instanceof Error ? error.message : '配置保存失败。') }
		finally { setSaving(false) }
	}
	return (
		<form onSubmit={submit} className={styles.form}>
			<p className={styles.muted}>使用支持 Chat Completions 的模型接口。请求从你的浏览器直接发出，服务商须允许跨域访问。</p>
			<label>完整 API 请求地址<input type='url' required value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder='https://example.com/v1/chat/completions' autoComplete='off' spellCheck={false} /></label>
			<label>模型名称<input required value={model} onChange={event => setModel(event.target.value)} placeholder='服务商提供的模型 ID' autoComplete='off' spellCheck={false} /></label>
			<label>API 密钥<input type='password' required value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder='输入你自己的 API 密钥' autoComplete='off' spellCheck={false} /></label>
			<p className={styles.muted}>配置会保存在当前浏览器中，API 密钥使用浏览器生成的不可导出密钥加密；刷新或切换文章后仍可使用，直到你手动清除。选中文字和少量上下文会发送给所填的模型服务。</p>
			{error && <p role='alert' className={styles.error}>{error}</p>}
			<div className={styles.actions}>
				<button type='submit' disabled={saving} className={styles.primary}>{saving ? '正在保存…' : '保存并使用'}</button>
				{initial && <button type='button' disabled={saving} onClick={() => void onClear()}>清除配置</button>}
			</div>
		</form>
	)
}
