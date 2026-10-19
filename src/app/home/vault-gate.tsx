'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { stackError, stackRequest } from '@/lib/stack/api'
import { randomKey, unlockKey, wrapKeys } from '@/lib/stack/crypto'
import type { StackAccount, WrappedKeys } from '@/lib/stack/types'
import styles from './stack-login.module.css'

export function downloadText(filename: string, value: string) {
	const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
	const link = document.createElement('a')
	link.href = url; link.download = filename; link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Props = { owner: string; account: StackAccount | null; onUnlock: (key: Uint8Array, account: StackAccount) => void; dataKey?: Uint8Array }
type Prepared = { key: Uint8Array; body: WrappedKeys; recovery: string }

export function VaultGate({ owner, account, onUnlock, dataKey }: Props) {
	const [passphrase, setPassphrase] = useState('')
	const [confirm, setConfirm] = useState('')
	const [useRecovery, setUseRecovery] = useState(false)
	const [prepared, setPrepared] = useState<Prepared | null>(null)
	const preparedRef = useRef<Prepared | null>(null)
	const recoveryId = useId()
	const [copied, setCopied] = useState(false)
	const [saved, setSaved] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const alive = useRef(true)
	const setting = !account || !!dataKey
	useEffect(() => {
		alive.current = true
		return () => { alive.current = false; preparedRef.current?.key.fill(0); preparedRef.current = null }
	}, [])

	async function copyRecovery() {
		if (!prepared) return
		setError('')
		try {
			await navigator.clipboard.writeText(prepared.recovery)
			setCopied(true)
		} catch {
			setCopied(false)
			setError('复制失败，请选中密钥手动复制。')
		}
	}

	async function submit() {
		if (busy) return
		setBusy(true); setError('')
		try {
			if (!crypto.subtle) throw new Error('需要 HTTPS 或 localhost 才能使用浏览器加密。')
			if (!setting && account) {
				let key: Uint8Array
				try { key = await unlockKey(owner, account, passphrase, useRecovery) }
				catch (caught) {
					if (caught instanceof DOMException && caught.name === 'OperationError') throw new Error(useRecovery ? '恢复密钥不正确，无法解锁。' : '加密口令不正确，无法解锁。')
					throw caught
				}
				if (alive.current) onUnlock(key, account)
				else key.fill(0)
				setPassphrase('')
			} else if (!prepared) {
				if (passphrase.length < 12) throw new Error('请使用至少 12 位的独立加密口令。')
				if (passphrase !== confirm) throw new Error('两次加密口令不一致。')
				const key = dataKey ? new Uint8Array(dataKey) : randomKey()
				try {
					const wrapped = await wrapKeys(owner, passphrase, key)
					if (!alive.current) { key.fill(0); return }
					const result = { key, ...wrapped }
					preparedRef.current = result; setPrepared(result)
					setPassphrase(''); setConfirm('')
				} catch (caught) { key.fill(0); throw caught }
			} else {
				if (!saved) return
				const body = account ? { ...prepared.body, base_key_revision: account.key_revision } : prepared.body
				let savedAccount: StackAccount
				try { savedAccount = (await stackRequest<{ account: StackAccount }>(owner, account ? '/keyring' : '/setup', account ? 'PUT' : 'POST', body, undefined, account?.sync_epoch)).account }
				catch (caught) {
					// A lost success response must not strand the newly created keys.
					const result = await stackRequest<{ account: StackAccount | null }>(owner, '/bootstrap').catch(() => null)
					if (!result?.account || (account && result.account.sync_epoch !== account.sync_epoch) || result.account.kdf.salt !== prepared.body.kdf_salt || result.account.wrap_nonce !== prepared.body.wrap_nonce || result.account.wrapped_data_key !== prepared.body.wrapped_data_key || result.account.recovery_wrap_nonce !== prepared.body.recovery_wrap_nonce || result.account.recovery_wrapped_data_key !== prepared.body.recovery_wrapped_data_key) throw caught
					savedAccount = result.account
				}
				if (!/^[A-Za-z0-9]{32}$/.test(savedAccount.sync_epoch)) throw new Error('空间代际无效，请重新连接。')
				if (alive.current) onUnlock(new Uint8Array(prepared.key), savedAccount)
			}
		} catch (caught) { if (alive.current) setError(stackError(caught)) }
		finally { if (alive.current) setBusy(false) }
	}

	return <form className={styles.form} onSubmit={e => { e.preventDefault(); void submit() }}>
		<fieldset disabled={busy}>
			{prepared ? <>
				<div className={styles.recovery}>
					<div className={styles.recoveryHeader}><span id={recoveryId}>恢复密钥</span><button type='button' className={styles.copyButton} onClick={() => void copyRecovery()} aria-label='复制恢复密钥'>{copied ? <Check size={14}/> : <Copy size={14}/>}<span role='status'>{copied ? '已复制' : '复制'}</span></button></div>
					<div className={styles.recoveryKey} role='textbox' aria-readonly='true' aria-labelledby={recoveryId} tabIndex={0}>{prepared.recovery}</div>
					<p>丢失加密口令和恢复密钥后，笔记将无法找回。</p>
				</div>
				<label className={styles.confirm}><input type='checkbox' checked={saved} onChange={e => setSaved(e.target.checked)}/>我已妥善保存恢复密钥</label>
			</> : <>
				<label className={styles.field}><span>{useRecovery ? '恢复密钥' : setting ? '设置加密口令' : '加密口令'}</span><div className={styles.inputWrap}><input autoComplete={useRecovery ? 'off' : setting ? 'new-password' : 'current-password'} name='encryption-passphrase' type='password' required minLength={setting ? 12 : undefined} maxLength={256} placeholder={useRecovery ? '输入保存的 43 位恢复密钥' : setting ? '至少 12 位字符' : '输入加密口令'} value={passphrase} onChange={e => setPassphrase(e.target.value)}/></div></label>
				{setting && <label className={styles.field}><span>确认加密口令</span><div className={styles.inputWrap}><input type='password' autoComplete='new-password' required minLength={12} maxLength={256} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder='再次输入加密口令'/></div></label>}
			</>}
			<button type='submit' className={styles.primary} disabled={busy || (!!prepared && !saved)}>{busy ? '正在处理…' : prepared ? dataKey ? '更新加密设置' : '开启墨栈' : setting ? '生成恢复密钥' : '解锁空间'}</button>
			{!setting && <button type='button' className={styles.textButton} onClick={() => { setUseRecovery(!useRecovery); setPassphrase(''); setError('') }}>{useRecovery ? '使用加密口令' : '忘记口令？使用恢复密钥'}</button>}
		</fieldset>
		<div className={styles.feedback} aria-live='polite'>{error && <p className={styles.error} role='alert'>{error}</p>}</div>
	</form>
}
