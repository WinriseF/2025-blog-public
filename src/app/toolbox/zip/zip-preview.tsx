import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { DialogModal } from '@/components/dialog-modal'
import { ImagePreviewDialog, type ImageGallery } from '@/components/image-preview-dialog'
import { useTimeTheme } from '@/components/time-theme-provider'
import { filePreviewType } from '@/lib/file-preview-type'
import { decodeText, TEXT_LIMIT } from '@/lib/version-control/browser-directory'
import { ZIP_DOWNLOAD_LIMIT } from '@/lib/zip-packer'
import { readZipBlob, type Entry } from '@/lib/zip-runtime'
import { diffThemes } from '../version-control/diff-themes'

const FileTextView = dynamic(() => import('@/components/file-text-view').then(module => module.FileTextView), {
	loading: () => <p className='text-secondary m-auto'>正在显示文本…</p>
})

export function ZipPreview({
	path,
	entry,
	password,
	gallery,
	onClose
}: {
	path: string
	entry: Entry
	password: string
	gallery: ImageGallery
	onClose: () => void
}) {
	const mime = filePreviewType(path)!
	const isText = mime === 'text/plain'
	const isAudio = mime.startsWith('audio/')
	const { theme } = useTimeTheme()
	const [content, setContent] = useState<string | null>(null)
	const [error, setError] = useState('')
	useEffect(() => {
		const controller = new AbortController()
		const { signal } = controller
		let url: string | undefined
		async function load() {
			const limit = isText ? TEXT_LIMIT : ZIP_DOWNLOAD_LIMIT
			if (entry.uncompressedSize > limit) throw new Error(`文件超过 ${limit / 1024 ** 2} MiB 预览上限，可返回列表保存。`)
			const blob = await readZipBlob(entry, signal, limit, password)
			if (isText) {
				const { content } = await decodeText(blob)
				if (!signal.aborted) setContent(content)
			} else if (!signal.aborted) {
				url = URL.createObjectURL(blob.slice(0, blob.size, mime))
				setContent(url)
			}
		}
		load().catch(cause => {
			if (signal.aborted) return
			const reason = cause instanceof Error ? cause.message : ''
			if (/password/i.test(reason)) setError('请返回列表输入正确的解压密码。')
			else if (isText && /encoding|UTF-8|二进制/i.test(reason)) setError('仅支持预览 UTF-8 文本文件。')
			else setError(reason || '无法读取文件。')
		})
		return () => {
			controller.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [entry, isText, mime, password])

	if (mime.startsWith('image/'))
		return (
			<ImagePreviewDialog
				src={content ?? ''}
				alt={path}
				gallery={gallery}
				message={error}
				onError={() => setError('无法显示此图片，可返回列表保存。')}
				onClose={onClose}
			/>
		)

	return (
		<DialogModal open onClose={onClose} className={`border-border bg-article overflow-hidden rounded-xl border shadow-xl ${isAudio ? 'w-full max-w-lg' : 'size-full'}`}>
			<section role='dialog' aria-modal='true' aria-label={`预览 ${path}`} className='flex h-full min-h-0 flex-col'>
				<header className='border-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1'>
					<h2 title={path} className='text-primary truncate text-sm font-semibold'>
						{path}
					</h2>
					<button
						type='button'
						autoFocus
						aria-label='关闭预览'
						onClick={onClose}
						className='text-secondary hover:bg-brand/10 grid size-10 shrink-0 place-items-center rounded-lg'>
						<X size={20} />
					</button>
				</header>
				{error || content === null ? (
					<p role='status' className='text-secondary m-auto p-4 text-sm'>
						{error || '正在读取文件…'}
					</p>
				) : isText ? (
					<FileTextView file={{ name: path, contents: content }} theme={diffThemes[theme.name]} />
				) : isAudio ? (
					<audio src={content} controls preload='metadata' aria-label={path} className='my-4 w-full px-4'
						onError={() => setError('浏览器无法播放此音频，可返回列表保存。')} />
				) : (
					<video
						src={content}
						controls
						playsInline
						preload='metadata'
						onError={() => setError('浏览器无法播放此视频，可返回列表保存。')}
						className='min-h-0 w-full flex-1 bg-black object-contain'
					/>
				)}
			</section>
		</DialogModal>
	)
}
