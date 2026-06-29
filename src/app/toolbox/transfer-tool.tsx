'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, Globe2, Link as LinkIcon, Network, QrCode, Send, UploadCloud } from 'lucide-react'
import * as QRCode from 'qrcode'
import { toast } from 'sonner'
import { LanTransferTool } from './lan-transfer-tool'
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

type Mode = 'relay' | 'lan'

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
const LAN_INVITE_STORAGE_KEY = 'winrisef-lan-invite-v2'

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

function downloadDataUrl(filename: string, url: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
}

function formatExpireAt(value?: number) {
	if (!value) return ''
	return expireFormatter.format(value)
}

export function TransferTool({ initialCode = '' }: TransferToolProps) {
	const [mode, setMode] = useState<Mode>('relay')
	const [kind, setKind] = useState<TransferKind>('text')
	const [text, setText] = useState('')
	const [file, setFile] = useState<File | null>(null)
	const [password, setPassword] = useState('')
	const [openCode, setOpenCode] = useState(normalizeCode(initialCode))
	const [openPassword, setOpenPassword] = useState('')
	const [result, setResult] = useState<TransferCreateResponse | null>(null)
	const [resultPassword, setResultPassword] = useState('')
	const [lanInvite, setLanInvite] = useState<{ roomId: string; token: string } | null>(null)
	const [qrDataUrl, setQrDataUrl] = useState('')
	const [qrError, setQrError] = useState('')
	const [openedText, setOpenedText] = useState('')
	const [status, setStatus] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		const code = normalizeCode(initialCode)
		if (!code) return
		setMode('relay')
		setOpenCode(code)
	}, [initialCode])

	useEffect(() => {
		if (typeof window === 'undefined') return
		const hash = window.location.hash.replace(/^#/, '')
		if (hash) {
			const params = new URLSearchParams(hash)
			if (params.get('mode') === 'lan') {
				const roomId = params.get('room') || ''
				const token = params.get('token') || ''
				if (roomId && token) {
					const invite = { roomId, token }
					setMode('lan')
					setLanInvite(invite)
					sessionStorage.setItem(LAN_INVITE_STORAGE_KEY, JSON.stringify(invite))
					window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
					return
				}
			}
			const hashPassword = params.get('p')
			if (!hashPassword) return
			setMode('relay')
			setOpenPassword(hashPassword)
			window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
			return
		}

		if (normalizeCode(initialCode)) return

		const savedInvite = sessionStorage.getItem(LAN_INVITE_STORAGE_KEY)
		if (!savedInvite) return
		try {
			const invite = JSON.parse(savedInvite) as { roomId?: unknown; token?: unknown }
			if (typeof invite.roomId === 'string' && typeof invite.token === 'string' && invite.roomId && invite.token) {
				setMode('lan')
				setLanInvite({ roomId: invite.roomId, token: invite.token })
			}
		} catch {
			sessionStorage.removeItem(LAN_INVITE_STORAGE_KEY)
		}
	}, [initialCode])

	const resultLink = result && typeof window !== 'undefined' ? `${window.location.origin}/t/${result.code}` : ''
	const privateResultLink = resultLink && resultPassword ? `${resultLink}#p=${encodeURIComponent(resultPassword)}` : ''

	useEffect(() => {
		if (!privateResultLink) {
			setQrDataUrl('')
			setQrError('')
			return
		}

		let cancelled = false
		setQrDataUrl('')
		setQrError('')
		QRCode.toDataURL(privateResultLink, {
			errorCorrectionLevel: 'M',
			margin: 2,
			width: 220,
			color: {
				dark: '#1f4b4d',
				light: '#ffffffff'
			}
		})
			.then(url => {
				if (!cancelled) setQrDataUrl(url)
			})
			.catch(() => {
				if (!cancelled) setQrError('二维码生成失败，可继续复制链接分享')
			})

		return () => {
			cancelled = true
		}
	}, [privateResultLink])

	const createPayload = async (createPassword: string) => {
		if (createPassword.length < TRANSFER_LIMITS.minPasswordLength) throw new Error(`密码至少 ${TRANSFER_LIMITS.minPasswordLength} 位`)
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
		setResultPassword('')
		try {
			const createPassword = password
			const createUrl = transferApiUrl('create')
			const completeUrl = transferApiUrl('complete')
			const payload = await createPayload(createPassword)
			setStatus('正在本地加密...')
			const encrypted = await encryptTransferPayload(payload.plain, createPassword)
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
			setResultPassword(createPassword)
			setOpenCode(created.code)
			setStatus('发送完成')
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

	const copyPrivateResult = async () => {
		if (!privateResultLink) return
		await navigator.clipboard.writeText(privateResultLink)
		toast('私密链接已复制')
	}

	const downloadQrCode = () => {
		if (!qrDataUrl || !result) return
		downloadDataUrl(`transfer-${result.code}.png`, qrDataUrl)
	}

	return (
		<div className='space-y-5 max-sm:px-4'>
			<div className='flex flex-wrap gap-2 border-b border-border pb-4'>
				<button onClick={() => setMode('relay')} className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium ${mode === 'relay' ? 'bg-brand/10 text-primary' : 'text-secondary hover:bg-brand/5'}`}>
					<Globe2 size={15} />
					公网中转
				</button>
				<button onClick={() => setMode('lan')} className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium ${mode === 'lan' ? 'bg-brand/10 text-primary' : 'text-secondary hover:bg-brand/5'}`}>
					<Network size={15} />
					局域网互传
				</button>
			</div>

			{mode === 'lan' ? (
				<LanTransferTool
					initialInvite={lanInvite}
					onLeaveSession={() => {
						setLanInvite(null)
						if (typeof window !== 'undefined') sessionStorage.removeItem(LAN_INVITE_STORAGE_KEY)
					}}
				/>
			) : (
				<div className='grid items-start gap-5 xl:grid-cols-2'>
					<section className='relative min-w-0 space-y-4 rounded-2xl border border-border bg-background/30 p-5'>
						<div className='flex flex-wrap items-start justify-between gap-4'>
							<div className='flex items-center gap-3'>
									<div className='flex size-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand'>
										<Send size={20} />
									</div>
									<div>
										<p className='text-secondary text-xs tracking-[0.18em] uppercase'>Send</p>
										<h2 className='mt-1 text-lg font-semibold'>发送内容</h2>
									</div>
								</div>
								<div className='max-w-[360px] space-y-2 text-right text-xs leading-5 text-secondary max-sm:text-left'>
									<p>文本和文件会在浏览器本地加密，正确读取一次后立即销毁</p>
									{status && <p className='rounded-full border border-border bg-article px-3 py-1.5'>{status}</p>}
								</div>
							</div>

							<div className='min-h-[392px]'>
								{result ? (
									<div className='space-y-4 rounded-2xl border border-brand/30 bg-article/95 p-4 shadow-lg'>
										<div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]'>
											<div className='min-w-0 space-y-3'>
												<div>
													<p className='text-secondary text-xs'>提取码</p>
													<p className='font-mono text-2xl tracking-[0.25em]'>{result.code}</p>
												</div>
												<p className='break-all text-xs text-secondary'>{resultLink}</p>
												<p className='text-secondary text-xs'>最晚清理时间：{formatExpireAt(result.expireAt)}</p>
											</div>
											<div className='flex flex-col items-center gap-2'>
												<div className='flex size-[150px] items-center justify-center rounded-2xl border border-white/80 bg-white p-2 shadow-sm'>
													{qrDataUrl ? (
														<img src={qrDataUrl} alt='包含读取密码的中转二维码' className='size-full rounded-lg' />
													) : (
														<div className='text-secondary flex flex-col items-center gap-2 text-center text-xs'>
															<QrCode size={28} />
															<span>{qrError || '生成二维码中'}</span>
														</div>
													)}
												</div>
												<p className='text-secondary text-center text-[11px] leading-4'>二维码包含读取密码</p>
											</div>
										</div>
										<div className='flex flex-wrap gap-2'>
											<button onClick={() => void copyResult()} className='flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium'>
												<LinkIcon size={14} />
												复制链接
											</button>
											<button onClick={() => void copyPrivateResult()} className='flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium'>
												<Copy size={14} />
												复制私密链接
											</button>
											<button disabled={!qrDataUrl} onClick={downloadQrCode} className='flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-xs font-medium disabled:opacity-50'>
												<Download size={14} />
												下载二维码
											</button>
										</div>
									</div>
								) : (
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
												className='min-h-[240px] w-full resize-none rounded-2xl border border-border bg-article p-4 text-sm leading-6 text-primary'
											/>
										) : (
											<label className='border-brand/20 bg-brand/5 text-secondary flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm xl:min-h-[240px]'>
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
									</div>
								)}
							</div>
							<button disabled={busy} onClick={() => void handleCreate()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
								<Send size={16} />
								生成 6 位中转链接
							</button>
					</section>

					<section className='min-w-0 space-y-4 rounded-2xl border border-border bg-background/30 p-5'>
							<div className='flex items-center gap-3'>
								<div className='flex size-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand'>
									<Download size={20} />
								</div>
								<div>
									<p className='text-secondary text-xs tracking-[0.18em] uppercase'>Receive</p>
									<h2 className='mt-1 text-lg font-semibold'>接收内容</h2>
								</div>
							</div>

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

							{openedText && (
								<div className='space-y-3 rounded-2xl border border-border bg-article p-4'>
									<div className='text-secondary text-xs'>读取到的文本</div>
									<textarea readOnly value={openedText} className='min-h-[220px] w-full resize-none rounded-2xl border border-border bg-background/30 p-4 text-sm leading-6' />
									<button onClick={() => navigator.clipboard.writeText(openedText)} className='rounded-full border border-border px-3 py-2 text-xs font-medium'>
										复制文本
									</button>
								</div>
							)}
						</section>
				</div>
			)}
		</div>
	)
}
