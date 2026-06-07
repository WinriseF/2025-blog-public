'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, Lock, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import {
	decodeTextPayload,
	decryptTransferPayload,
	deriveTransferProof,
	bytesToArrayBuffer,
	encodeTextPayload,
	encryptTransferPayload
} from '@/lib/transfer-crypto'
import {
	TRANSFER_CODE_PATTERN,
	TRANSFER_LIMITS,
	TRANSFER_UPLOAD_CONTENT_TYPE,
	type TransferCreateResponse,
	type TransferErrorBody,
	type TransferKind,
	type TransferPublicMeta
} from '@/lib/transfer-types'

type TransferToolProps = {
	initialCode?: string
}

type Mode = 'create' | 'open'

const errorText: Record<string, string> = {
	bad_password: '密码不正确',
	config_missing: 'Edge Functions 还没有配置中转站环境变量',
	consumed: '这条中转消息已经被销毁',
	expired: '这条中转消息已经过期',
	invalid_code: '请输入 6 位提取码',
	not_found: '没有找到这条中转消息，可能已经被销毁',
	rate_limited: '今天上传次数已达上限',
	too_large: '内容超过大小限制',
	upload_missing: '密文还没有上传完成',
	upload_pending: '密文还在上传中，请稍后再试'
}

const expireFormatter = new Intl.DateTimeFormat('zh-CN', {
	dateStyle: 'short',
	timeStyle: 'short',
	hour12: false
})
const transferApiBase = (process.env.NEXT_PUBLIC_TRANSFER_API_BASE || '').replace(/\/+$/, '')
const textLimitLabel = '1MB'
const fileLimitLabel = '20MB'

function normalizeCode(value: string) {
	return value.trim().toUpperCase()
}

async function readApiError(response: Response) {
	const body = (await response.json().catch(() => null)) as TransferErrorBody | null
	return errorText[body?.error || ''] || body?.message || '请求失败'
}

async function fetchJson<T>(url: string, init?: RequestInit) {
	const response = await fetch(url, init)
	if (!response.ok) throw new Error(await readApiError(response))
	return (await response.json()) as T
}

function transferApiUrl(action: string) {
	if (!transferApiBase) throw new Error('未配置 Edge Functions API 地址，暂不能使用中转站')
	return `${transferApiBase}/api/transfer/${action}`
}

function downloadBytes(filename: string, bytes: Uint8Array, contentType: string) {
	const url = URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)], { type: contentType || 'application/octet-stream' }))
	const link = document.createElement('a')
	link.href = url
	link.download = filename || 'transfer-file'
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatExpireAt(value?: number) {
	if (!value) return ''
	return expireFormatter.format(value)
}

export function TransferTool({ initialCode = '' }: TransferToolProps) {
	const [mode, setMode] = useState<Mode>(initialCode ? 'open' : 'create')
	const [kind, setKind] = useState<TransferKind>('text')
	const [text, setText] = useState('')
	const [file, setFile] = useState<File | null>(null)
	const [password, setPassword] = useState('')
	const [openCode, setOpenCode] = useState(normalizeCode(initialCode))
	const [openPassword, setOpenPassword] = useState('')
	const [result, setResult] = useState<TransferCreateResponse | null>(null)
	const [openedText, setOpenedText] = useState('')
	const [status, setStatus] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		const code = normalizeCode(initialCode)
		if (!code) return
		setMode('open')
		setOpenCode(code)
	}, [initialCode])

	const resultLink = result && typeof window !== 'undefined' ? `${window.location.origin}/t/${result.code}` : ''

	const createPayload = async () => {
		if (password.length < TRANSFER_LIMITS.minPasswordLength) throw new Error(`密码至少 ${TRANSFER_LIMITS.minPasswordLength} 位`)
		if (kind === 'text') {
			const plain = encodeTextPayload(text)
			if (!plain.length) throw new Error('请先输入要中转的文本')
			if (plain.length > TRANSFER_LIMITS.maxTextBytes) throw new Error(`文本最多 ${textLimitLabel}`)
			return {
				plain,
				name: 'message.txt',
				contentType: 'text/plain;charset=utf-8',
				size: plain.length
			}
		}
		if (!file) throw new Error('请先选择文件')
		if (file.size > TRANSFER_LIMITS.maxFileBytes) throw new Error(`文件最多 ${fileLimitLabel}`)
		return {
			plain: new Uint8Array(await file.arrayBuffer()),
			name: file.name || 'transfer-file',
			contentType: file.type || 'application/octet-stream',
			size: file.size
		}
	}

	const handleCreate = async () => {
		setBusy(true)
		setStatus('')
		setResult(null)
		try {
			const createUrl = transferApiUrl('create')
			const completeUrl = transferApiUrl('complete')
			const payload = await createPayload()
			setStatus('正在本地加密...')
			const encrypted = await encryptTransferPayload(payload.plain, password)
			setStatus('正在创建中转链接...')
			const created = await fetchJson<TransferCreateResponse>(createUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					kind,
					name: payload.name,
					contentType: payload.contentType,
					size: payload.size,
					salt: encrypted.salt,
					iv: encrypted.iv,
					proof: encrypted.proof
				})
			})

			setStatus('正在上传密文...')
			const upload = await fetch(created.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': TRANSFER_UPLOAD_CONTENT_TYPE },
				body: bytesToArrayBuffer(encrypted.cipher)
			})
			if (!upload.ok) throw new Error('密文上传失败')

			setStatus('正在确认上传...')
			await fetchJson<TransferPublicMeta>(completeUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: created.code })
			})
			setResult(created)
			setOpenCode(created.code)
			setStatus('生成完成')
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '创建失败')
		} finally {
			setBusy(false)
		}
	}

	const handleOpen = async () => {
		const code = normalizeCode(openCode)
		if (!TRANSFER_CODE_PATTERN.test(code)) {
			setStatus('请输入 6 位提取码')
			return
		}
		if (openPassword.length < TRANSFER_LIMITS.minPasswordLength) {
			setStatus(`密码至少 ${TRANSFER_LIMITS.minPasswordLength} 位`)
			return
		}

		setBusy(true)
		setOpenedText('')
		try {
			const metaUrl = `${transferApiUrl('meta')}?code=${encodeURIComponent(code)}`
			const openUrl = transferApiUrl('open')
			setStatus('正在读取元信息...')
			const meta = await fetchJson<TransferPublicMeta>(metaUrl)
			if (meta.status !== 'ready') throw new Error('密文还在上传中，请稍后再试')
			setStatus('正在校验密码...')
			const { proof } = await deriveTransferProof(openPassword, meta)
			const response = await fetch(openUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code, proof })
			})
			if (!response.ok) throw new Error(await readApiError(response))
			const cipher = await response.arrayBuffer()
			setStatus('正在本地解密...')
			const plain = await decryptTransferPayload(cipher, openPassword, meta)

			if (meta.kind === 'text') {
				setOpenedText(decodeTextPayload(plain))
				setStatus('读取成功，原始密文已销毁')
			} else {
				downloadBytes(meta.name, plain, meta.contentType)
				setStatus('文件已开始下载，原始密文已销毁')
			}
		} catch (error) {
			setStatus(error instanceof Error ? error.message : '读取失败')
		} finally {
			setBusy(false)
		}
	}

	const copyResult = async () => {
		if (!resultLink) return
		await navigator.clipboard.writeText(resultLink)
		toast('链接已复制')
	}

	return (
		<div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]'>
			<section className='min-w-0 space-y-5'>
				<div className='flex flex-wrap gap-2 border-b border-border pb-4'>
					<button onClick={() => setMode('create')} className={`rounded-full px-4 py-2 text-xs font-medium ${mode === 'create' ? 'bg-brand/10 text-primary' : 'text-secondary hover:bg-brand/5'}`}>
						创建中转
					</button>
					<button onClick={() => setMode('open')} className={`rounded-full px-4 py-2 text-xs font-medium ${mode === 'open' ? 'bg-brand/10 text-primary' : 'text-secondary hover:bg-brand/5'}`}>
						读取中转
					</button>
				</div>

				{mode === 'create' ? (
					<div className='space-y-4'>
						<div className='grid grid-cols-2 gap-2'>
							<button onClick={() => setKind('text')} className={`rounded-xl border px-4 py-3 text-left ${kind === 'text' ? 'border-brand bg-brand/10' : 'border-border'}`}>
								<span className='block font-semibold'>文本</span>
								<span className='text-secondary text-xs'>最多 {textLimitLabel}</span>
							</button>
							<button onClick={() => setKind('file')} className={`rounded-xl border px-4 py-3 text-left ${kind === 'file' ? 'border-brand bg-brand/10' : 'border-border'}`}>
								<span className='block font-semibold'>文件</span>
								<span className='text-secondary text-xs'>最多 {fileLimitLabel}</span>
							</button>
						</div>

						{kind === 'text' ? (
							<textarea
								value={text}
								onChange={event => setText(event.target.value)}
								placeholder='粘贴要中转的文本'
								className='min-h-[260px] w-full resize-none rounded-2xl border border-border bg-article p-4 text-sm leading-6 text-primary'
							/>
						) : (
							<label className='border-brand/20 bg-brand/5 text-secondary flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm xl:min-h-[260px]'>
								<UploadCloud className='mb-3' size={28} />
								<input type='file' className='hidden' onChange={event => setFile(event.target.files?.[0] || null)} />
								<span>{file ? file.name : '选择要中转的文件'}</span>
								<span className='mt-1 text-xs'>上传前会先在浏览器加密</span>
							</label>
						)}

						<input
							type='password'
							value={password}
							onChange={event => setPassword(event.target.value)}
							placeholder='设置读取密码，至少 6 位'
							className='w-full rounded-2xl border border-border bg-article px-4 py-3 text-sm'
						/>
						<button disabled={busy} onClick={() => void handleCreate()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
							<Lock size={16} />
							生成 6 位中转链接
						</button>
					</div>
				) : (
					<div className='space-y-4'>
						<input value={openCode} onChange={event => setOpenCode(normalizeCode(event.target.value))} maxLength={6} placeholder='6 位提取码' className='w-full rounded-2xl border border-border bg-article px-4 py-3 font-mono text-lg tracking-[0.25em]' />
						<input
							type='password'
							value={openPassword}
							onChange={event => setOpenPassword(event.target.value)}
							placeholder='读取密码'
							className='w-full rounded-2xl border border-border bg-article px-4 py-3 text-sm'
						/>
						<button disabled={busy} onClick={() => void handleOpen()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
							<Download size={16} />
							读取并销毁
						</button>
					</div>
				)}
			</section>

			<section className='min-w-0 space-y-4 rounded-2xl border border-border bg-background/30 p-5 xl:sticky xl:top-24'>
				<div>
					<p className='text-secondary text-xs tracking-[0.18em] uppercase'>Transfer</p>
					<h2 className='mt-1 text-lg font-semibold'>加密消息中转站</h2>
					<p className='text-secondary mt-2 text-sm leading-6'>文本和文件会在浏览器本地加密，服务端只保存密文。正确读取一次后立即销毁，未读取内容最晚在北京时间 02:00 清理。</p>
				</div>

				{result && (
					<div className='space-y-3 rounded-2xl border border-brand/30 bg-brand/5 p-4'>
						<div>
							<p className='text-secondary text-xs'>提取码</p>
							<p className='font-mono text-2xl tracking-[0.25em]'>{result.code}</p>
						</div>
						<p className='break-all text-xs text-secondary'>{resultLink}</p>
						<p className='text-secondary text-xs'>最晚清理时间：{formatExpireAt(result.expireAt)}</p>
						<button onClick={() => void copyResult()} className='flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium'>
							<Copy size={14} />
							复制链接
						</button>
					</div>
				)}

				{openedText && (
					<div className='space-y-3'>
						<div className='text-secondary text-xs'>读取到的文本</div>
						<textarea readOnly value={openedText} className='min-h-[220px] w-full resize-none rounded-2xl border border-border bg-article p-4 text-sm leading-6' />
						<button onClick={() => navigator.clipboard.writeText(openedText)} className='rounded-full border border-border px-3 py-2 text-xs font-medium'>
							复制文本
						</button>
					</div>
				)}

				{status && <div className='rounded-2xl border border-border bg-article px-4 py-3 text-sm text-secondary'>{status}</div>}
			</section>
		</div>
	)
}
