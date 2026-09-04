'use client'

import { useEffect, useState, type ClipboardEvent } from 'react'
import { Copy, Download, Globe2, Image as ImageIcon, Link as LinkIcon, Network, QrCode, Send, UploadCloud, X } from 'lucide-react'
import * as QRCode from 'qrcode'
import { toast } from 'sonner'
import { LanTransferTool } from './lan-transfer-tool'
import { createRelayTransfer, openRelayTransfer, type OpenedRelayFile } from '@/lib/transfer-relay'
import {
	TRANSFER_CODE_PATTERN,
	TRANSFER_LIMITS,
	type TransferCreateResponse,
	type TransferKind
} from '@/lib/transfer-types'

type TransferToolProps = {
	initialCode?: string
}

type Mode = 'relay' | 'lan'

const expireFormatter = new Intl.DateTimeFormat('zh-CN', {
	dateStyle: 'short',
	timeStyle: 'short',
	hour12: false
})
const transferApiBase = (process.env.NEXT_PUBLIC_TRANSFER_API_BASE || '').replace(/\/+$/, '')
const contentLimitLabel = '4MB'
const fileLimitLabel = '200MB'

function normalizeCode(value: string) {
	return value.trim().toUpperCase()
}

function transferApiUrl(action: string) {
	if (!transferApiBase) throw new Error('未配置 Edge Functions API 地址，暂不能使用中转站')
	return `${transferApiBase}/api/transfer/${action}`
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

function formatBytes(value: number) {
	if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`
	if (value >= 1024) return `${Math.ceil(value / 1024)}KB`
	return `${value}B`
}

function getClipboardImage(data: DataTransfer) {
	for (const file of Array.from(data.files)) {
		if (file.type.startsWith('image/')) return file
	}
	for (const item of Array.from(data.items)) {
		if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
		const file = item.getAsFile()
		if (file) return file
	}
	return null
}

function namePastedImage(file: File) {
	if (file.name) return file
	const suffix = file.type.split('/')[1]?.split(';')[0] || 'png'
	return new File([file], `pasted-image.${suffix}`, { type: file.type || 'image/png', lastModified: Date.now() })
}

export function TransferTool({ initialCode = '' }: TransferToolProps) {
	const [mode, setMode] = useState<Mode>('relay')
	const [kind, setKind] = useState<TransferKind>('text')
	const [text, setText] = useState('')
	const [contentImage, setContentImage] = useState<File | null>(null)
	const [contentImagePreview, setContentImagePreview] = useState('')
	const [file, setFile] = useState<File | null>(null)
	const [password, setPassword] = useState('')
	const [openCode, setOpenCode] = useState(normalizeCode(initialCode))
	const [openPassword, setOpenPassword] = useState('')
	const [result, setResult] = useState<TransferCreateResponse | null>(null)
	const [resultPassword, setResultPassword] = useState('')
	const [qrDataUrl, setQrDataUrl] = useState('')
	const [qrError, setQrError] = useState('')
	const [openedText, setOpenedText] = useState('')
	const [openedFile, setOpenedFile] = useState<OpenedRelayFile | null>(null)
	const [status, setStatus] = useState('')
	const [busy, setBusy] = useState(false)
	const isCodeEntry = Boolean(normalizeCode(initialCode))

	useEffect(() => {
		const code = normalizeCode(initialCode)
		if (!code) return
		setMode('relay')
		setOpenCode(code)
	}, [initialCode])

	useEffect(() => {
		if (typeof window === 'undefined') return
		const hash = window.location.hash.replace(/^#/, '')
		if (!hash) return
		const hashPassword = new URLSearchParams(hash).get('p')
		if (!hashPassword) return
		setMode('relay')
		setOpenPassword(hashPassword)
		window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
	}, [initialCode])

	useEffect(() => {
		if (!contentImage) {
			setContentImagePreview('')
			return
		}
		const url = URL.createObjectURL(contentImage)
		setContentImagePreview(url)
		return () => URL.revokeObjectURL(url)
	}, [contentImage])

	useEffect(() => {
		return () => {
			if (openedFile) URL.revokeObjectURL(openedFile.url)
		}
	}, [openedFile])

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

	const handleCreate = async () => {
		setBusy(true)
		setStatus('')
		setResult(null)
		setResultPassword('')
		try {
			const createPassword = password
			const createUrl = transferApiUrl('create')
			const completeUrl = transferApiUrl('complete')
			const pastedImage = kind === 'text' ? contentImage : null
			const created = await createRelayTransfer({
				kind: pastedImage ? 'file' : kind,
				text,
				file: pastedImage || file,
				password: createPassword,
				createUrl,
				completeUrl,
				fileLimitBytes: pastedImage ? TRANSFER_LIMITS.publicRelayChunkBytes : undefined,
				fileTooLargeMessage: pastedImage ? `粘贴图片最多 ${contentLimitLabel}，请用文件上传或局域网互传` : undefined,
				onStatus: setStatus
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
		setOpenedFile(null)
		try {
			const metaUrl = `${transferApiUrl('meta')}?code=${encodeURIComponent(code)}`
			const openUrl = transferApiUrl('open')
			const opened = await openRelayTransfer({ code, password: openPassword, metaUrl, openUrl, onStatus: setStatus })
			if ('file' in opened && opened.file) setOpenedFile(opened.file)
			else if ('text' in opened) setOpenedText(opened.text)
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

	const handleContentPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const image = getClipboardImage(event.clipboardData)
		if (!image) return
		event.preventDefault()
		const pastedImage = namePastedImage(image)
		if (pastedImage.size > TRANSFER_LIMITS.publicRelayChunkBytes) {
			setContentImage(null)
			setStatus(`粘贴图片最多 ${contentLimitLabel}，请用文件上传或局域网互传`)
			return
		}
		setKind('text')
		setText('')
		setContentImage(pastedImage)
		setStatus(`已粘贴图片：${pastedImage.name}`)
	}

	const downloadQrCode = () => {
		if (!qrDataUrl || !result) return
		downloadDataUrl(`transfer-${result.code}.png`, qrDataUrl)
	}

	const sendSection = (
		<section key='send' className='relative min-w-0 space-y-4 rounded-2xl border border-border bg-background/30 p-5'>
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
					<p>同一局域网建议使用局域网互传</p>
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
								<span className='block font-semibold'>内容</span>
								<span className='text-secondary text-xs'>文本或粘贴图片最多 {contentLimitLabel}</span>
							</button>
							<button onClick={() => setKind('file')} className={`rounded-xl border px-4 py-3 text-left ${kind === 'file' ? 'border-brand bg-brand/10' : 'border-border'}`}>
								<span className='block font-semibold'>文件</span>
								<span className='text-secondary text-xs'>公网中转最多 {fileLimitLabel}</span>
							</button>
						</div>

						{kind === 'text' ? (
							<div className='space-y-3'>
								{contentImage && (
									<div className='flex gap-3 rounded-2xl border border-border bg-article p-3'>
										<div className='flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background/40'>
											{contentImagePreview ? <img src={contentImagePreview} alt='粘贴的图片预览' className='size-full object-contain' /> : <ImageIcon size={26} />}
										</div>
										<div className='min-w-0 flex-1 space-y-1 text-sm'>
											<p className='truncate font-medium'>{contentImage.name}</p>
											<p className='text-secondary text-xs'>{formatBytes(contentImage.size)} / {contentLimitLabel}</p>
											<p className='text-secondary text-xs'>将作为图片发送；输入文字会改为发送文本</p>
										</div>
										<button onClick={() => setContentImage(null)} className='text-secondary flex size-8 shrink-0 items-center justify-center rounded-full border border-border hover:text-primary' aria-label='移除图片'>
											<X size={15} />
										</button>
									</div>
								)}
								<textarea
									value={text}
									onPaste={handleContentPaste}
									onChange={event => {
										setText(event.target.value)
										if (contentImage) setContentImage(null)
									}}
									placeholder='粘贴文本，或直接粘贴图片'
									className='min-h-[200px] w-full resize-none rounded-2xl border border-border bg-article p-4 text-sm leading-6 text-primary'
								/>
							</div>
						) : (
							<label className='border-brand/20 bg-brand/5 text-secondary flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm xl:min-h-[240px]'>
								<UploadCloud className='mb-3' size={28} />
								<input type='file' className='hidden' onChange={event => setFile(event.target.files?.[0] || null)} />
								<span>{file ? file.name : '选择要中转的文件'}</span>
								<span className='mt-1 text-xs'>超过 {fileLimitLabel} 请使用局域网互传</span>
							</label>
						)}

						<input type='password' value={password} onChange={event => setPassword(event.target.value)} placeholder='设置读取密码，至少 6 位' className='w-full rounded-2xl border border-border bg-article px-4 py-3 text-sm' />
					</div>
				)}
			</div>
			<button disabled={busy} onClick={() => void handleCreate()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
				<Send size={16} />
				生成 6 位中转链接
			</button>
		</section>
	)

	const receiveSection = (
		<section key='receive' className='min-w-0 space-y-4 rounded-2xl border border-border bg-background/30 p-5'>
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
				<input type='password' value={openPassword} onChange={event => setOpenPassword(event.target.value)} placeholder='读取密码' className='w-full rounded-2xl border border-border bg-article px-4 py-3 text-sm' />
				<button disabled={busy} onClick={() => void handleOpen()} className='bg-brand text-background flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-50'>
					<Download size={16} />
					读取并销毁入口
				</button>
			</div>

			{openedText && (
				<div className='space-y-3 rounded-2xl border border-border bg-article p-4'>
					<div className='text-secondary text-xs'>读取到的内容</div>
					<textarea readOnly value={openedText} className='min-h-[220px] w-full resize-none rounded-2xl border border-border bg-background/30 p-4 text-sm leading-6' />
					<button onClick={() => navigator.clipboard.writeText(openedText)} className='rounded-full border border-border px-3 py-2 text-xs font-medium'>
						复制内容
					</button>
				</div>
			)}
			{openedFile && (
				<div className='space-y-3 rounded-2xl border border-border bg-article p-4'>
					<div className='text-secondary text-xs'>{openedFile.isImage ? '读取到的图片' : '读取到的文件'}</div>
					{openedFile.isImage && <img src={openedFile.url} alt={openedFile.name} className='max-h-[360px] w-full rounded-2xl border border-border bg-background/30 object-contain' />}
					<div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
						<div className='min-w-0'>
							<p className='truncate font-medium'>{openedFile.name}</p>
							<p className='text-secondary text-xs'>{formatBytes(openedFile.size)}</p>
						</div>
						<button onClick={() => downloadDataUrl(openedFile.name, openedFile.url)} className='flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium'>
							<Download size={14} />
							下载
						</button>
					</div>
				</div>
			)}
		</section>
	)
	const relaySections = isCodeEntry ? [receiveSection, sendSection] : [sendSection, receiveSection]
	const relayView = (
		<div aria-hidden={mode === 'lan'} className={`space-y-5 max-sm:px-4 ${mode === 'lan' ? 'lan-session-underlay' : ''}`}>
			<div className='flex flex-wrap gap-2 border-b border-border pb-4'>
				<button onClick={() => setMode('relay')} className='flex items-center gap-2 rounded-full bg-brand/10 px-4 py-2 text-xs font-medium text-primary'>
					<Globe2 size={15} />
					公网中转
				</button>
				<button onClick={() => setMode('lan')} className='text-secondary flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium hover:bg-brand/5'>
					<Network size={15} />
					局域网互传
				</button>
			</div>

			<div className='grid items-start gap-5 xl:grid-cols-2'>
				{relaySections}
			</div>
		</div>
	)

	if (mode !== 'lan') return relayView
	return (
		<>
			{relayView}
			<LanTransferTool
				onSwitchRelay={() => {
					setMode('relay')
					if (typeof window !== 'undefined') window.history.replaceState(null, '', '/t')
				}}
				onLeaveSession={() => {
					setMode('relay')
					if (typeof window !== 'undefined') window.history.replaceState(null, '', '/t')
				}}
			/>
		</>
	)
}
