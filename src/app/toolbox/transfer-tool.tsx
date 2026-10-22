'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, Clipboard, Copy, Download, Eye, EyeOff, File as FileIcon, FolderUp, Globe2, Image as ImageIcon, Link as LinkIcon, LockKeyhole, Network, QrCode, RotateCcw, Send, Settings, X } from 'lucide-react'
import * as QRCode from 'qrcode'
import { toast } from 'sonner'
import { LanTransferTool } from './lan-transfer-tool'
import { createRelayTransfer, openRelayTransfer, type OpenedRelayFile } from '@/lib/transfer-relay'
import {
	TRANSFER_CODE_PATTERN,
	TRANSFER_FILE_LIMIT_LABEL,
	TRANSFER_LIMITS,
	type TransferCreateResponse,
	type TransferKind
} from '@/lib/transfer-types'

type TransferToolProps = {
	initialCode?: string
}

type Mode = 'relay' | 'lan'
type Direction = 'send' | 'receive'

const expireFormatter = new Intl.DateTimeFormat('zh-CN', {
	dateStyle: 'short',
	timeStyle: 'short',
	hour12: false
})
const transferApiBase = (process.env.NEXT_PUBLIC_TRANSFER_API_BASE || '').replace(/\/+$/, '')
const contentLimitLabel = '4MB'
const fileLimitLabel = TRANSFER_FILE_LIMIT_LABEL
const primaryButtonClass = 'inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-sm font-semibold text-bg transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-brand/20 px-3 py-2 text-sm transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50'

async function copyToClipboard(value: string, message: string) {
	try {
		await navigator.clipboard.writeText(value)
		toast(message)
	} catch {
		toast.error('复制失败，请手动复制')
	}
}

function TransferPasswordField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (value: string) => void; placeholder: string }) {
	const [visible, setVisible] = useState(false)
	return (
		<div className='min-w-0 flex-1'>
			<label htmlFor={id} className='mb-2 block text-sm font-medium'>读取密码</label>
			<div className='relative'>
				<LockKeyhole size={18} aria-hidden='true' className='text-secondary pointer-events-none absolute top-1/2 left-4 -translate-y-1/2' />
				<input id={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} required minLength={TRANSFER_LIMITS.minPasswordLength} autoComplete='new-password' placeholder={placeholder} className='h-12 w-full rounded-xl border border-brand/20 bg-bg/30 pr-12 pl-11 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10' />
				<button type='button' onClick={() => setVisible(value => !value)} aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} className='text-secondary absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg hover:text-brand'>
					{visible ? <EyeOff size={18} /> : <Eye size={18} />}
				</button>
			</div>
		</div>
	)
}

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
	const [direction, setDirection] = useState<Direction>(initialCode ? 'receive' : 'send')
	const [kind, setKind] = useState<TransferKind>('file')
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
	const activeTransfer = useRef<AbortController | null>(null)
	const fileInput = useRef<HTMLInputElement | null>(null)
	useEffect(() => () => {
		activeTransfer.current?.abort()
		activeTransfer.current = null
	}, [])

	useEffect(() => {
		const code = normalizeCode(initialCode)
		if (!code) return
		activeTransfer.current?.abort()
		activeTransfer.current = null
		setBusy(false)
		setOpenedText('')
		setOpenedFile(null)
		setStatus('')
		setMode('relay')
		setDirection('receive')
		setOpenCode(code)
	}, [initialCode])

	useEffect(() => {
		if (typeof window === 'undefined') return
		const hash = window.location.hash.replace(/^#/, '')
		if (!hash) return
		const hashPassword = new URLSearchParams(hash).get('p')
		if (!hashPassword) return
		setMode('relay')
		setDirection('receive')
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
			void openedFile?.dispose()
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

	const reportStatus = (controller: AbortController, message: string) => {
		if (activeTransfer.current === controller && !controller.signal.aborted) setStatus(message)
	}

	const handleCreate = async () => {
		if (activeTransfer.current) return
		const controller = new AbortController()
		activeTransfer.current = controller
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
				signal: controller.signal,
				onStatus: message => reportStatus(controller, message)
			})
			if (controller.signal.aborted || activeTransfer.current !== controller) return
			setResult(created)
			setResultPassword(createPassword)
			setOpenCode(created.code)
			setStatus('')
		} catch (error) {
			if (activeTransfer.current === controller) setStatus(controller.signal.aborted ? '传输已取消' : error instanceof Error ? error.message : '创建失败')
		} finally {
			if (activeTransfer.current === controller) {
				activeTransfer.current = null
				setBusy(false)
			}
		}
	}

	const handleOpen = async () => {
		if (activeTransfer.current) return
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
		const controller = new AbortController()
		activeTransfer.current = controller
		try {
			const metaUrl = `${transferApiUrl('meta')}?code=${encodeURIComponent(code)}`
			const openUrl = transferApiUrl('open')
			const receivedUrl = transferApiUrl('received')
			const opened = await openRelayTransfer({ code, password: openPassword, metaUrl, openUrl, receivedUrl, signal: controller.signal, onStatus: message => reportStatus(controller, message) })
			if (controller.signal.aborted || activeTransfer.current !== controller) {
				await opened.file?.dispose()
				return
			}
			if ('file' in opened && opened.file) setOpenedFile(opened.file)
			else if ('text' in opened) setOpenedText(opened.text)
		} catch (error) {
			if (activeTransfer.current === controller) setStatus(controller.signal.aborted ? '传输已取消，已销毁的提取入口无法恢复' : error instanceof Error ? error.message : '读取失败')
		} finally {
			if (activeTransfer.current === controller) {
				activeTransfer.current = null
				setBusy(false)
			}
		}
	}

	const selectFile = (nextFile: File) => {
		if (!nextFile.size || nextFile.size > TRANSFER_LIMITS.maxFileBytes) {
			setFile(null)
			setStatus(nextFile.size ? `公网中转最多支持 ${fileLimitLabel}` : '请选择非空文件')
			return
		}
		setFile(nextFile)
		setKind('file')
		setStatus('')
	}

	const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		if (busy) return
		if (event.dataTransfer.files.length > 1) {
			setFile(null)
			setStatus('每次只能发送一个文件')
			return
		}
		const nextFile = event.dataTransfer.files[0]
		if (nextFile) selectFile(nextFile)
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
		setStatus('')
	}

	const downloadQrCode = () => {
		if (!qrDataUrl || !result) return
		downloadDataUrl(`transfer-${result.code}.png`, qrDataUrl)
	}

	const sendSection = (
		<section aria-label='发送内容'>
			{result ? (
				<div className='space-y-6'>
					<div className='flex items-center gap-2 font-medium text-brand'><Check size={20} />发送完成</div>
					<div className='grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_150px]'>
						<div className='min-w-0 space-y-4'>
							<div>
								<p className='text-secondary mb-2 text-sm'>提取码</p>
								<div className='flex flex-wrap items-center gap-3'>
									<p className='font-mono text-3xl font-semibold tracking-[0.15em]'>{result.code}</p>
									<button type='button' onClick={() => void copyToClipboard(result.code, '提取码已复制')} className={secondaryButtonClass}><Copy size={15} />复制提取码</button>
								</div>
							</div>
							<p className='break-all text-sm text-secondary'>{resultLink}</p>
							<div className='flex flex-wrap gap-2'>
								<button type='button' onClick={() => void copyToClipboard(resultLink, '链接已复制')} className={secondaryButtonClass}><LinkIcon size={15} />复制链接</button>
								<button type='button' onClick={() => void copyToClipboard(privateResultLink, '含密码链接已复制')} className={secondaryButtonClass}><Copy size={15} />复制含密码链接</button>
							</div>
							<p className='text-secondary text-xs'>最晚清理时间：{formatExpireAt(result.expireAt)}</p>
						</div>
						<div className='flex flex-col items-center gap-2'>
							<div className='flex size-[150px] items-center justify-center rounded-xl bg-white p-2'>
								{qrDataUrl ? (
									<img src={qrDataUrl} alt='包含读取密码的中转二维码' className='size-full' />
								) : (
									<div className='flex flex-col items-center gap-2 text-center text-xs text-slate-500'>
										<QrCode size={28} /><span>{qrError || '生成二维码中'}</span>
									</div>
								)}
							</div>
							<p className='text-secondary text-xs'>二维码包含读取密码</p>
							<button type='button' disabled={!qrDataUrl} onClick={downloadQrCode} className={secondaryButtonClass}><Download size={14} />下载二维码</button>
						</div>
					</div>
					<button type='button' onClick={() => {
						setResult(null)
						setResultPassword('')
						setFile(null)
						setText('')
						setContentImage(null)
						setPassword('')
						setKind('file')
						setStatus('')
					}} className='inline-flex items-center gap-2 text-sm font-medium text-brand'><RotateCcw size={16} />再次发送</button>
				</div>
			) : (
				<form onSubmit={event => { event.preventDefault(); void handleCreate() }}>
					<fieldset disabled={busy} className='min-w-0 space-y-6'>
						<div className='space-y-4'>
							{kind === 'file' ? (
								<div onDrop={handleFileDrop} onDragOver={event => {
									event.preventDefault()
									event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
								}} className='flex min-h-[200px] flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-brand/30 bg-brand/5 p-6 sm:flex-row sm:gap-6 sm:px-8'>
									{file ? <FileIcon size={44} aria-hidden='true' className='shrink-0 text-brand' /> : <FolderUp size={48} aria-hidden='true' className='shrink-0 text-brand' />}
									<div className='min-w-0 w-full text-center sm:w-auto sm:flex-1 sm:border-l sm:border-brand/20 sm:pl-6 sm:text-left'>
										<p title={file?.name} className='truncate text-lg font-semibold sm:text-xl'>{file ? file.name : '拖放文件到这里'}</p>
										<p className='text-secondary mt-2 text-sm'>{file ? formatBytes(file.size) : '单个文件最大 ' + fileLimitLabel}</p>
									</div>
									<input ref={fileInput} type='file' aria-label='选择要发送的文件' className='hidden' onChange={event => {
										const nextFile = event.target.files?.[0]
										if (nextFile) selectFile(nextFile)
										event.target.value = ''
									}} />
									<div className='flex shrink-0 items-center gap-2'>
										<button type='button' onClick={() => fileInput.current?.click()} className={primaryButtonClass}>{file ? '更换文件' : '选择文件'}</button>
										{file && <button type='button' onClick={() => { setFile(null); setStatus('') }} aria-label='移除文件' className='text-secondary flex size-10 items-center justify-center rounded-xl hover:bg-brand/10 hover:text-brand'><X size={18} /></button>}
									</div>
								</div>
							) : (
								<div className='space-y-3'>
									<label htmlFor='relay-content' className='flex items-center justify-between gap-3 text-sm font-medium'>文字或图片<span className='text-secondary text-xs font-normal'>最多 {contentLimitLabel}</span></label>
									{contentImage && (
										<div className='flex items-center gap-4 rounded-xl border border-brand/20 p-3'>
											<div className='flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg/40'>
												{contentImagePreview ? <img src={contentImagePreview} alt='粘贴的图片预览' className='size-full object-contain' /> : <ImageIcon size={26} />}
											</div>
											<div className='min-w-0 flex-1 space-y-1'>
												<p className='truncate text-sm font-medium'>{contentImage.name}</p>
												<p className='text-secondary text-xs'>{formatBytes(contentImage.size)} · 输入文字会替换图片</p>
											</div>
											<button type='button' onClick={() => setContentImage(null)} aria-label='移除图片' className='text-secondary flex size-10 shrink-0 items-center justify-center rounded-lg hover:text-brand'><X size={18} /></button>
										</div>
									)}
									<textarea
										id='relay-content'
										autoFocus
										value={text}
										required={!contentImage}
										onPaste={handleContentPaste}
										onChange={event => {
											setText(event.target.value)
											if (contentImage) setContentImage(null)
										}}
										placeholder='输入文字，或在这里粘贴图片'
										className={'w-full resize-y rounded-2xl border border-brand/20 bg-bg/30 p-4 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 ' + (contentImage ? 'min-h-24' : 'min-h-[200px]')}
									/>
								</div>
							)}
							<button type='button' onClick={() => { setKind(kind === 'file' ? 'text' : 'file'); setStatus('') }} className='inline-flex items-center gap-2 rounded-lg py-1 text-sm font-medium text-brand hover:underline'>
								{kind === 'file' ? <Clipboard size={18} /> : <FolderUp size={18} />}
								{kind === 'file' ? '粘贴文字或图片' : '改为发送文件'}
							</button>
						</div>
						<div className='flex flex-col gap-3 border-t border-brand/20 pt-5 sm:flex-row sm:items-end'>
							<TransferPasswordField id='relay-send-password' value={password} onChange={setPassword} placeholder='设置密码，至少 6 位' />
							<button type='submit' disabled={kind === 'file' ? !file : !text && !contentImage} className={primaryButtonClass + ' sm:min-w-32'}>{busy ? '发送中…' : '发送'}<ArrowUpRight size={18} /></button>
						</div>
					</fieldset>
				</form>
			)}
		</section>
	)

	const receiveSection = (
		<section aria-label='接收内容'>
			{openedText || openedFile ? (
				<div className='space-y-5'>
					<div className='flex items-center gap-2 font-medium text-brand'><Check size={20} />接收完成</div>
					{openedText && (
						<>
							<textarea aria-label='接收到的文字' readOnly value={openedText} className='min-h-[200px] w-full resize-y rounded-2xl border border-brand/20 bg-bg/30 p-4 text-sm leading-6' />
							<button type='button' onClick={() => void copyToClipboard(openedText, '内容已复制')} className={secondaryButtonClass}><Copy size={15} />复制内容</button>
						</>
					)}
					{openedFile && (
						<div className='space-y-4'>
							{openedFile.isImage && <img src={openedFile.url} alt={openedFile.name} className='max-h-[320px] w-full rounded-xl bg-bg/30 object-contain' />}
							<div className='flex flex-wrap items-center gap-4 rounded-xl border border-brand/20 p-4'>
								<FileIcon size={28} aria-hidden='true' className='shrink-0 text-brand' />
								<div className='min-w-0 flex-1'>
									<p title={openedFile.name} className='truncate font-medium'>{openedFile.name}</p>
									<p className='text-secondary mt-1 text-sm'>{formatBytes(openedFile.size)}</p>
								</div>
								<button type='button' onClick={() => downloadDataUrl(openedFile.name, openedFile.url)} className={primaryButtonClass}><Download size={16} />下载</button>
							</div>
						</div>
					)}
					<div className='border-t border-brand/20 pt-5'>
						<button type='button' onClick={() => {
							setOpenedText('')
							setOpenedFile(null)
							setOpenCode('')
							setOpenPassword('')
							setStatus('')
						}} className='inline-flex items-center gap-2 text-sm font-medium text-brand'><RotateCcw size={16} />再次接收</button>
					</div>
				</div>
			) : (
				<form onSubmit={event => { event.preventDefault(); void handleOpen() }}>
					<fieldset disabled={busy} className='min-w-0 space-y-6'>
						<div>
							<label htmlFor='relay-open-code' className='mb-2 block text-sm font-medium'>提取码</label>
							<input id='relay-open-code' value={openCode} onChange={event => setOpenCode(normalizeCode(event.target.value))} required maxLength={6} autoCapitalize='characters' autoComplete='off' spellCheck={false} placeholder='6 位提取码' className='h-16 w-full rounded-xl border border-brand/20 bg-bg/30 px-5 font-mono text-xl tracking-[0.3em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/10' />
						</div>
						<div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
							<TransferPasswordField id='relay-open-password' value={openPassword} onChange={setOpenPassword} placeholder='输入读取密码' />
							<button type='submit' className={primaryButtonClass}><ArrowDown size={18} />{busy ? '接收中…' : '接收并销毁入口'}</button>
						</div>
					</fieldset>
				</form>
			)}
		</section>
	)

	const relayView = (
		<div aria-hidden={mode === 'lan'} inert={mode === 'lan'} className={mode === 'lan' ? 'lan-session-underlay' : undefined}>
			<header className='flex flex-wrap items-center justify-between gap-x-6 gap-y-5'>
				<h1 className='flex items-center gap-3 text-2xl font-semibold tracking-normal'><Send size={30} aria-hidden='true' className='text-brand' />快传</h1>
				<div role='group' aria-label='传输方式' className='flex flex-wrap items-center gap-1 max-sm:w-full sm:gap-2'>
					<button type='button' aria-pressed={mode === 'relay'} onClick={() => setMode('relay')} className='flex min-h-10 items-center gap-2 rounded-full bg-brand/10 px-3 text-sm font-medium text-brand max-sm:gap-1.5 max-sm:px-2 max-sm:text-xs'><Globe2 size={17} />公网中转</button>
					<button type='button' disabled={busy} aria-pressed={mode === 'lan'} onClick={() => setMode('lan')} className='text-secondary flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium max-sm:gap-1.5 max-sm:px-2 max-sm:text-xs hover:bg-brand/5 hover:text-brand disabled:opacity-50'><Network size={17} />局域网互传</button>
					<Link href='/t/status' prefetch={false} aria-label='公网中转状态管理' title='公网中转状态管理' className='text-secondary ml-auto flex size-10 shrink-0 items-center justify-center rounded-lg sm:ml-2 sm:border-l sm:border-brand/20 hover:bg-brand/5 hover:text-brand'><Settings size={19} /></Link>
				</div>
			</header>

			<div role='group' aria-label='收发方式' className='mt-7 mb-6 grid w-full grid-cols-2 rounded-2xl bg-brand/10 p-1 sm:mt-8 sm:w-80'>
				{(['send', 'receive'] as const).map(view => (
					<button key={view} type='button' disabled={busy} aria-pressed={direction === view} onClick={() => { setDirection(view); setStatus('') }} className={'flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ' + (direction === view ? 'bg-article text-brand shadow-sm' : 'text-secondary hover:text-brand')}>
						{view === 'send' ? <ArrowUp size={19} /> : <ArrowDown size={19} />}{view === 'send' ? '发送' : '接收'}
					</button>
				))}
			</div>

			<div aria-busy={busy}>{direction === 'send' ? sendSection : receiveSection}</div>

			{status && (
				<div className='mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand/5 px-4 py-3 text-sm'>
					<p role='status' className='text-secondary min-w-0 break-words'>{status}</p>
					{busy && (
						<button type='button' onClick={() => {
							setStatus('正在取消传输...')
							activeTransfer.current?.abort()
						}} className={secondaryButtonClass}><X size={14} />取消传输</button>
					)}
				</div>
			)}
		</div>
	)

	const returnToRelay = () => {
		setMode('relay')
		window.history.replaceState(null, '', '/t')
	}

	if (mode !== 'lan') return relayView
	return (
		<>
			{relayView}
			<LanTransferTool onSwitchRelay={returnToRelay} onLeaveSession={returnToRelay} />
		</>
	)
}
